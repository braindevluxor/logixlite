import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  Copy,
  Link2,
  MapPin,
  Pencil,
  Search,
  Send,
  Share2,
  Star,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { up } from '../lib/format'
import { employeeFullName, fetchEmployees } from '../lib/talentoHumano'
import Stars from '../components/Stars'
import MapModal, { type MapPoint } from '../components/MapModal'
import RouteMap from '../components/RouteMap'
import type {
  ApiEmployee,
  Branch,
  Driver,
  Trip,
  TripDestination,
  TripPassenger,
  TripStatus,
  Vehicle,
} from '../lib/types'

interface TripFull extends Trip {
  branch?: Branch
  vehicle?: Vehicle
  driver?: Driver
}

interface TpdRow {
  trip_passenger_id: number
  trip_destination_id: number
  seq: number | null
  arrived_at: string | null
  km: number | null
  latitude: number | null
  longitude: number | null
  gps_accuracy: number | null
}

interface IncidentRow {
  id: number
  trip_passenger_id: number | null
  message: string
  created_at: string
}

const STATUS_LABEL: Record<TripStatus, string> = {
  programado: 'Programado',
  en_curso: 'En curso',
  finalizado: 'Finalizado',
  cancelado: 'Cancelado',
}

export default function TripDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [trip, setTrip] = useState<TripFull | null>(null)
  const [passengers, setPassengers] = useState<TripPassenger[]>([])
  const [destinations, setDestinations] = useState<TripDestination[]>([])
  const [links, setLinks] = useState<TpdRow[]>([])
  const [incidents, setIncidents] = useState<IncidentRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // ---- Cancelar pasajero (con comentario) ----
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelPass, setCancelPass] = useState<TripPassenger | null>(null)
  const [paxReason, setPaxReason] = useState('')
  const [cancelErr, setCancelErr] = useState<string | null>(null)
  const [cancelSaving, setCancelSaving] = useState(false)

  // ---- Reemplazar pasajero (cancela + agrega el nuevo) ----
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [repPass, setRepPass] = useState<TripPassenger | null>(null)
  const [repReason, setRepReason] = useState('')
  const [repQuery, setRepQuery] = useState('')
  const [repEmployees, setRepEmployees] = useState<ApiEmployee[] | null>(null)
  const [repLoading, setRepLoading] = useState(false)
  const [repLoadErr, setRepLoadErr] = useState<string | null>(null)
  const [repName, setRepName] = useState('')
  const [repDni, setRepDni] = useState('')
  const [repPhone, setRepPhone] = useState('')
  const [repSaving, setRepSaving] = useState(false)
  const [repErr, setRepErr] = useState<string | null>(null)

  // ---- Mapa de la llegada (modal con iframe) ----
  const [mapPoint, setMapPoint] = useState<MapPoint | null>(null)

  const load = useCallback(async () => {
    const [t, p, d, i] = await Promise.all([
      supabase
        .from('trips')
        .select(`*, branch:branches(*), vehicle:vehicles(*), driver:drivers(*)`)
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('trip_passengers')
        .select('*')
        .eq('trip_id', id)
        .order('full_name'),
      supabase
        .from('trip_destinations')
        .select('*')
        .eq('trip_id', id)
        .order('position'),
      supabase
        .from('trip_incidents')
        .select('*')
        .eq('trip_id', id)
        .order('created_at', { ascending: false }),
    ])
    if (t.error) return setError(t.error.message)
    if (!t.data) return setError('Viaje no encontrado')
    setTrip(t.data as unknown as TripFull)
    const passData = (p.data as TripPassenger[]) ?? []
    const destData = (d.data as TripDestination[]) ?? []
    setPassengers(passData)
    setDestinations(destData)
    setIncidents((i.data as IncidentRow[]) ?? [])

    if (passData.length === 0) {
      setLinks([])
      return
    }
    const { data: linkData, error: linkErr } = await supabase
      .from('trip_passenger_destinations')
      .select(
        'trip_passenger_id, trip_destination_id, seq, arrived_at, km, latitude, longitude, gps_accuracy'
      )
      .in('trip_passenger_id', passData.map((x) => x.id))
    if (linkErr) return setError(linkErr.message)
    setLinks((linkData as TpdRow[]) ?? [])
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function setStatus(status: TripStatus) {
    setBusy(true)
    const { error } = await supabase.from('trips').update({ status }).eq('id', id)
    setBusy(false)
    if (error) setError(error.message)
    else load()
  }

  // ---- Cancelar con motivo (incidencia) desde el admin ----
  const [showCancelForm, setShowCancelForm] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  async function cancelWithReason() {
    if (!cancelReason.trim()) return
    setCancelling(true)
    setError(null)

    const { error: upErr } = await supabase
      .from('trips')
      .update({ status: 'cancelado' })
      .eq('id', id)

    if (upErr) {
      setError(upErr.message)
      setCancelling(false)
      return
    }

    const { error: incErr } = await supabase.from('trip_incidents').insert({
      trip_id: Number(id),
      trip_passenger_id: null,
      message: `Viaje cancelado: ${cancelReason.trim().toUpperCase()}`,
    })

    setCancelling(false)
    setShowCancelForm(false)
    setCancelReason('')

    if (incErr) {
      setError(`Viaje cancelado, pero no se registró la incidencia: ${incErr.message}`)
    }
    load()
  }

  async function onDelete() {
    if (!confirm('¿Eliminar este viaje? Esta acción no se puede deshacer.')) return
    setBusy(true)
    const { error } = await supabase.from('trips').delete().eq('id', id)
    setBusy(false)
    if (error) setError(error.message)
    else navigate('/viajes')
  }

  // ---- Link de seguimiento para el chofer ----
  const [copied, setCopied] = useState(false)
  const shareUrl = trip?.share_token
    ? `${window.location.origin}/viaje/${trip.share_token}`
    : null

  async function copyLink() {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('No se pudo copiar. Copia manualmente desde la dirección del navegador.')
    }
  }

  async function shareNative() {
    if (!shareUrl) return
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Viaje #${trip?.id} - LOGIXLITE`,
          text: 'Link del viaje para el chofer:',
          url: shareUrl,
        })
        return
      } catch {
        // cancelado o no soportado: cae al portapapeles
      }
    }
    copyLink()
  }

  if (!trip) {
    return (
      <div className="page">
        {error ? <div className="alert alert-error">{error}</div> : <p className="muted">Cargando…</p>}
      </div>
    )
  }

  /** Mensaje de aviso personalizado por pasajero */
  const passengerMessage = (p: TripPassenger): string => {
    const origin = p.origin_destination_id
      ? destinations.find((d) => d.id === p.origin_destination_id)?.name
      : null

    // Destinos del pasajero en SU orden de bajada (seq)
    const passLinks = links
      .filter((l) => l.trip_passenger_id === p.id)
      .sort((a, b) => (a.seq ?? 999) - (b.seq ?? 999))
    const destNames = passLinks
      .map((l) => destinations.find((d) => d.id === l.trip_destination_id)?.name)
      .filter((n): n is string => !!n)
    const destStr =
      destNames.length > 0
        ? destNames.join(', ')
        : destinations.map((d) => d.name).join(', ') || '—'

    const dep = new Date(trip.departure_at)
    const p2 = (n: number) => String(n).padStart(2, '0')
    const dateStr = `${dep.getFullYear()}-${p2(dep.getMonth() + 1)}-${p2(dep.getDate())}`
    const timeStr = `${p2(dep.getHours())}:${p2(dep.getMinutes())}`

    return [
      `Hola ${p.full_name}, tienes un viaje programado:`,
      '',
      `- Origen: ${origin ?? '—'}`,
      `- Destino(s): ${destStr}`,
      `- Fecha y Hora: ${dateStr} a las ${timeStr}`,
      `- Vehículo: ${trip.vehicle?.plate ?? '—'}`,
      `- Conductor: ${trip.driver?.full_name ?? '—'}${
        trip.driver?.phone ? ` (Tel: ${trip.driver.phone})` : ''
      }`,
    ].join('\n')
  }

  /**
   * Convierte un teléfono venezolano al formato internacional de
   * WhatsApp: 04124362012 -> 584124362012 (sin +, sin espacios).
   */
  function toIntlPhone(phone: string): string | null {
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 8) return null
    if (digits.startsWith('58')) return digits
    if (digits.startsWith('0')) return '58' + digits.slice(1)
    return digits
  }

  /** Enlace de WhatsApp: directo al chat si hay teléfono, si no al selector */
  function waUrl(msg: string, phone?: string | null): string {
    const intl = phone ? toIntlPhone(phone) : null
    const base = intl ? `https://wa.me/${intl}` : 'https://wa.me/'
    return `${base}?text=${encodeURIComponent(msg)}`
  }

  /** Link publico de calificacion del pasajero (unico y de un solo uso) */
  function ratingUrl(p: TripPassenger): string | null {
    return p.rating_token ? `${window.location.origin}/calificar/${p.rating_token}` : null
  }

  /** Mensaje de WhatsApp para pedirle la calificación del viaje */
  function ratingMessage(p: TripPassenger): string {
    return [
      `Hola ${p.full_name}, gracias por viajar con LOGIXLITE.`,
      '',
      '¿Cómo estuvo tu experiencia? Califica el viaje con 5 estrellas y déjanos un comentario (opcional):',
      ratingUrl(p) ?? '',
    ].join('\n')
  }

  // ---- Pasajeros activos (los cancelados no viajan) ----
  const activePassengers = passengers.filter((p) => p.status !== 'cancelado')
  const cancelledCount = passengers.length - activePassengers.length

  /**
   * Mapa "pasajero cancelado -> quien lo sustituyó", armado con
   * la observación "REEMPLAZA A <nombre>" de los reemplazos.
   */
  const replacedBy = new Map<string, string>()
  for (const p of passengers) {
    const obs = (p.observation ?? '').toUpperCase().trim()
    if (obs.startsWith('REEMPLAZA A ')) {
      replacedBy.set(obs.slice('REEMPLAZA A '.length).trim(), p.full_name.trim().toUpperCase())
    }
  }

  /**
   * Nombre de quien sustituyó a ESTE pasajero, o null si todavía
   * no fue sustituido (marcado en su observación al sustituirlo
   * o detectado por la observación del reemplazo).
   * Un pasajero ya sustituido no se vuelve a sustituir: la
   * cadena se administra desde el pasajero activo.
   */
  function replacedByName(p: TripPassenger): string | null {
    const obs = (p.observation ?? '').toUpperCase()
    const marker = obs.indexOf('SUSTITUIDO POR ')
    if (marker >= 0) {
      const who = obs.slice(marker + 'SUSTITUIDO POR '.length).trim()
      if (who) return who
    }
    return replacedBy.get(p.full_name.trim().toUpperCase()) ?? null
  }

  /** Quita el marcador "SUSTITUIDO POR ..." de una observación */
  function stripSubstitution(obs: string): string {
    return obs
      .replace(/\s*·\s*SUSTITUIDO POR .*$/i, '')
      .replace(/^\s*SUSTITUIDO POR .*$/i, '')
      .trim()
  }

  // ===== Cancelar pasajero =====
  function openCancel(p: TripPassenger) {
    setCancelPass(p)
    setPaxReason('')
    setCancelErr(null)
    setCancelOpen(true)
  }

  function closeCancel() {
    setCancelOpen(false)
    setCancelPass(null)
    setPaxReason('')
    setCancelErr(null)
  }

  async function confirmCancelPassenger() {
    if (!cancelPass) return
    if (!paxReason.trim()) {
      setCancelErr('El comentario es obligatorio.')
      return
    }
    setCancelSaving(true)
    setCancelErr(null)
    const { error: cErr } = await supabase
      .from('trip_passengers')
      .update({
        status: 'cancelado',
        cancel_reason: paxReason.trim().toUpperCase(),
        cancelled_at: new Date().toISOString(),
      })
      .eq('id', cancelPass.id)
    setCancelSaving(false)
    if (cErr) {
      setCancelErr(cErr.message)
      return
    }
    closeCancel()
    load()
  }

  // ===== Reemplazar pasajero =====
  function openReplace(p: TripPassenger) {
    setRepPass(p)
    setRepReason('')
    setRepQuery('')
    setRepName('')
    setRepDni('')
    setRepPhone('')
    setRepErr(null)
    setRepLoadErr(null)
    setReplaceOpen(true)
    void loadRepEmployees()
  }

  function closeReplace() {
    setReplaceOpen(false)
    setRepPass(null)
    setRepSaving(false)
    setRepErr(null)
  }

  /** Nómina de trabajadores de todas las sucursales (una sola vez) */
  async function loadRepEmployees() {
    if (repEmployees || repLoading) return
    setRepLoading(true)
    setRepLoadErr(null)
    try {
      const { data: br, error: brErr } = await supabase
        .from('branches')
        .select('external_id')
        .eq('active', true)
      if (brErr) throw new Error(brErr.message)
      const ids = ((br ?? []) as { external_id: number }[]).map((b) => b.external_id)
      if (ids.length === 0) throw new Error('No hay sucursales registradas')

      const results = await Promise.allSettled(ids.map((i) => fetchEmployees(i)))
      const ok = results.filter(
        (r): r is PromiseFulfilledResult<ApiEmployee[]> => r.status === 'fulfilled'
      )
      if (ok.length === 0) throw new Error('La nómina no respondió en ninguna sucursal')

      const seen = new Set<string>()
      setRepEmployees(
        ok.flatMap((r) => r.value).filter((e) => {
          const dni = String(e.dni)
          if (seen.has(dni)) return false
          seen.add(dni)
          return true
        })
      )
    } catch (err) {
      setRepLoadErr(err instanceof Error ? err.message : 'Error al consultar la nómina')
    } finally {
      setRepLoading(false)
    }
  }

  /**
   * Sustituye al pasajero: primero agrega el nuevo (con su mismo
   * origen y paradas, y una nota que indica a quién reemplaza)
   * y después cancela al actual con el comentario.
   */
  async function replacePassenger(newP: {
    full_name: string
    dni: string
    phone?: string | null
    role_name?: string | null
    department?: string | null
    branch_id?: number | null
  }) {
    if (!repPass) return
    if (!repReason.trim()) {
      setRepErr('El comentario de la cancelación es obligatorio.')
      return
    }
    if (!newP.full_name.trim()) {
      setRepErr('El nombre del reemplazo es obligatorio.')
      return
    }
    if (passengers.some((p) => p.dni === newP.dni)) {
      setRepErr('Esa cédula ya está registrada en este viaje.')
      return
    }

    setRepSaving(true)
    setRepErr(null)

    // 1) Insertar el reemplazo
    const { data: created, error: iErr } = await supabase
      .from('trip_passengers')
      .insert({
        trip_id: Number(id),
        dni: newP.dni,
        full_name: newP.full_name.trim().toUpperCase(),
        role_name: newP.role_name ?? null,
        department: newP.department ?? null,
        branch_id: newP.branch_id ?? null,
        phone: newP.phone ?? null,
        origin_destination_id: repPass.origin_destination_id ?? null,
        observation: `REEMPLAZA A ${repPass.full_name}`.toUpperCase(),
        status: 'activo',
      })
      .select('id')
      .single()

    if (iErr || !created) {
      setRepSaving(false)
      setRepErr(iErr?.message ?? 'No se pudo agregar al pasajero de reemplazo.')
      return
    }
    const newId = (created as { id: number }).id

    // 2) Copiar las paradas asignadas al pasajero original
    const oldLinks = links.filter((l) => l.trip_passenger_id === repPass.id)
    if (oldLinks.length > 0) {
      const { error: lErr } = await supabase
        .from('trip_passenger_destinations')
        .insert(
          oldLinks.map((l) => ({
            trip_passenger_id: newId,
            trip_destination_id: l.trip_destination_id,
            seq: l.seq,
          }))
        )
      if (lErr) console.warn('No se copiaron las paradas:', lErr.message)
    }

    // 3) Cancelar al pasajero original con el comentario y marcar
    //    que ya fue sustituido (para no permitir sustituirlo otra vez)
    const marker = `SUSTITUIDO POR ${newP.full_name.trim().toUpperCase()}`
    const prevObs = (repPass.observation ?? '').trim()
    const observation = prevObs.toUpperCase().includes('SUSTITUIDO POR')
      ? prevObs
      : prevObs
        ? `${prevObs} · ${marker}`
        : marker
    const { error: cErr } = await supabase
      .from('trip_passengers')
      .update({
        status: 'cancelado',
        cancel_reason: repReason.trim().toUpperCase(),
        cancelled_at: new Date().toISOString(),
        observation,
      })
      .eq('id', repPass.id)

    setRepSaving(false)
    if (cErr) {
      setRepErr(
        `Se agregó el reemplazo, pero no se pudo cancelar al original: ${cErr.message}`
      )
      closeReplace()
      load()
      return
    }

    closeReplace()
    load()
  }

  // Resultados de la nómina según lo escrito (máximo 6)
  const repResults = (() => {
    const q = repQuery.trim().toLowerCase()
    if (!q || !repEmployees) return []
    const taken = new Set(passengers.map((p) => p.dni))
    return repEmployees
      .filter((e) => !taken.has(String(e.dni)))
      .filter(
        (e) =>
          employeeFullName(e).toLowerCase().includes(q) ||
          String(e.dni).includes(q) ||
          (e.role_name ?? '').toLowerCase().includes(q) ||
          (e.department_name ?? '').toLowerCase().includes(q)
      )
      .slice(0, 6)
  })()

  return (
    <div className="page">
      <div className="page-head">
        <h1>Viaje #{trip.id}</h1>
        <Link className="btn btn-sm" to="/viajes">
          <ArrowLeft size={14} /> Volver
        </Link>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <div className="row spread">
          <span className={`badge badge-${trip.status}`}>{STATUS_LABEL[trip.status]}</span>
          <span className="muted small">
            {new Date(trip.departure_at).toLocaleString('es-VE', {
              dateStyle: 'full',
              timeStyle: 'short',
            })}
          </span>
        </div>

        <dl className="kv">
          <dt>Sucursal</dt>
          <dd>{trip.branch?.name ?? '—'}</dd>
          <dt>Vehículo</dt>
          <dd>
            {trip.vehicle
              ? `${trip.vehicle.plate} (${trip.vehicle.capacity} puestos)`
              : '—'}
          </dd>
          <dt>Chofer</dt>
          <dd>{trip.driver?.full_name ?? '—'}</dd>
          <dt>Kilometraje</dt>
          <dd>{trip.track_km ? 'Sí — registrado en cada llegada' : 'No'}</dd>
          {trip.notes && (
            <>
              <dt>Notas</dt>
              <dd>{trip.notes}</dd>
            </>
          )}
        </dl>

        <div className="share-box">
          <div className="row spread wrap gap-sm">
            <strong className="share-title">
              <Link2 size={16} /> Link para el chofer
            </strong>
            <div className="row gap-sm">
              <button className="btn btn-sm" onClick={copyLink} disabled={!shareUrl}>
                {copied ? (
                  <>
                    <Check size={14} /> Copiado
                  </>
                ) : (
                  <>
                    <Copy size={14} /> Copiar
                  </>
                )}
              </button>
              <button
                className="btn btn-sm btn-primary"
                onClick={shareNative}
                disabled={!shareUrl}
              >
                <Share2 size={14} /> Compartir
              </button>
            </div>
          </div>
          <p className="muted small" style={{ margin: '0.4rem 0 0' }}>
            {shareUrl
              ? 'El chofer puede marcar llegadas y reportar novedades sin cuenta ni contraseña.'
              : 'Este viaje no tiene link (falta regenerar share_token).'}
          </p>
        </div>

        <div className="row gap wrap">
          {trip.status === 'programado' && (
            <>
              <Link className="btn" to={`/viajes/${trip.id}/editar`}>
                <Pencil size={14} /> Editar
              </Link>
              <button className="btn" disabled={busy} onClick={() => setStatus('en_curso')}>
                Iniciar viaje
              </button>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={() => setShowCancelForm(true)}
              >
                Cancelar
              </button>
            </>
          )}
          {trip.status === 'en_curso' && (
            <button className="btn btn-primary" disabled={busy} onClick={() => setStatus('finalizado')}>
              Finalizar
            </button>
          )}
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={onDelete}
            title="Eliminar este viaje (cualquier estado)"
          >
            Eliminar viaje
          </button>
        </div>
      </div>

      <h2>
        Destinos ({destinations.length})
      </h2>
      {destinations.length === 0 ? (
        <p className="muted">Sin destinos registrados.</p>
      ) : (
        <ol className="dest-list">
          {destinations.map((d) => {
            const inDest = activePassengers.filter((p) =>
              links.some((l) => l.trip_passenger_id === p.id && l.trip_destination_id === d.id)
            )
            return (
              <li key={d.id}>
                <strong>{up(d.name)}</strong>
                {d.notes && <div className="muted small">{d.notes}</div>}
                <div className="dest-tags">
                  {inDest.length === 0 ? (
                    <span className="muted small">Sin pasajeros asignados</span>
                  ) : (
                    inDest.map((p) => (
                      <span key={p.id} className="chip on">
                        {p.full_name}
                      </span>
                    ))
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {/* Mapa de la ruta del viaje (aplica a viajes nuevos y viejos) */}
      {destinations.length > 0 && (
        <RouteMap
          origin={destinations[0].name}
          destination={destinations[destinations.length - 1].name}
        />
      )}

      <h2>
        Pasajeros ({activePassengers.length}
        {trip.vehicle ? ` / ${trip.vehicle.capacity}` : ''})
        {cancelledCount > 0 && (
          <span className="muted small"> · {cancelledCount} cancelado(s)</span>
        )}
      </h2>
      {passengers.length === 0 ? (
        <p className="muted">Sin pasajeros registrados.</p>
      ) : (
        <ul className="list">
          {passengers.map((p) => {
            // Destinos de ESTE pasajero, en SU orden de bajada (seq)
            const destNames = links
              .filter((l) => l.trip_passenger_id === p.id)
              .sort((a, b) => (a.seq ?? 99) - (b.seq ?? 99))
              .map((l) => destinations.find((d) => d.id === l.trip_destination_id))
              .filter((d): d is NonNullable<typeof d> => !!d)
              .map((d) => d.name)
            const originName = p.origin_destination_id
              ? destinations.find((d) => d.id === p.origin_destination_id)?.name
              : null
            const cancelled = p.status === 'cancelado'
            const canManage = trip.status === 'programado' || trip.status === 'en_curso'
            // Si ya fue sustituido, no se vuelve a sustituir
            const substituted = cancelled ? replacedByName(p) : null
            return (
              <li key={p.id}>
                <div className={`list-item ${cancelled ? 'pass-cancelled' : ''}`}>
                  <div>
                    <strong>{p.full_name}</strong>
                    {cancelled && (
                      <span className="badge badge-cancelado cancel-tag">
                        Cancelado
                      </span>
                    )}
                    <div className="muted small">
                      C.I. {p.dni}
                      {p.role_name ? ` · ${p.role_name}` : ''}
                    </div>
                    {p.department && <div className="muted small">{p.department}</div>}
                    {cancelled && (
                      <div className="cancel-note">
                        Motivo: {p.cancel_reason || 'Sin comentario'}
                      </div>
                    )}
                    {substituted && (
                      <div className="muted small replaced-note">
                        Sustituido por {substituted}
                      </div>
                    )}
                    {p.observation && stripSubstitution(p.observation) && (
                      <div className="obs-note">
                        Obs: {stripSubstitution(p.observation)}
                      </div>
                    )}
                    {p.rated_at && (
                      <div className="rate-done">
                        <Stars value={p.rating ?? 0} size={13} />
                        <span className="muted small">
                          Calificado{p.rating_comment ? ` — ${p.rating_comment}` : ''}
                        </span>
                      </div>
                    )}
                    <div className="dest-tags">
                      <span className={`chip chip-origin ${originName ? 'on' : ''}`}>
                        <MapPin size={12} />{' '}
                        {originName ? up(originName) : 'Sin origen'}
                      </span>
                      {destNames.length === 0 ? (
                        <span className="assign-warning">Sin ubicación</span>
                      ) : (
                        destNames.map((n, i) => {
                          const link = links.find(
                            (l) =>
                              l.trip_passenger_id === p.id &&
                              destinations.find((d) => d.id === l.trip_destination_id)
                                ?.name === n
                          )
                          const geo =
                            link && link.latitude != null && link.longitude != null
                              ? { lat: link.latitude, lon: link.longitude }
                              : null
                          return (
                            <span key={i} className="chip on">
                              <span className="seq-mini">{i + 1}</span>
                              {up(n)}
                              {link?.arrived_at &&
                                ` · ${new Date(link.arrived_at).toLocaleTimeString('es-VE', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}`}
                              {link?.km != null && ` · ${link.km} KM`}
                              {geo && (
                                <button
                                  type="button"
                                  className="chip-maps"
                                  aria-label="Ver en mapa"
                                  onClick={() => {
                                    setMapPoint({
                                      lat: geo.lat,
                                      lon: geo.lon,
                                      title: up(n),
                                      subtitle: p.full_name,
                                    })
                                  }}
                                >
                                  <MapPin size={13} />
                                </button>
                              )}
                            </span>
                          )
                        })
                      )}
                    </div>
                  </div>

                  {(canManage || (trip.status === 'finalizado' && !cancelled)) && (
                    <div className="row gap-sm wrap">
                      {trip.status === 'programado' && !cancelled && (
                        <a
                          className="btn btn-sm btn-whatsapp notify-btn"
                          href={waUrl(passengerMessage(p), p.phone)}
                          target="_blank"
                          rel="noreferrer"
                          title={
                            p.phone
                              ? `WhatsApp de ${p.full_name}`
                              : 'Abrir WhatsApp (sin teléfono: elige el contacto)'
                          }
                        >
                          <Send size={14} /> Notificar
                        </a>
                      )}

                      {/* Viaje finalizado: pedir la calificación (link unico) */}
                      {trip.status === 'finalizado' && !cancelled && ratingUrl(p) && (
                        <a
                          className="btn btn-sm btn-whatsapp notify-btn"
                          href={waUrl(ratingMessage(p), p.phone)}
                          target="_blank"
                          rel="noreferrer"
                          title={
                            p.phone
                              ? `WhatsApp de ${p.full_name} con el link de calificación`
                              : 'Abrir WhatsApp (sin teléfono: elige el contacto)'
                          }
                        >
                          <Star size={14} /> Calificar
                        </a>
                      )}

                      {/* Cancelar (con comentario) / sustituir por otro */}
                      {canManage && (
                        <>
                          {!cancelled && (
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              onClick={() => openCancel(p)}
                            >
                              Cancelar
                            </button>
                          )}
                          {/* Un pasajero ya sustituido ya no se
                              sustituye otra vez: la cadena sigue
                              desde el activo */}
                          {!substituted && (
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => openReplace(p)}
                            >
                              {cancelled ? 'Reemplazar' : 'Sustituir'}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <h2>Incidencias ({incidents.length})</h2>
      {incidents.length === 0 ? (
        <p className="muted">Sin incidencias registradas.</p>
      ) : (
        <ul className="list">
          {incidents.map((inc) => (
            <li key={inc.id}>
              <div className="list-item">
                <div>
                  <strong>
                    {inc.trip_passenger_id
                      ? passengers.find((x) => x.id === inc.trip_passenger_id)?.full_name ??
                        'Pasajero'
                      : 'Incidencia del viaje'}
                  </strong>
                  <div>{inc.message}</div>
                  <div className="muted small">
                    {new Date(inc.created_at).toLocaleString('es-VE', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ===== Modal: cancelar pasajero (comentario obligatorio) ===== */}
      {cancelOpen && cancelPass && (
        <div className="modal-backdrop" onClick={closeCancel}>
          <div
            className="card modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Cancelar pasajero"
          >
            <h2>Cancelar pasajero</h2>
            <p className="muted small">
              <strong>{cancelPass.full_name}</strong> dejará de contar para este viaje
              (puedes sustituirlo por otra persona).
            </p>

            <label className="field">
              <span>Comentario / motivo *</span>
              <textarea
                rows={3}
                value={paxReason}
                onChange={(e) => setPaxReason(e.target.value)}
                placeholder="ej: No se presentó, viaja de vacaciones…"
                autoFocus
              />
            </label>

            {cancelErr && <div className="alert alert-error">{cancelErr}</div>}

            <div className="row gap">
              <button
                type="button"
                className="btn grow"
                onClick={closeCancel}
                disabled={cancelSaving}
              >
                Volver
              </button>
              <button
                type="button"
                className="btn btn-danger grow"
                onClick={confirmCancelPassenger}
                disabled={cancelSaving || !paxReason.trim()}
              >
                {cancelSaving ? 'Cancelando…' : 'Cancelar pasajero'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Modal: sustituir pasajero (cancela + agrega el nuevo) ===== */}
      {replaceOpen && repPass && (
        <div className="modal-backdrop" onClick={closeReplace}>
          <div
            className="card modal modal-wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Sustituir pasajero"
          >
            <h2>Sustituir a {repPass.full_name}</h2>
            <p className="muted small">
              El pasajero actual se cancela con el comentario y el nuevo toma el mismo
              origen y las mismas paradas.
            </p>

            <label className="field">
              <span>Comentario / motivo de la cancelación *</span>
              <textarea
                rows={2}
                value={repReason}
                onChange={(e) => setRepReason(e.target.value)}
                placeholder="ej: No puede viajar hoy"
              />
            </label>

            {/* Nómina de trabajadores */}
            <div className="field">
              <span>Busca el reemplazo en la nómina</span>
              <div className="row gap-sm">
                <input
                  className="grow"
                  type="search"
                  value={repQuery}
                  onChange={(e) => setRepQuery(e.target.value)}
                  onFocus={() => void loadRepEmployees()}
                  placeholder="Nombre o cédula"
                  aria-label="Buscar reemplazo en la nómina"
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => void loadRepEmployees()}
                  disabled={repLoading}
                >
                  <Search size={14} /> {repLoading ? 'Cargando…' : 'Buscar'}
                </button>
              </div>
            </div>

            {repLoading && <p className="muted small">Consultando la nómina…</p>}
            {repLoadErr && (
              <div className="alert alert-warn">
                {repLoadErr}. Puedes usar el registro manual de abajo.
              </div>
            )}

            {repResults.length > 0 && (
              <ul className="ft-results">
                {repResults.map((e) => (
                  <li key={String(e.dni)} className="ft-result">
                    <span className="ft-result-text">
                      <strong>{up(employeeFullName(e))}</strong>
                      <span className="muted small">
                        C.I. {String(e.dni)}
                        {e.role_name ? ` · ${up(e.role_name)}` : ''}
                        {e.department_name ? ` · ${up(e.department_name)}` : ''}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={repSaving}
                      onClick={() =>
                        void replacePassenger({
                          full_name: employeeFullName(e),
                          dni: String(e.dni),
                          phone: e.phone ?? null,
                          role_name: e.role_name ?? null,
                          department: e.department_name ?? null,
                          branch_id: e.branch_id ?? null,
                        })
                      }
                    >
                      Elegir
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {repQuery.trim() && !repLoading && repEmployees && repResults.length === 0 && (
              <p className="muted small">Sin coincidencias: usa el registro manual.</p>
            )}

            <div className="ft-or">
              <span>o registro manual</span>
            </div>

            <div className="row gap">
              <label className="field grow">
                <span>Nombre *</span>
                <input
                  value={repName}
                  onChange={(e) => setRepName(e.target.value)}
                  placeholder="Nombre del reemplazo"
                />
              </label>
              <label className="field grow">
                <span>Cédula *</span>
                <input
                  value={repDni}
                  onChange={(e) => setRepDni(e.target.value)}
                  inputMode="numeric"
                  placeholder="Cédula"
                />
              </label>
              <label className="field grow">
                <span>Teléfono</span>
                <input
                  value={repPhone}
                  onChange={(e) => setRepPhone(e.target.value)}
                  inputMode="tel"
                  placeholder="04xx…"
                />
              </label>
            </div>

            {repErr && <div className="alert alert-error">{repErr}</div>}

            <div className="row gap">
              <button
                type="button"
                className="btn grow"
                onClick={closeReplace}
                disabled={repSaving}
              >
                Volver
              </button>
              <button
                type="button"
                className="btn btn-primary grow"
                disabled={repSaving || !repName.trim() || !repDni.trim() || !repReason.trim()}
                onClick={() =>
                  void replacePassenger({
                    full_name: repName,
                    dni: repDni.trim(),
                    phone: repPhone.trim() || null,
                  })
                }
              >
                {repSaving ? 'Sustituyendo…' : 'Sustituir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Modal: cancelar con motivo ===== */}
      {showCancelForm && (
        <div className="modal-backdrop" onClick={() => setShowCancelForm(false)}>
          <div
            className="card modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2>Cancelar viaje #{trip.id}</h2>
            <p className="muted small">
              Se marcará como <strong>cancelado</strong> y quedará registrada una incidencia
              con el motivo.
            </p>

            <label className="field">
              <span>Motivo *</span>
              <textarea
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="ej: El vehículo presentó una falla…"
                autoFocus
              />
            </label>

            <div className="row gap">
              <button
                className="btn grow"
                onClick={() => {
                  setShowCancelForm(false)
                  setCancelReason('')
                }}
                disabled={cancelling}
              >
                Volver
              </button>
              <button
                className="btn btn-danger grow"
                onClick={cancelWithReason}
                disabled={cancelling || !cancelReason.trim()}
              >
                {cancelling ? 'Cancelando…' : 'Confirmar cancelación'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Mapa de la llegada (iframe, sin salir de la vista) ===== */}
      <MapModal point={mapPoint} onClose={() => setMapPoint(null)} />
    </div>
  )
}
