import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  BookOpen,
  Check,
  CircleCheck,
  MapPin,
  Play,
  Plus,
  Search,
  UserRound,
  X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { initials, up } from '../lib/format'
import { employeeFullName, fetchEmployees } from '../lib/talentoHumano'
import SpotlightTour, { type TourStep } from '../components/SpotlightTour'
import InstallAppButton from '../components/InstallAppButton'
import type { ApiEmployee, DriverLinkData } from '../lib/types'

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-VE', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-VE', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Viaje libre del chofer (no requiere login):
 *   /chofer/:token/libre
 * El chofer declara quienes van con el y las paradas que
 * va haciendo durante el recorrido.
 */
export default function FreeTrip() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<DriverLinkData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Tutorial paso a paso (boton de la barra superior)
  const [showTut, setShowTut] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const firstLoad = useRef(true)

  // ---- Pasajeros ----
  const [pName, setPName] = useState('')
  const [pDni, setPDni] = useState('')
  const [pPhone, setPPhone] = useState('')
  const [addingP, setAddingP] = useState(false)

  // ---- Paradas ----
  const [sName, setSName] = useState('')
  const [sNote, setSNote] = useState('')
  const [addingS, setAddingS] = useState(false)

  // ---- Iniciar / finalizar ----
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<{
    passengers: number
    stops: number
    finished_at: string
  } | null>(null)

  // ---- Busqueda en la nomina de trabajadores (API) ----
  const [empQuery, setEmpQuery] = useState('')
  const [employees, setEmployees] = useState<ApiEmployee[]>([])
  const [empState, setEmpState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [empError, setEmpError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) {
      setError('Enlace incompleto.')
      setLoading(false)
      return
    }
    const { data: rpc, error: rpcErr } = await supabase.rpc('driver_link_get', {
      p_token: token,
    })
    if (firstLoad.current) {
      firstLoad.current = false
      setLoading(false)
    }
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

  /**
   * Consulta la nomina de TODAS las sucursales (una sola vez y
   * deja el resultado en cache) para buscar pasajeros mientras
   * se escribe. Si la funcion public_branches no existe todavia,
   * avisa y permite registrar al pasajero manualmente.
   */
  const loadEmployees = useCallback(async () => {
    if (empState === 'loading' || empState === 'ready') return
    setEmpState('loading')
    setEmpError(null)
    try {
      const { data: br, error: brErr } = await supabase.rpc('public_branches')
      if (brErr) {
        throw new Error(
          brErr.message.includes('public_branches')
            ? 'SIN_SQL'
            : brErr.message
        )
      }
      const branches = (br ?? []) as { external_id: number; name: string }[]
      if (branches.length === 0) throw new Error('No hay sucursales registradas')

      const results = await Promise.allSettled(
        branches.map((b) => fetchEmployees(b.external_id))
      )
      const ok = results.filter(
        (r): r is PromiseFulfilledResult<ApiEmployee[]> => r.status === 'fulfilled'
      )
      if (ok.length === 0) throw new Error('La nómina no respondió en ninguna sucursal')

      // Dedupe por cédula (una cédula puede aparecer en 2 sucursales)
      const seen = new Set<string>()
      const all = ok.flatMap((r) => r.value).filter((e) => {
        const dni = String(e.dni)
        if (seen.has(dni)) return false
        seen.add(dni)
        return true
      })

      setEmployees(all)
      setEmpState('ready')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al consultar la nómina'
      setEmpError(
        msg === 'SIN_SQL'
          ? 'Para buscar en la nómina ejecuta supabase/public_branches.sql en Supabase. Mientras tanto, registra al pasajero manualmente.'
          : `${msg}. Puedes registrar al pasajero manualmente.`
      )
      setEmpState('error')
    }
  }, [empState])

  function flash(msg: string) {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2600)
  }

  const trip = data?.free_trip ?? null

  /** Cédulas ya agregadas al viaje libre (para marcarlas) */
  const addedDnis = useMemo(
    () => new Set((trip?.passengers ?? []).map((p) => p.dni ?? '')),
    [trip]
  )

  /** Resultados de la nómina según lo escrito (máximo 8) */
  const empResults = useMemo(() => {
    const q = empQuery.trim().toLowerCase()
    if (!q || empState !== 'ready') return []
    return employees
      .filter(
        (e) =>
          employeeFullName(e).toLowerCase().includes(q) ||
          String(e.dni).includes(q) ||
          (e.role_name ?? '').toLowerCase().includes(q) ||
          (e.department_name ?? '').toLowerCase().includes(q) ||
          (e.branch_name ?? '').toLowerCase().includes(q)
      )
      .slice(0, 8)
  }, [empQuery, empState, employees])

  // ---- Acciones ----
  async function start() {
    setBusy(true)
    const { error: rpcErr } = await supabase.rpc('driver_free_start', {
      p_token: token,
    })
    setBusy(false)
    if (rpcErr) return flash(`Error: ${rpcErr.message}`)
    setSummary(null)
    flash('Viaje libre iniciado')
    load()
  }

  async function addPassenger(e: FormEvent) {
    e.preventDefault()
    if (!pName.trim()) return flash('Indica el nombre del pasajero')
    setAddingP(true)
    const { error: rpcErr } = await supabase.rpc('driver_free_add_passenger', {
      p_token: token,
      p_name: pName.trim().toUpperCase(),
      p_dni: pDni.trim() || null,
      p_phone: pPhone.trim() || null,
    })
    setAddingP(false)
    if (rpcErr) return flash(`Error: ${rpcErr.message}`)
    setPName('')
    setPDni('')
    setPPhone('')
    flash('Pasajero agregado')
    load()
  }

  /** Agrega un trabajador encontrado en la nómina */
  async function addFromApi(e: ApiEmployee) {
    if (addingP) return
    setAddingP(true)
    const { error: rpcErr } = await supabase.rpc('driver_free_add_passenger', {
      p_token: token,
      p_name: employeeFullName(e).toUpperCase(),
      p_dni: String(e.dni),
      p_phone: (e.phone ?? '').trim() || null,
    })
    setAddingP(false)
    if (rpcErr) return flash(`Error: ${rpcErr.message}`)
    setEmpQuery('')
    flash('Pasajero agregado')
    load()
  }

  async function removePassenger(id: number) {
    const { error: rpcErr } = await supabase.rpc('driver_free_remove_passenger', {
      p_token: token,
      p_passenger_id: id,
    })
    if (rpcErr) return flash(`Error: ${rpcErr.message}`)
    flash('Pasajero quitado')
    load()
  }

  async function addStop(e: FormEvent) {
    e.preventDefault()
    if (!sName.trim()) return flash('Indica la parada')
    setAddingS(true)
    const { error: rpcErr } = await supabase.rpc('driver_free_add_stop', {
      p_token: token,
      p_name: sName.trim().toUpperCase(),
      p_note: sNote.trim() ? sNote.trim().toUpperCase() : null,
    })
    setAddingS(false)
    if (rpcErr) return flash(`Error: ${rpcErr.message}`)
    setSName('')
    setSNote('')
    flash('Parada registrada')
    load()
  }

  async function removeStop(id: number) {
    const { error: rpcErr } = await supabase.rpc('driver_free_remove_stop', {
      p_token: token,
      p_stop_id: id,
    })
    if (rpcErr) return flash(`Error: ${rpcErr.message}`)
    flash('Parada quitada')
    load()
  }

  async function finish() {
    if (!window.confirm('¿Finalizar el viaje libre?')) return
    setBusy(true)
    const { data: rpc, error: rpcErr } = await supabase.rpc('driver_free_finish', {
      p_token: token,
    })
    setBusy(false)
    if (rpcErr) return flash(`Error: ${rpcErr.message}`)
    const row = rpc as {
      passengers: number
      stops: number
      finished_at: string
    }
    setSummary({
      passengers: Number(row.passengers),
      stops: Number(row.stops),
      finished_at: row.finished_at,
    })
    flash('Viaje finalizado')
    load()
  }

  // ---- Vistas ----
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

  const ini = initials(data.driver.full_name) || 'C'

  /** Pasos del tour: cambian segun haya viaje activo o no */
  const tourSteps: TourStep[] = trip
    ? [
        {
          target: '[data-tour="active"]',
          title: 'Viaje libre en curso',
          description:
            'Muestra la hora en que iniciaste. Desde aquí finalizas el viaje cuando termines el recorrido.',
        },
        {
          target: '[data-tour="p-search"]',
          title: 'Buscar en la nómina',
          description:
            'Escribe el nombre o la cédula para traer al pasajero desde la nómina de trabajadores y agregarlo con un toque. Si no aparece en la nómina, regístralo manualmente abajo.',
        },
        {
          target: '[data-tour="p-name"]',
          title: 'Nombre del pasajero',
          description:
            'Escribe quién va contigo (obligatorio). Opcionalmente agrega su cédula y teléfono en los campos de al lado.',
        },
        {
          target: '[data-tour="p-add"]',
          title: 'Agregar pasajero',
          description:
            'Toca este botón para registrarlo: quedará numerado en la lista. La X lo quita si te equivocaste.',
        },
        {
          target: '[data-tour="s-name"]',
          title: 'Parada',
          description:
            'Escribe la parada donde dejas a alguien (ej: TERMINAL) y, si quieres, una nota opcional.',
        },
        {
          target: '[data-tour="s-add"]',
          title: 'Agregar parada',
          description:
            'La parada se guarda con la hora de llegada automáticamente y aparece numerada en la lista.',
        },
        {
          target: '[data-tour="finish"]',
          title: 'Finalizar viaje',
          description:
            'Al terminar el recorrido toca aquí (pide confirmación) y verás el resumen con pasajeros y paradas.',
        },
      ]
    : [
        {
          target: '[data-tour="start"]',
          title: 'Iniciar viaje libre',
          description:
            'Toca este botón para comenzar el recorrido. No necesitas tener un viaje asignado.',
        },
      ]

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
          <Link className="btn btn-primary" to={`/chofer/${token}`}>
            <ArrowLeft size={15} /> Menú
          </Link>
        </div>
      </header>

      <main className="driver-main">
        {/* Saludo */}
        <div className="driver-card dm-hello">
          <span className="dm-avatar" aria-hidden="true">
            {ini}
          </span>
          <span className="dm-hello-text">
            <span className="dm-role">Chofer</span>
            <strong className="dm-name">{data.driver.full_name}</strong>
            <span className="dm-dni">C.I. {data.driver.dni}</span>
          </span>
        </div>

        {/* Resumen tras finalizar */}
        {summary && !trip && (
          <div className="driver-card ft-summary">
            <span className="ft-ok-icon" aria-hidden="true">
              <CircleCheck size={34} />
            </span>
            <h2>Viaje finalizado</h2>

            <div className="ft-stats">
              <div>
                <strong>{summary.passengers}</strong>
                <span>pasajero(s)</span>
              </div>
              <div>
                <strong>{summary.stops}</strong>
                <span>parada(s)</span>
              </div>
            </div>

            <span className="muted small">Terminó: {fmtDateTime(summary.finished_at)}</span>

            <div className="ft-actions">
              <button
                type="button"
                className="btn btn-primary btn-block"
                data-tour="start"
                onClick={start}
                disabled={busy}
              >
                <Play size={16} /> {busy ? 'Iniciando…' : 'Nuevo viaje libre'}
              </button>
              <Link className="btn btn-primary btn-block" to={`/chofer/${token}`}>
                Volver al menú
              </Link>
            </div>
          </div>
        )}

        {/* Sin viaje activo */}
        {!trip && !summary && (
          <div className="driver-card ft-hero">
            <span className="ft-hero-icon" aria-hidden="true">
              <Play size={30} />
            </span>
            <h2>Viaje libre</h2>
            <p className="muted">
              Registra a quienes llevas y cada parada que haces durante el
              recorrido. No requiere un viaje asignado.
            </p>
            <div className="ft-actions">
              <button
                type="button"
                className="btn btn-primary btn-block"
                data-tour="start"
                onClick={start}
                disabled={busy}
              >
                <Play size={16} /> {busy ? 'Iniciando…' : 'Iniciar viaje libre'}
              </button>
              <Link className="btn btn-primary btn-block" to={`/chofer/${token}`}>
                Volver al menú
              </Link>
            </div>
          </div>
        )}

        {/* Viaje libre activo */}
        {trip && (
          <>
            <div className="driver-card ft-live" data-tour="active">
              <div className="ft-live-head">
                <span className="ft-live-icon" aria-hidden="true">
                  <Play size={22} />
                </span>
                <span className="ft-live-text">
                  <strong>Viaje libre</strong>
                  <span className="muted small">Inicio: {fmtDateTime(trip.started_at)}</span>
                </span>
                <span className="mo-badge">En curso</span>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-block"
                data-tour="finish"
                onClick={finish}
                disabled={busy}
              >
                <Check size={16} /> {busy ? 'Finalizando…' : 'Finalizar viaje'}
              </button>
            </div>

            {/* Pasajeros */}
            <div className="driver-card">
              <h2 className="ft-title">
                <span className="ft-title-icon" aria-hidden="true">
                  <UserRound size={16} />
                </span>
                Pasajeros
                <span className="mo-count">{trip.passengers.length}</span>
              </h2>

              {/* Buscar en la nomina de trabajadores (API) */}
              <div className="ft-form">
                <input
                  className="grow"
                  type="search"
                  data-tour="p-search"
                  value={empQuery}
                  onChange={(e) => {
                    setEmpQuery(e.target.value)
                    if (empState === 'idle') void loadEmployees()
                  }}
                  placeholder="Buscar en la nomina (nombre o cedula)"
                  aria-label="Buscar pasajero en la nómina"
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => void loadEmployees()}
                  disabled={empState === 'loading'}
                >
                  <Search size={15} /> {empState === 'loading' ? 'Cargando…' : 'Buscar'}
                </button>
              </div>

              {empState === 'loading' && (
                <p className="muted ft-hint">Consultando la nómina de trabajadores…</p>
              )}

              {empState === 'error' && empError && (
                <div className="alert alert-warn ft-hint">{empError}</div>
              )}

              {empResults.length > 0 && (
                <ul className="ft-results">
                  {empResults.map((e) => {
                    const dni = String(e.dni)
                    const already = addedDnis.has(dni)
                    return (
                      <li key={dni} className="ft-result">
                        <span className="ft-result-text">
                          <strong>{up(employeeFullName(e))}</strong>
                          <span className="muted small">
                            C.I. {dni}
                            {e.role_name ? ` · ${up(e.role_name)}` : ''}
                            {e.department_name ? ` · ${up(e.department_name)}` : ''}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          disabled={already || addingP}
                          onClick={() => void addFromApi(e)}
                        >
                          <Plus size={14} /> {already ? 'Agregado' : 'Agregar'}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}

              {empState === 'ready' && empQuery.trim() && empResults.length === 0 && (
                <p className="muted ft-hint">
                  Sin coincidencias en la nómina: regístralo manualmente abajo.
                </p>
              )}

              <div className="ft-or">
                <span>o registro manual</span>
              </div>

              <form className="ft-form" onSubmit={addPassenger}>
                <input
                  className="grow"
                  data-tour="p-name"
                  placeholder="Nombre del pasajero *"
                  value={pName}
                  onChange={(e) => setPName(e.target.value)}
                  aria-label="Nombre del pasajero"
                />
                <input
                  placeholder="Cédula"
                  value={pDni}
                  onChange={(e) => setPDni(e.target.value)}
                  inputMode="numeric"
                  aria-label="Cédula del pasajero"
                />
                <input
                  placeholder="Teléfono"
                  value={pPhone}
                  onChange={(e) => setPPhone(e.target.value)}
                  inputMode="tel"
                  aria-label="Teléfono del pasajero"
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  data-tour="p-add"
                  disabled={addingP}
                >
                  <Plus size={15} /> {addingP ? 'Agregando…' : 'Agregar'}
                </button>
              </form>

              <div className="ft-list">
                {trip.passengers.length === 0 ? (
                  <div className="dm-empty">
                    <UserRound size={28} />
                    <p>Sin pasajeros</p>
                    <span className="muted small">Agrégalos con el formulario de arriba.</span>
                  </div>
                ) : (
                  trip.passengers.map((p) => (
                    <div key={p.id} className="ft-row">
                      <span className="ft-seq">{p.seq}</span>
                      <span className="grow">
                        <strong>{p.full_name}</strong>
                        {(p.dni || p.phone) && (
                          <span className="muted small">
                            {' '}
                            {p.dni ? `· C.I. ${p.dni}` : ''}
                            {p.dni && p.phone ? ' ' : ''}
                            {p.phone ? `· ${p.phone}` : ''}
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => removePassenger(p.id)}
                        aria-label={`Quitar ${p.full_name}`}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Paradas */}
            <div className="driver-card">
              <h2 className="ft-title">
                <span className="ft-title-icon" aria-hidden="true">
                  <MapPin size={16} />
                </span>
                Paradas
                <span className="mo-count">{trip.stops.length}</span>
              </h2>

              <form className="ft-form" onSubmit={addStop}>
                <input
                  className="grow"
                  data-tour="s-name"
                  placeholder="Parada (ej. TERMINAL) *"
                  value={sName}
                  onChange={(e) => setSName(e.target.value)}
                  aria-label="Parada"
                />
                <input
                  placeholder="Nota (opcional)"
                  value={sNote}
                  onChange={(e) => setSNote(e.target.value)}
                  aria-label="Nota de la parada"
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  data-tour="s-add"
                  disabled={addingS}
                >
                  <Plus size={15} /> {addingS ? 'Agregando…' : 'Agregar'}
                </button>
              </form>

              <div className="ft-list">
                {trip.stops.length === 0 ? (
                  <div className="dm-empty">
                    <MapPin size={28} />
                    <p>Sin paradas</p>
                    <span className="muted small">Registra cada parada del recorrido.</span>
                  </div>
                ) : (
                  trip.stops.map((s) => (
                    <div key={s.id} className="ft-row">
                      <span className="ft-seq">{s.seq}</span>
                      <span className="grow">
                        <strong>{up(s.name)}</strong>
                        {s.note && <span className="muted small"> — {s.note}</span>}
                        <span className="block muted small">
                          Llegada: {fmtTime(s.arrived_at)}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => removeStop(s.id)}
                        aria-label={`Quitar ${s.name}`}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </main>

      {/* Tutorial interactivo con resaltado */}
      <SpotlightTour open={showTut} steps={tourSteps} onClose={() => setShowTut(false)} />

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
