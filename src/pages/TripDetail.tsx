import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  Copy,
  Link2,
  MapPin,
  Pencil,
  Send,
  Share2,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { up } from '../lib/format'
import type {
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
      message: `Viaje cancelado: ${cancelReason.trim()}`,
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
            const inDest = passengers.filter((p) =>
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

      <h2>
        Pasajeros ({passengers.length}
        {trip.vehicle ? ` / ${trip.vehicle.capacity}` : ''})
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
            return (
              <li key={p.id}>
                <div className="list-item">
                  <div>
                    <strong>{p.full_name}</strong>
                    <div className="muted small">
                      C.I. {p.dni}
                      {p.role_name ? ` · ${p.role_name}` : ''}
                    </div>
                    {p.department && <div className="muted small">{p.department}</div>}
                    {p.observation && (
                      <div className="obs-note">Obs: {p.observation}</div>
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
                          const mapsUrl =
                            link && link.latitude != null && link.longitude != null
                              ? `https://www.google.com/maps?q=${link.latitude},${link.longitude}`
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
                              {mapsUrl && (
                                <a
                                  href={mapsUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="chip-maps"
                                  aria-label="Ver en mapa"
                                >
                                  <MapPin size={13} />
                                </a>
                              )}
                            </span>
                          )
                        })
                      )}
                    </div>
                  </div>

                  {trip.status === 'programado' && (
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
    </div>
  )
}
