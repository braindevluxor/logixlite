import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Share2,
} from 'lucide-react'
import { toPng } from 'html-to-image'
import { supabase } from '../lib/supabase'
import { up } from '../lib/format'
import type { TripStatus } from '../lib/types'

interface PlanPassenger {
  id: number
  full_name: string
  department: string | null
  observation: string | null
  trip_passenger_destinations: { trip_destination_id: number; seq: number | null }[]
}

interface PlanTrip {
  id: number
  status: TripStatus
  departure_at: string
  notes: string | null
  driver: { id: number; full_name: string } | null
  vehicle: {
    plate: string
    brand: string | null
    model: string | null
    year: number | null
    capacity: number
  } | null
  trip_passengers: PlanPassenger[]
  trip_destinations: { id: number; name: string }[]
}

interface DriverGroup {
  key: string
  name: string
  trips: PlanTrip[]
}

const STATUS_LABEL: Record<TripStatus, string> = {
  programado: 'Programado',
  en_curso: 'En curso',
  finalizado: 'Finalizado',
  cancelado: 'Cancelado',
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function localISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function shiftDate(iso: string, days: number): string {
  // mediodia: evita problemas de zona horaria al sumar dias
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + days)
  return localISO(d)
}

/** "8:00 A.M." / "6:00 p.m." como en el cuadro de referencia */
function fmtTime(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString('es-VE', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/a\.\s*m\.?/i, 'A.M.')
    .replace(/p\.\s*m\.?/i, 'p.m.')
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-VE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

function fullDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-VE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export default function DayPlan() {
  const [date, setDate] = useState(() => localISO(new Date()))
  const [trips, setTrips] = useState<PlanTrip[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      const fromIso = new Date(`${date}T00:00:00`).toISOString()
      const toIso = new Date(`${date}T23:59:59.999`).toISOString()

      const { data, error: err } = await supabase
        .from('trips')
        .select(
          `id, status, departure_at, notes,
           driver:drivers(id, full_name),
           vehicle:vehicles(plate, brand, model, year, capacity),
           trip_passengers(id, full_name, department, observation,
             trip_passenger_destinations(trip_destination_id, seq)),
           trip_destinations(id, name)`
        )
        .gte('departure_at', fromIso)
        .lte('departure_at', toIso)
        .order('departure_at', { ascending: true })

      if (cancelled) return
      if (err) setError(err.message)
      else setTrips((data as unknown as PlanTrip[]) ?? [])
      if (!cancelled) setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [date])

  // Agrupar por conductor (orden de aparicion)
  const groups = useMemo<DriverGroup[]>(() => {
    const map = new Map<string, DriverGroup>()
    for (const t of trips) {
      const key = t.driver ? String(t.driver.id) : 'sin-chofer'
      const name = t.driver?.full_name ?? 'Sin chofer'
      const g = map.get(key) ?? { key, name, trips: [] }
      g.trips.push(t)
      map.set(key, g)
    }
    return [...map.values()]
  }, [trips])

  /** Destinos del pasajero (su orden de bajada); si no tiene, la ruta del viaje */
  function destNames(t: PlanTrip, p: PlanPassenger): string {
    const idToName = new Map(t.trip_destinations.map((d) => [d.id, d.name]))
    const links = [...(p.trip_passenger_destinations ?? [])].sort(
      (a, b) => (a.seq ?? 999) - (b.seq ?? 999)
    )
    const names = links
      .map((l) => idToName.get(l.trip_destination_id))
      .filter((n): n is string => !!n)
      .map((n) => up(n))
    if (names.length > 0) return names.join(' → ')
    if (t.trip_destinations.length > 0)
      return t.trip_destinations.map((d) => up(d.name)).join(' / ')
    return '—'
  }

  const today = localISO(new Date())

  /**
   * Genera una imagen PNG del cuadro y la comparte
   * (Web Share API en movil; descarga en escritorio).
   */
  async function sharePlanImage() {
    const node = document.querySelector('.plan-sheet') as HTMLElement | null
    if (!node || sharing) return
    setSharing(true)
    setError(null)
    try {
      // Calidad: capturar hasta 4x la resolucion CSS. Si el lienzo
      // excede el limite de memoria de navegadores moviles (iOS ~16.7M
      // pixeles), se reduce automaticamente para no fallar.
      const rect = node.getBoundingClientRect()
      const maxPixels = 12_000_000
      let ratio = 4
      while (ratio > 1.5 && rect.width * rect.height * ratio * ratio > maxPixels) {
        ratio -= 0.5
      }

      const dataUrl = await toPng(node, {
        backgroundColor: '#ffffff',
        pixelRatio: ratio,
        cacheBust: true,
      })
      const blob = await (await fetch(dataUrl)).blob()
      const file = new File([blob], `planificacion-${date}.png`, {
        type: 'image/png',
      })

      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: `Planificación ${date}`,
            text: `Planificación del día ${fullDate(date)}`,
          })
        } catch (err) {
          // el usuario cerro el dialogo de compartir: no es un error
          if (!(err instanceof DOMException && err.name === 'AbortError')) throw err
        }
      } else {
        const a = document.createElement('a')
        a.href = dataUrl
        a.download = `planificacion-${date}.png`
        a.click()
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? `No se pudo generar la imagen: ${err.message}`
          : 'No se pudo generar la imagen del plan'
      )
    } finally {
      setSharing(false)
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Planificación del día</h1>
        <div className="page-head-actions">
          <button
            type="button"
            className="btn"
            onClick={sharePlanImage}
            disabled={sharing || loading || trips.length === 0}
            title="Generar una imagen del cuadro para compartirla"
          >
            <Share2 size={15} /> {sharing ? 'Generando…' : 'Compartir imagen'}
          </button>
          <Link className="btn btn-primary" to={`/viajes/nuevo?date=${date}`}>
            <Plus size={15} /> Nuevo viaje
          </Link>
        </div>
      </div>

      {/* Navegador de fecha */}
      <div className="card date-nav">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setDate(shiftDate(date, -1))}
          aria-label="Día anterior"
        >
          <ChevronLeft size={16} />
        </button>
        <label className="date-nav-input">
          <CalendarDays size={16} />
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setDate(shiftDate(date, 1))}
          aria-label="Día siguiente"
        >
          <ChevronRight size={16} />
        </button>
        <button
          type="button"
          className={`btn btn-sm ${date === today ? 'btn-primary' : ''}`}
          onClick={() => setDate(today)}
        >
          Hoy
        </button>
        <span className="date-nav-label">{longDate(date)}</span>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="card">
          <span className="sk-line wide" />
          <span className="sk-line" />
          <span className="sk-line" />
        </div>
      ) : groups.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">
            <CalendarDays size={30} />
          </span>
          <h2>Sin viajes para este día</h2>
          <p className="muted">
            No hay viajes con fecha de salida el {longDate(date)}.
          </p>
          <Link className="btn btn-primary" to={`/viajes/nuevo?date=${date}`}>
            <Plus size={15} /> Planificar viaje para este día
          </Link>
        </div>
      ) : (
        <div className="plan-scroll">
          <div className="plan-sheet">
            <div className="plan-sheet-title">
              OPERACIONES · {fullDate(date)}
            </div>

            {groups.map((g) => (
              <section key={g.key} className="plan-driver">
                <div className="plan-driver-head">
                  CONDUCTOR: {g.name.toUpperCase()}
                </div>

                {g.trips.map((t) => (
                  <div key={t.id} className="plan-trip">
                    <div className="plan-vehicle">
                      <div className="plan-vehicle-main">
                        <strong>
                          {t.vehicle?.plate ?? '—'} -{' '}
                          {[t.vehicle?.brand, t.vehicle?.model]
                            .filter(Boolean)
                            .join(' ') || 'SIN VEHÍCULO'}
                        </strong>
                        <span className="muted small">
                          MODELO - {t.vehicle?.model ?? '—'}
                          {t.vehicle?.year ? ` · ${t.vehicle.year}` : ''} ·{' '}
                          {t.vehicle?.capacity ?? 0} puestos
                        </span>
                      </div>
                      <div className="plan-vehicle-side">
                        <span className={`badge badge-${t.status}`}>
                          {STATUS_LABEL[t.status]}
                        </span>
                        <Link className="btn btn-sm" to={`/viajes/${t.id}`}>
                          Ver viaje
                        </Link>
                      </div>
                    </div>

                    <div className="plan-table">
                      <div className="plan-row plan-header">
                        <span>PERSONAL</span>
                        <span>DPTO.</span>
                        <span>DESTINO</span>
                        <span>HORA SALIDA</span>
                        <span>OBSERVACION</span>
                      </div>

                      {t.trip_passengers.length === 0 ? (
                        <div className="plan-row plan-empty">
                          Sin pasajeros registrados
                        </div>
                      ) : (
                        t.trip_passengers.map((p) => (
                          <div key={p.id} className="plan-row">
                            <span className="plan-name">{p.full_name}</span>
                            <span>{p.department ?? '—'}</span>
                            <span>{destNames(t, p)}</span>
                            <span className="plan-time">
                              {fmtTime(t.departure_at)}
                            </span>
                            <span
                              className={`plan-obs ${p.observation ? 'has-obs' : ''}`}
                            >
                              {p.observation ?? ''}
                            </span>
                          </div>
                        ))
                      )}
                    </div>

                    {t.notes && (
                      <div className="plan-trip-notes">
                        Nota del viaje: {t.notes}
                      </div>
                    )}
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
