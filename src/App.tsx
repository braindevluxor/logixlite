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
  CalendarDays,
  Car,
  House,
  IdCard,
  Search,
  X,
} from 'lucide-react'
import { useAuth } from './auth/AuthContext'
import { useSearch } from './search/SearchContext'
import TotpGate from './auth/TotpGate'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import DayPlan from './pages/DayPlan'
import Vehicles from './pages/Vehicles'
import Drivers from './pages/Drivers'
import Branches from './pages/Branches'
import Trips from './pages/Trips'
import TripCreate from './pages/TripCreate'
import TripDetail from './pages/TripDetail'
import DriverTrip from './pages/DriverTrip'

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
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Buscador global solo en las pantallas que lo usan
  const searchPlaceholder =
    location.pathname === '/vehiculos'
      ? 'Buscar por placa, marca o modelo…'
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

  return (
    <div className="app">
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

      <main className="content">{children}</main>

      <nav className="bottomnav">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="nav-icon">
            <House size={20} />
          </span>
          Dashboard
        </NavLink>
        <NavLink
          to="/planificacion"
          className={({ isActive }) => (isActive ? 'active' : '')}
        >
          <span className="nav-icon">
            <CalendarDays size={20} />
          </span>
          Plan
        </NavLink>
        <NavLink to="/viajes" className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="nav-icon">
            <Bus size={20} />
          </span>
          Viajes
        </NavLink>
        <NavLink to="/vehiculos" className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="nav-icon">
            <Car size={20} />
          </span>
          Vehículos
        </NavLink>
        <NavLink to="/choferes" className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="nav-icon">
            <IdCard size={20} />
          </span>
          Choferes
        </NavLink>
        {/* Sucursales oculto del menú: se entra escribiendo /sucursales
            (protegido con TOTP en TotpGate) */}
      </nav>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      {/* Vista pública del chofer: acceso solo por token en la URL */}
      <Route path="/viaje/:token" element={<DriverTrip />} />

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
