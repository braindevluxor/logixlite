import {
  Navigate,
  Route,
  Routes,
  NavLink,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Bus,
  Calendar,
  CalendarDays,
  Car,
  Fuel,
  House,
  IdCard,
  RotateCcw,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from './auth/AuthContext'
import { useSearch } from './search/SearchContext'
import { useDateFilter } from './date/DateFilterContext'
import { quickRanges } from './lib/dates'
import TotpGate from './auth/TotpGate'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import DayPlan from './pages/DayPlan'
import Vehicles from './pages/Vehicles'
import Drivers from './pages/Drivers'
import Branches from './pages/Branches'
import FuelPage from './pages/Fuel'
import Trips from './pages/Trips'
import TripCreate from './pages/TripCreate'
import TripDetail from './pages/TripDetail'
import DriverTrip from './pages/DriverTrip'
import DriverHome from './pages/DriverHome'
import DriverTrips from './pages/DriverTrips'
import FreeTrip from './pages/FreeTrip'
import RateTrip from './pages/RateTrip'

/**
 * Items del menu: se renderizan en la barra LATERAL (escritorio,
 * >= 900px) y en la barra INFERIOR (movil), con los mismos links.
 * Sucursales queda oculto: se entra escribiendo /sucursales
 * (protegido con TOTP en TotpGate).
 */
const NAV_ITEMS: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/', label: 'Dashboard', icon: House, end: true },
  { to: '/planificacion', label: 'Plan', icon: CalendarDays },
  { to: '/viajes', label: 'Viajes', icon: Bus },
  { to: '/vehiculos', label: 'Vehículos', icon: Car },
  { to: '/combustible', label: 'Combustible', icon: Fuel },
  { to: '/choferes', label: 'Choferes', icon: IdCard },
]

function Protected({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <div className="loading-screen">Cargando…</div>
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}

function Shell({ children }: { children: ReactNode }) {
  const { session, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { query, setQuery } = useSearch()
  const { from, to, setFrom, setTo, reset } = useDateFilter()
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Filtro de fechas: vive en la barra y solo se muestra en el
  // dashboard (la unica pantalla que lo usa)
  const showDateFilter = location.pathname === '/'
  const dateRanges = showDateFilter ? quickRanges() : []
  const activeQuick =
    dateRanges.find((r) => r.from === from && r.to === to)?.label ?? null

  // Buscador global solo en las pantallas que lo usan
  const searchPlaceholder =
    location.pathname === '/vehiculos'
      ? 'Buscar por placa, marca o modelo…'
      : location.pathname === '/combustible'
        ? 'Buscar por placa o estación…'
        : location.pathname === '/choferes'
          ? 'Buscar por nombre o cédula…'
          : null

  // En movil, al desplegar el campo se enfoca automaticamente
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  // Mismo listado para el menu lateral (solo iconos) y el inferior
  const navLinks = NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
    <NavLink
      key={to}
      to={to}
      end={end}
      className={({ isActive }) => (isActive ? 'active' : '')}
    >
      <span className="nav-icon">
        <Icon size={20} />
      </span>
      <span className="nav-label">{label}</span>
      {/* Etiqueta emergente: solo se estiliza en la barra lateral */}
      <span className="nav-tip" aria-hidden="true">
        {label}
      </span>
    </NavLink>
  ))

  return (
    <div className="app">
      {/* Menu lateral de iconos: visible solo en escritorio (>= 900px) */}
      <nav className="sidenav" aria-label="Menú principal">
        {navLinks}
      </nav>

      <header className="topbar">
        <span className="brand">
          <img
            src="/logo-white.webp"
            alt="LOGIXLITE"
            className="brand-logo brand-logo-white"
          />
          LOGIXLITE
        </span>

        {searchPlaceholder && (
          <div className={`topbar-search ${searchOpen ? 'open' : ''}`}>
            <Search size={15} aria-hidden />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setSearchOpen(false)
              }}
            />
          </div>
        )}

        {showDateFilter && (
          <div className="topbar-dates">
            <div className="date-quick">
              <Calendar size={15} className="date-filter-icon" />
              {dateRanges.map((r) => (
                <button
                  key={r.label}
                  type="button"
                  className={`pill ${activeQuick === r.label ? 'active' : ''}`}
                  onClick={() => {
                    setFrom(r.from)
                    setTo(r.to)
                  }}
                >
                  {r.label}
                </button>
              ))}
              {activeQuick && (
                <button
                  type="button"
                  className="pill pill-reset"
                  onClick={reset}
                  title="Restablecer"
                >
                  <RotateCcw size={13} />
                </button>
              )}
            </div>

            <div className="topbar-date-group">
              <input
                type="date"
                className="topbar-date"
                aria-label="Desde"
                value={from}
                max={to}
                onChange={(e) => e.target.value && setFrom(e.target.value)}
              />
              <span className="date-sep">→</span>
              <input
                type="date"
                className="topbar-date"
                aria-label="Hasta"
                value={to}
                min={from}
                onChange={(e) => e.target.value && setTo(e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="topbar-right">
          {searchPlaceholder && (
            <button
              type="button"
              className="topbar-search-btn"
              onClick={() => setSearchOpen((v) => !v)}
              aria-label={searchOpen ? 'Cerrar búsqueda' : 'Buscar'}
              aria-expanded={searchOpen}
            >
              {searchOpen ? <X size={17} /> : <Search size={17} />}
            </button>
          )}
          <span className="user-email">{session?.user.email}</span>
          <button className="btn btn-ghost" onClick={handleSignOut}>
            Salir
          </button>
        </div>
      </header>

      {/* En el dashboard el contenido aprovecha el ancho (escritorio) */}
      <main className={`content${location.pathname === '/' ? ' content-wide' : ''}`}>
        {children}
      </main>

      {/* Barra inferior: visible solo en movil */}
      <nav className="bottomnav">{navLinks}</nav>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      {/* Vista pública del chofer: acceso solo por token en la URL */}
      <Route path="/viaje/:token" element={<DriverTrip />} />

      {/* Menu publico del chofer: pendientes + viaje libre */}
      <Route path="/chofer/:token" element={<DriverHome />} />
      <Route path="/chofer/:token/pendientes" element={<DriverTrips />} />
      <Route path="/chofer/:token/libre" element={<FreeTrip />} />

      {/* Calificacion del viaje: link publico unico por pasajero */}
      <Route path="/calificar/:token" element={<RateTrip />} />

      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Protected>
            <Shell>
              <Dashboard />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/planificacion"
        element={
          <Protected>
            <Shell>
              <DayPlan />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/vehiculos"
        element={
          <Protected>
            <Shell>
              <Vehicles />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/combustible"
        element={
          <Protected>
            <Shell>
              <FuelPage />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/choferes"
        element={
          <Protected>
            <Shell>
              <Drivers />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/sucursales"
        element={
          <Protected>
            <TotpGate>
              <Shell>
                <Branches />
              </Shell>
            </TotpGate>
          </Protected>
        }
      />
      <Route
        path="/viajes"
        element={
          <Protected>
            <Shell>
              <Trips />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/viajes/nuevo"
        element={
          <Protected>
            <Shell>
              <TripCreate />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/viajes/:id/editar"
        element={
          <Protected>
            <Shell>
              <TripCreate />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/viajes/:id"
        element={
          <Protected>
            <Shell>
              <TripDetail />
            </Shell>
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
