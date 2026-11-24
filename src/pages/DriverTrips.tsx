import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  BookOpen,
  CalendarClock,
  ChevronRight,
  CircleCheck,
  MapPin,
  Users,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { up } from '../lib/format'
import SpotlightTour, { type TourStep } from '../components/SpotlightTour'
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

/** Pasos del tour de la pantalla de viajes pendientes */
const TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="list"]',
    title: 'Tus viajes',
    description:
      'Cada tarjeta es un viaje asignado: estado, fecha y hora de salida, paradas, cantidad de pasajeros, vehículo y sucursal.',
  },
  {
    target: '[data-tour="open"]',
    title: 'Abrir viaje',
    description:
      'Entra al viaje para iniciarlo y registrar la llegada de cada pasajero con hora, GPS y kilometraje.',
  },
  {
    target: '[data-tour="menu"]',
    title: 'Volver al menú',
    description:
      'Regresa a la pantalla principal con tus dos opciones: viajes pendientes y viaje libre.',
  },
  {
    target: '[data-tour="tutorial"]',
    title: 'Botón Tutorial',
    description:
      'Este botón vuelve a abrir el tour con el paso a paso del sistema en cualquier momento.',
  },
]

/**
 * Pantalla propia de viajes pendientes del chofer (no requiere login):
 *   /chofer/:token/pendientes
 */
export default function DriverTrips() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<DriverLinkData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Tutorial interactivo (boton de la barra superior)
  const [showTut, setShowTut] = useState(false)

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

  const { trips } = data

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
        <div className="row gap-sm">
          <button
            type="button"
            className="btn-tutorial"
            data-tour="tutorial"
            onClick={() => setShowTut(true)}
          >
            <BookOpen size={14} /> Tutorial
          </button>
          <Link className="btn btn-primary" to={`/chofer/${token}`} data-tour="menu">
            <ArrowLeft size={15} /> Menú
          </Link>
        </div>
      </header>

      <main className="driver-main">
        <div className="dm-section-head">
          <h2>Viajes pendientes</h2>
          <span className="muted small">
            {trips.length} viaje(s) programado(s) o en curso
          </span>
        </div>

        {trips.length === 0 ? (
          <div className="dm-empty" data-tour="list">
            <CircleCheck size={30} />
            <p>Sin viajes pendientes</p>
            <span className="muted small">
              Cuando te asignen un viaje aparecerá aquí.
            </span>
          </div>
        ) : (
          <div className="dm-list" data-tour="list">
            {trips.map((t) => (
              <article key={t.id} className="driver-card trip-mini">
                <div className="tm-top">
                  <span className={`badge badge-${t.status}`}>
                    {STATUS_LABEL[t.status]}
                  </span>
                  <span className="tm-date">
                    <CalendarClock size={13} />
                    {fmtDateTime(t.departure_at)}
                  </span>
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

                {t.notes && <div className="tm-notes">{t.notes}</div>}

                {t.share_token ? (
                  <Link
                    className="btn btn-primary btn-block"
                    data-tour="open"
                    to={`/viaje/${t.share_token}`}
                  >
                    Abrir viaje <ChevronRight size={15} />
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
      </main>

      {/* Tutorial interactivo con resaltado */}
      <SpotlightTour open={showTut} steps={TOUR_STEPS} onClose={() => setShowTut(false)} />
    </div>
  )
}
