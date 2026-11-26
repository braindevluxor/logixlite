import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BookOpen, CalendarClock, ChevronRight, CircleCheck, Play } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { initials } from '../lib/format'
import SpotlightTour, { type TourStep } from '../components/SpotlightTour'
import InstallAppButton from '../components/InstallAppButton'
import type { DriverLinkData } from '../lib/types'

/** Pasos del tour interactivo del menu del chofer */
const TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="hello"]',
    title: 'Tu perfil',
    description:
      'Aquí ves tu nombre y tu cédula. Si algo no coincide, avisa a la oficina.',
  },
  {
    target: '[data-tour="live"]',
    title: 'Viaje libre en curso',
    description:
      'Si tienes un viaje libre activo aparece aquí, con la cantidad de pasajeros y paradas registradas. Tócalo para entrar.',
  },
  {
    target: '[data-tour="pending"]',
    title: 'Viajes pendientes',
    description:
      'Toca esta tarjeta para abrir la pantalla con tus viajes asignados: estado, fecha y hora, paradas, pasajeros, vehículo y sucursal.',
  },
  {
    target: '[data-tour="libre"]',
    title: 'Viaje libre',
    description:
      'Entra aquí para registrar a quienes llevas y cada parada del recorrido, sin necesidad de un viaje asignado.',
  },
]

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

  const { driver, trips, free_trip } = data
  const libreLabel = free_trip
    ? `${free_trip.passengers.length} pasajero(s) · ${free_trip.stops.length} parada(s)`
    : 'Registra quienes van contigo y cada parada'

  /** Iniciales del chofer para el avatar del saludo */
  const ini = initials(driver.full_name) || 'C'

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
          <InstallAppButton />
          <button
            type="button"
            className="btn-tutorial"
            onClick={() => setShowTut(true)}
          >
            <BookOpen size={14} /> Tutorial
          </button>
        </div>
      </header>

      <main className="driver-main">
        {/* Saludo */}
        <div className="driver-card dm-hello" data-tour="hello">
          <span className="dm-avatar" aria-hidden="true">
            {ini}
          </span>
          <span className="dm-hello-text">
            <span className="dm-role">Chofer</span>
            <strong className="dm-name">{driver.full_name}</strong>
            <span className="dm-dni">C.I. {driver.dni}</span>
          </span>
        </div>

        {/* Viaje libre activo: acceso directo */}
        {free_trip && (
          <button
            type="button"
            className="menu-option mo-live"
            data-tour="live"
            onClick={() => navigate(`/chofer/${token}/libre`)}
          >
            <span className="mo-icon">
              <CircleCheck size={24} />
            </span>
            <span className="mo-text">
              <span className="mo-title">Viaje libre en curso</span>
              <span className="mo-sub">{libreLabel}</span>
            </span>
            <span className="mo-badge">En curso</span>
            <ChevronRight className="mo-arrow" size={18} />
          </button>
        )}

        {/* Menu principal: tarjetas */}
        <div className="driver-menu">
          <button
            type="button"
            className="menu-option"
            data-tour="pending"
            onClick={() => navigate(`/chofer/${token}/pendientes`)}
          >
            <span className="mo-icon">
              <CalendarClock size={24} />
            </span>
            <span className="mo-text">
              <span className="mo-title">Viajes pendientes</span>
              <span className="mo-sub">
                {trips.length} viaje(s) programado(s) o en curso
              </span>
            </span>
            {trips.length > 0 && <span className="mo-count">{trips.length}</span>}
            <ChevronRight className="mo-arrow" size={18} />
          </button>

          <button
            type="button"
            className="menu-option"
            data-tour="libre"
            onClick={() => navigate(`/chofer/${token}/libre`)}
          >
            <span className="mo-icon">
              <Play size={24} />
            </span>
            <span className="mo-text">
              <span className="mo-title">Viaje libre</span>
              <span className="mo-sub">{libreLabel}</span>
            </span>
            <ChevronRight className="mo-arrow" size={18} />
          </button>
        </div>
      </main>

      {/* Tutorial interactivo con resaltado */}
      <SpotlightTour open={showTut} steps={TOUR_STEPS} onClose={() => setShowTut(false)} />
    </div>
  )
}
