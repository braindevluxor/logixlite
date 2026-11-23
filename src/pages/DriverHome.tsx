import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  CalendarClock,
  ChevronRight,
  CircleCheck,
  MapPin,
  Play,
  Users,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { up } from '../lib/format'
import type { DriverLinkData, TripStatus } from '../lib/types'

const STATUS_LABEL: Record<TripStatus, string> = {
  programado: 'Programado',
  en_curso: 'En curso',
  finalizado: 'Finalizado',
  cancelado: 'Cancelado',
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-VE', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

/**
 * Menu publico del chofer (no requiere login):
 *   /chofer/:token
 * Dos opciones: viajes pendientes y viaje libre.
 */
export default function DriverHome() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<DriverLinkData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'menu' | 'pending'>('menu')

  const load = useCallback(async () => {
    if (!token) {
      setError('Enlace incompleto.')
      setLoading(false)
      return
    }
    const { data: rpc, error: rpcErr } = await supabase.rpc('driver_link_get', {
      p_token: token,
    })
    setLoading(false)
    if (rpcErr) {
      setError(
        rpcErr.message.includes('Enlace inválido')
          ? 'Este enlace no es válido o expiró.'
          : `Error: ${rpcErr.message}`
      )
      return
    }
    setData(rpc as unknown as DriverLinkData)
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <div className="driver-page">
        <div className="loading-screen">Cargando…</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="driver-page">
        <div className="driver-main">
          <div className="driver-card">
            <div className="brand brand-lg">
              <img src="/logo-mark.png" alt="" className="brand-logo brand-logo-lg" />
              LOGIXLITE
            </div>
            <div className="alert alert-error">{error ?? 'Enlace no encontrado'}</div>
          </div>
        </div>
      </div>
    )
  }

  const { driver, trips, free_trip } = data
  const libreLabel = free_trip
    ? `${free_trip.passengers.length} pasajero(s) · ${free_trip.stops.length} parada(s)`
    : 'Registra quienes van contigo y cada parada'

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
      </header>

      <main className="driver-main">
        {/* Saludo */}
        <div className="driver-card dm-hello">
          <span className="muted small">Chofer</span>
          <strong className="dm-name">{driver.full_name}</strong>
          <span className="muted small">C.I. {driver.dni}</span>
        </div>

        {/* Viaje libre activo: acceso directo */}
        {free_trip && (
          <button
            type="button"
            className="menu-option mo-live"
            onClick={() => navigate(`/chofer/${token}/libre`)}
          >
            <span className="mo-icon mo-icon-live">
              <CircleCheck size={22} />
            </span>
            <span className="mo-text">
              <span className="mo-title">Viaje libre en curso</span>
              <span className="mo-sub">{libreLabel}</span>
            </span>
            <ChevronRight size={18} />
          </button>
        )}

        {/* Menu principal */}
        <div className="driver-menu">
          <button type="button" className="menu-option" onClick={() => setView('pending')}>
            <span className="mo-icon">
              <CalendarClock size={22} />
            </span>
            <span className="mo-text">
              <span className="mo-title">Viajes pendientes</span>
              <span className="mo-sub">
                {trips.length} viaje(s) programado(s) o en curso
              </span>
            </span>
            <ChevronRight size={18} />
          </button>

          <button
            type="button"
            className="menu-option"
            onClick={() => navigate(`/chofer/${token}/libre`)}
          >
            <span className="mo-icon">
              <Play size={22} />
            </span>
            <span className="mo-text">
              <span className="mo-title">Viaje libre</span>
              <span className="mo-sub">{libreLabel}</span>
            </span>
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Lista de viajes pendientes */}
        {view === 'pending' && (
          <section className="dm-section">
            <div className="row spread">
              <h2 style={{ margin: 0 }}>Viajes pendientes</h2>
              <button type="button" className="btn btn-sm" onClick={() => setView('menu')}>
                <ArrowLeft size={13} /> Volver
              </button>
            </div>

            {trips.length === 0 ? (
              <p className="muted">No tienes viajes pendientes.</p>
            ) : (
              <div className="dm-list">
                {trips.map((t) => (
                  <article key={t.id} className="driver-card trip-mini">
                    <div className="row spread">
                      <span className={`badge badge-${t.status}`}>
                        {STATUS_LABEL[t.status]}
                      </span>
                      <span className="muted small">{fmtDateTime(t.departure_at)}</span>
                    </div>

                    <div className="tm-route">
                      <MapPin size={14} />
                      {t.destinations.length > 0
                        ? t.destinations.map((n) => up(n)).join(' → ')
                        : 'Sin paradas asignadas'}
                    </div>

                    <div className="tm-meta">
                      <span>
                        <Users size={13} /> {t.passengers} pasajero(s)
                      </span>
                      {t.vehicle && <span>{t.vehicle}</span>}
                      {t.branch && <span>{up(t.branch)}</span>}
                    </div>

                    {t.notes && <div className="muted small">{t.notes}</div>}

                    {t.share_token ? (
                      <Link className="btn btn-primary btn-block" to={`/viaje/${t.share_token}`}>
                        Abrir viaje
                      </Link>
                    ) : (
                      <button type="button" className="btn btn-block" disabled>
                        Este viaje no tiene link
                      </button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
