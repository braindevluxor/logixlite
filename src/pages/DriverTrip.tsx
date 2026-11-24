import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Ban,
  BookOpen,
  Check,
  CircleCheck,
  Flag,
  Gauge,
  MapPin,
  Play,
  Send,
  TriangleExclamationPoint,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { up } from '../lib/format'
import DriverTutorial from '../components/DriverTutorial'
import type {
  SharedTrip,
  TripPassengerDestination,
  TripStatus,
} from '../lib/types'

const STATUS_LABEL: Record<TripStatus, string> = {
  programado: 'Programado',
  en_curso: 'En curso',
  finalizado: 'Finalizado',
  cancelado: 'Cancelado',
}

function fmtTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('es-VE', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface GeoState {
  lat: number | null
  lon: number | null
  accuracy: number | null
  status: 'idle' | 'loading' | 'ok' | 'error'
  message?: string
}

const GEO_IDLE: GeoState = { lat: null, lon: null, accuracy: null, status: 'idle' }

/**
 * Vista pública del viaje para el chofer.
 * No requiere login: el acceso lo da el token secreto de la URL.
 * Ruta: /viaje/:token
 */
export default function DriverTrip() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<SharedTrip | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Tutorial paso a paso (boton de la barra superior)
  const [showTut, setShowTut] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  const [toast, setToast] = useState<{ msg: string; icon: 'check' | 'flag' | null } | null>(
    null
  )

  // ---- Modal de llegada (hora + GPS + KM) ----
  type SharePassenger = SharedTrip['passengers'][number]
  const [arrival, setArrival] = useState<{
    link: TripPassengerDestination
    passenger: SharePassenger
    destName: string
  } | null>(null)
  const [geo, setGeo] = useState<GeoState>(GEO_IDLE)
  const [kmValue, setKmValue] = useState('')
  const [savingArrival, setSavingArrival] = useState(false)
  const geoRequestedFor = useRef<number | null>(null)

  // ---- Iniciar viaje desde el link del chofer ----
  const [starting, setStarting] = useState(false)

  async function startTrip() {
    setStarting(true)
    const { data: rpc, error: rpcErr } = await supabase.rpc('trip_share_start', {
      p_token: token,
    })
    setStarting(false)
    if (rpcErr) {
      flash(`Error: ${rpcErr.message}`)
      return
    }
    const row = rpc as { status: TripStatus }
    setData((prev) =>
      prev ? { ...prev, trip: { ...prev.trip, status: row.status } } : prev
    )
    flash('Viaje iniciado', 'check')
  }

  // ---- Cancelar viaje desde el link del chofer (con incidencia) ----
  const [showCancelForm, setShowCancelForm] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  async function cancelTrip() {
    if (!cancelReason.trim()) {
      flash('Describe el motivo de la cancelación')
      return
    }
    setCancelling(true)
    const { data: rpc, error: rpcErr } = await supabase.rpc('trip_share_cancel', {
      p_token: token,
      p_reason: cancelReason.trim(),
    })
    setCancelling(false)
    if (rpcErr) {
      flash(`Error: ${rpcErr.message}`)
      return
    }
    const row = rpc as {
      status: TripStatus
      incident: {
        id: number
        trip_passenger_id: number | null
        message: string
        created_at: string
      } | null
    }
    setData((prev) =>
      prev
        ? {
            ...prev,
            trip: { ...prev.trip, status: row.status },
            incidents: row.incident ? [row.incident, ...prev.incidents] : prev.incidents,
          }
        : prev
    )
    setShowCancelForm(false)
    setCancelReason('')
    flash('Viaje cancelado')
  }

  // ---- Novedad rápida desde un pasajero ----
  const [quickIncident, setQuickIncident] = useState<{
    passengerId: number
    passengerName: string
  } | null>(null)
  const [quickMsg, setQuickMsg] = useState('')
  const [quickBusy, setQuickBusy] = useState(false)

  const load = useCallback(async () => {
    if (!token) {
      setError('Enlace incompleto.')
      setLoading(false)
      return
    }
    const { data: rpc, error: rpcErr } = await supabase.rpc('trip_share_get', {
      p_token: token,
    })
    setLoading(false)
    if (rpcErr) {
      setError(
        rpcErr.message.includes('Token inválido')
          ? 'Este enlace no es válido o expiró.'
          : `Error: ${rpcErr.message}`
      )
      return
    }
    setData(rpc as unknown as SharedTrip)
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  function flash(msg: string, icon?: 'check' | 'flag') {
    setToast({ msg, icon: icon ?? null })
    window.setTimeout(() => setToast(null), 2800)
  }

  // ---- GPS ----
  const requestGeo = useCallback(() => {
    if (!navigator.geolocation) {
      setGeo({
        ...GEO_IDLE,
        status: 'error',
        message: 'Este dispositivo no soporta GPS',
      })
      return
    }
    setGeo({ ...GEO_IDLE, status: 'loading' })
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setGeo({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          status: 'ok',
        }),
      (err) =>
        setGeo({
          ...GEO_IDLE,
          status: 'error',
          message:
            err.code === err.PERMISSION_DENIED
              ? 'Permiso de ubicación denegado'
              : 'No se pudo obtener la ubicación',
        }),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    )
  }, [])

  // ---- Abrir/cerrar modal de llegada ----
  function openArrival(
    link: TripPassengerDestination,
    passenger: SharePassenger,
    destName: string
  ) {
    setArrival({ link, passenger, destName })
    setKmValue('')
    setGeo(GEO_IDLE)
    geoRequestedFor.current = link.id
    requestGeo()
  }

  function closeArrival() {
    setArrival(null)
    setKmValue('')
    setGeo(GEO_IDLE)
    geoRequestedFor.current = null
  }

  // ---- Confirmar llegada ----
  async function confirmArrival() {
    if (!arrival || !data) return

    const trackKm = !!data.trip.track_km
    if (trackKm) {
      const n = Number(kmValue)
      if (!kmValue.trim() || Number.isNaN(n) || n < 0) {
        flash('Indica los KM del vehículo')
        return
      }
    }

    setSavingArrival(true)
    const { data: rpc, error: rpcErr } = await supabase.rpc('trip_share_arrive', {
      p_token: token,
      p_link_id: arrival.link.id,
      p_arrived: true,
      p_km: trackKm && kmValue.trim() ? Number(kmValue) : null,
      p_lat: geo.status === 'ok' ? geo.lat : null,
      p_lon: geo.status === 'ok' ? geo.lon : null,
      p_accuracy: geo.status === 'ok' ? geo.accuracy : null,
    })
    setSavingArrival(false)

    if (rpcErr) {
      flash(`Error: ${rpcErr.message}`)
      return
    }

    const row = rpc as TripPassengerDestination & { trip_status?: TripStatus }
    const newStatus = row.trip_status ?? data.trip.status
    setData((prev) =>
      prev
        ? {
            ...prev,
            trip: { ...prev.trip, status: newStatus },
            links: prev.links.map((l) => (l.id === row.id ? row : l)),
          }
        : prev
    )
    closeArrival()
    if (newStatus === 'finalizado' && data.trip.status !== 'finalizado') {
      flash('¡Todas las llegadas registradas! Viaje finalizado', 'flag')
    } else {
      flash(
        `Llegada registrada ${fmtTime(row.arrived_at)}${
          row.km != null ? ` · ${row.km} KM` : ''
        }`,
        'check'
      )
    }
  }

  // ---- Desmarcar llegada ----
  async function unmarkArrive(link: TripPassengerDestination) {
    setBusy(link.id)
    const { data: rpc, error: rpcErr } = await supabase.rpc('trip_share_arrive', {
      p_token: token,
      p_link_id: link.id,
      p_arrived: false,
    })
    setBusy(null)
    if (rpcErr) {
      flash(`Error: ${rpcErr.message}`)
      return
    }
    const row = rpc as TripPassengerDestination & { trip_status?: TripStatus }
    const newStatus = row.trip_status ?? data?.trip.status
    setData((prev) =>
      prev
        ? {
            ...prev,
            trip: { ...prev.trip, status: newStatus ?? prev.trip.status },
            links: prev.links.map((l) =>
              l.id === link.id
                ? {
                    ...l,
                    arrived_at: null,
                    latitude: null,
                    longitude: null,
                    gps_accuracy: null,
                    km: null,
                  }
                : l
            ),
          }
        : prev
    )
    flash('Llegada desmarcada')
  }

  // ---- Novedad rápida desde la fila del pasajero ----
  async function sendQuickIncident() {
    if (!quickIncident || !quickMsg.trim()) return
    setQuickBusy(true)
    const { data: rpc, error: rpcErr } = await supabase.rpc('trip_share_incident', {
      p_token: token,
      p_passenger_id: quickIncident.passengerId,
      p_message: quickMsg.trim(),
    })
    setQuickBusy(false)
    if (rpcErr) {
      flash(`Error: ${rpcErr.message}`)
      return
    }
    const row = rpc as {
      id: number
      trip_passenger_id: number | null
      message: string
      created_at: string
    }
    setData((prev) => (prev ? { ...prev, incidents: [row, ...prev.incidents] } : prev))
    setQuickMsg('')
    setQuickIncident(null)
    flash('Novedad enviada', 'check')
  }

  if (loading) {
    return (
      <div className="driver-page">
        <div className="loading-screen">Cargando viaje…</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="driver-page">
        <div className="driver-card">
          <div className="brand brand-lg">
            <img src="/logo-mark.png" alt="" className="brand-logo brand-logo-lg" />
            LOGIXLITE
          </div>
          <div className="alert alert-error">{error ?? 'Viaje no encontrado'}</div>
        </div>
      </div>
    )
  }

  const { trip, branch, vehicle, driver, passengers, destinations, links, incidents } = data

  const passById = new Map(passengers.map((p) => [p.id, p]))
  const trackKm = !!trip.track_km

  const totalAssignments = links.length
  const arrivedCount = links.filter((l) => l.arrived_at).length
  const pct = totalAssignments > 0 ? Math.round((arrivedCount / totalAssignments) * 100) : 0

  const byDest = destinations.map((d) => ({
    dest: d,
    items: links
      .filter((l) => l.trip_destination_id === d.id)
      .map((l) => ({ link: l, passenger: passById.get(l.trip_passenger_id) }))
      .filter((x) => x.passenger)
      .sort((a, b) => a.passenger!.full_name.localeCompare(b.passenger!.full_name)),
  }))

  return (
    <div className="driver-page">
      <header className="topbar">
        <span className="brand">
          <img
            src="/logo-white.webp"
            alt="LOGIXLITE"
            className="brand-logo brand-logo-white"
          />
          LOGIXLITE
        </span>
        <span className={`badge badge-${trip.status}`}>{STATUS_LABEL[trip.status]}</span>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setShowTut(true)}
        >
          <BookOpen size={15} /> Tutorial
        </button>
      </header>

      <main className="driver-main">
        <div className="driver-card">
          <div className="driver-meta">
            <div>
              <span className="muted small">Sucursal</span>
              <strong>{branch?.name ?? '—'}</strong>
            </div>
            <div>
              <span className="muted small">Vehículo</span>
              <strong>{vehicle?.plate ?? '—'}</strong>
            </div>
            <div>
              <span className="muted small">Chofer</span>
              <strong>{driver?.full_name ?? '—'}</strong>
            </div>
            <div>
              <span className="muted small">Salida</span>
              <strong>
                {new Date(trip.departure_at).toLocaleString('es-VE', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </strong>
            </div>
          </div>

          <div className="driver-progress">
            <div className="row spread">
              <span>
                Llegadas: <strong>{arrivedCount}</strong> / {totalAssignments}
              </span>
              <span className="muted small">{pct}%</span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
            {trackKm && (
              <p className="muted small track-km-note" style={{ margin: '0.5rem 0 0' }}>
                <Gauge size={14} /> Este viaje registra kilometraje en cada llegada.
              </p>
            )}
          </div>

          {/* Acción principal según estado */}
          {trip.status === 'programado' && (
            <div className="start-box">
              <p className="start-hint">
                El viaje aún no ha iniciado. Las llegadas se habilitan al iniciar.
              </p>
              <button
                className="btn btn-primary btn-block"
                onClick={startTrip}
                disabled={starting}
              >
                <Play size={16} /> {starting ? 'Iniciando…' : 'Iniciar viaje'}
              </button>
            </div>
          )}

          {(trip.status === 'programado' || trip.status === 'en_curso') && (
            <div className="cancel-box">
              {!showCancelForm ? (
                <button
                  className="btn btn-danger btn-block"
                  onClick={() => setShowCancelForm(true)}
                >
                  <Ban size={15} /> Cancelar viaje
                </button>
              ) : (
                <div className="incident-form">
                  <label className="field">
                    <span>Motivo de la cancelación *</span>
                    <textarea
                      rows={3}
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      placeholder="ej: Falla mecánica, el vehículo no arrancó…"
                      autoFocus
                    />
                  </label>
                  <p className="muted small">
                    Quedará registrado como incidencia del viaje.
                  </p>
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
                      onClick={cancelTrip}
                      disabled={cancelling || !cancelReason.trim()}
                    >
                      {cancelling ? 'Cancelando…' : 'Confirmar cancelación'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {trip.status === 'cancelado' && (
            <div className="alert alert-error" style={{ margin: '0.8rem 0 0' }}>
              <strong>Viaje cancelado.</strong>
              {(() => {
                const reason = incidents.find(
                  (i) =>
                    i.trip_passenger_id === null &&
                    i.message.toLowerCase().startsWith('viaje cancelado')
                )
                return reason ? <div>{reason.message}</div> : null
              })()}
            </div>
          )}
        </div>

        {byDest.map(({ dest, items }) => (
          <div className="driver-card" key={dest.id}>
            <h2 className="driver-dest-title">
              {dest.position}. {up(dest.name)}
              {dest.notes && <span className="muted small"> — {dest.notes}</span>}
            </h2>
            {items.length === 0 ? (
              <p className="muted small">Sin pasajeros para este destino.</p>
            ) : (
              <ul className="list">
                {items.map(({ link, passenger }) => {
                  const arrived = !!link.arrived_at
                  const mapsUrl =
                    link.latitude != null && link.longitude != null
                      ? `https://www.google.com/maps?q=${link.latitude},${link.longitude}`
                      : null
                  const passIncidents = incidents.filter(
                    (inc) => inc.trip_passenger_id === passenger!.id
                  )
                  const originName = passenger!.origin_destination_id
                    ? destinations.find(
                        (d) => d.id === passenger!.origin_destination_id
                      )?.name
                    : null
                  return (
                    <li key={link.id}>
                      <div className={`driver-pass ${arrived ? 'arrived' : ''}`}>
                        <div>
                          <strong>{passenger!.full_name}</strong>
                          <div className="muted small">
                            C.I. {passenger!.dni}
                            {arrived && ` · llegó ${fmtTime(link.arrived_at)}`}
                            {arrived && link.km != null && ` · ${link.km} KM`}
                          </div>
                          {originName && (
                            <div className="origin-line">
                              <MapPin size={13} /> Sube en: <strong>{up(originName)}</strong>
                            </div>
                          )}
                          {arrived && mapsUrl && (
                            <a
                              className="muted small maps-link"
                              href={mapsUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <MapPin size={13} /> {Math.round(link.gps_accuracy ?? 0)} m de
                              precisión
                            </a>
                          )}

                          {/* Novedades de ESTE pasajero */}
                          {passIncidents.length > 0 && (
                            <ul className="pass-incidents">
                              {passIncidents.map((inc) => (
                                <li key={inc.id}>
                                  <TriangleExclamationPoint size={13} />
                                  <span>
                                    {inc.message}
                                    <span className="muted"> · {fmtTime(inc.created_at)}</span>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div className="pass-actions">
                          <button
                            className="btn btn-sm btn-novedad"
                            disabled={trip.status === 'cancelado'}
                            onClick={() =>
                              setQuickIncident({
                                passengerId: passenger!.id,
                                passengerName: passenger!.full_name,
                              })
                            }
                          >
                            <TriangleExclamationPoint size={14} /> Novedad
                          </button>
                          {arrived ? (
                            <button
                              className="btn btn-arrived"
                              disabled={busy === link.id || trip.status === 'cancelado'}
                              onClick={() => unmarkArrive(link)}
                              title="Tocar para desmarcar"
                            >
                              {busy === link.id ? (
                                '…'
                              ) : (
                                <>
                                  <Check size={15} /> Llegó
                                </>
                              )}
                            </button>
                          ) : (
                            <button
                              className="btn btn-primary"
                              disabled={trip.status !== 'en_curso'}
                              onClick={() =>
                                openArrival(link, passenger!, dest.name)
                              }
                              title={
                                trip.status === 'programado'
                                  ? 'Primero inicia el viaje'
                                  : undefined
                              }
                            >
                              {trip.status === 'programado'
                                ? 'Esperando inicio'
                                : 'Marcar llegada'}
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        ))}

        <p className="muted small driver-foot">
          Enlace privado del viaje #{trip.id} · no lo compartas con personas ajenas.
        </p>
      </main>

      {/* ===== Modal de llegada: hora + GPS + KM ===== */}
      {arrival && (
        <div className="modal-backdrop" onClick={closeArrival}>
          <div
            className="card modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2>Registrar llegada</h2>
            <dl className="kv">
              <dt>Pasajero</dt>
              <dd>{arrival.passenger.full_name}</dd>
              <dt>Destino</dt>
              <dd>{arrival.destName}</dd>
              <dt>Hora</dt>
              <dd>
                {new Date().toLocaleTimeString('es-VE', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                <span className="muted small">(se guarda al confirmar)</span>
              </dd>
            </dl>

            {/* GPS */}
            <div className={`geo-box geo-${geo.status}`}>
              {geo.status === 'loading' && (
                <span>
                  <MapPin size={16} /> Obteniendo ubicación…
                </span>
              )}
              {geo.status === 'ok' && (
                <span>
                  <CircleCheck size={16} /> Ubicación lista · precisión ±
                  {Math.round(geo.accuracy ?? 0)} m
                  <button type="button" className="btn btn-sm" onClick={requestGeo}>
                    Repetir
                  </button>
                </span>
              )}
              {geo.status === 'error' && (
                <span>
                  <TriangleExclamationPoint size={16} /> {geo.message}
                  <button type="button" className="btn btn-sm" onClick={requestGeo}>
                    Reintentar
                  </button>
                </span>
              )}
              {geo.status === 'idle' && (
                <span>
                  <MapPin size={16} /> Solicitando ubicación…
                </span>
              )}
            </div>

            {/* KM (solo si el viaje lo activó) */}
            {trackKm && (
              <label className="field">
                <span>Kilometraje del vehículo *</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={kmValue}
                  onChange={(e) => setKmValue(e.target.value)}
                  placeholder="ej: 125430.5"
                  autoFocus
                />
              </label>
            )}

            {geo.status === 'error' && (
              <p className="muted small">
                Puedes registrar la llegada igual, pero sin ubicación.
              </p>
            )}

            <div className="row gap">
              <button className="btn" onClick={closeArrival} disabled={savingArrival}>
                Cancelar
              </button>
              <button
                className="btn btn-primary grow"
                onClick={confirmArrival}
                disabled={savingArrival || geo.status === 'loading'}
              >
                {savingArrival
                  ? 'Guardando…'
                  : geo.status === 'loading'
                    ? 'Esperando GPS…'
                    : 'Confirmar llegada'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Modal de novedad rápida por pasajero ===== */}
      {quickIncident && (
        <div className="modal-backdrop" onClick={() => setQuickIncident(null)}>
          <div
            className="card modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2>Novedad</h2>
            <dl className="kv">
              <dt>Pasajero</dt>
              <dd>{quickIncident.passengerName}</dd>
            </dl>

            <label className="field">
              <span>Descripción *</span>
              <textarea
                rows={4}
                value={quickMsg}
                onChange={(e) => setQuickMsg(e.target.value)}
                placeholder="ej: No se presentó en la parada, llegó tarde, solicitó bajarse en otro punto…"
                autoFocus
              />
            </label>

            <div className="row gap">
              <button
                className="btn"
                onClick={() => {
                  setQuickIncident(null)
                  setQuickMsg('')
                }}
                disabled={quickBusy}
              >
                Cancelar
              </button>
              <button
                className="btn btn-primary grow"
                onClick={sendQuickIncident}
                disabled={quickBusy || !quickMsg.trim()}
              >
                {quickBusy ? 'Enviando…' : <><Send size={15} /> Enviar novedad</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast">
          {toast.icon === 'flag' ? (
            <Flag size={16} />
          ) : toast.icon === 'check' ? (
            <Check size={16} />
          ) : null}
          {toast.msg}
        </div>
      )}

      {/* Tutorial paso a paso */}
      <DriverTutorial open={showTut} onClose={() => setShowTut(false)} />
    </div>
  )
}
