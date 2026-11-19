import {
  Navigate,
  Route,
  Routes,
  NavLink,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import type { ReactNode } from 'react'
import {
  Bus,
  Car,
  House,
  IdCard,
  Search,
} from 'lucide-react'
import { useAuth } from './auth/AuthContext'
import { useSearch } from './search/SearchContext'
import TotpGate from './auth/TotpGate'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
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

  // Buscador global solo en las pantallas que lo usan
  const searchPlaceholder =
    location.pathname === '/vehiculos'
      ? 'Buscar por placa, marca o modelo…'
      : location.pathname === '/choferes'
        ? 'Buscar por nombre o cédula…'
        : null

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <img src="/logo-mark.png" alt="LOGIXLITE" className="brand-logo" />
          LOGIXLITE
        </span>

        {searchPlaceholder && (
          <div className="topbar-search">
            <Search size={15} aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
            />
          </div>
        )}

        <div className="topbar-right">
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
