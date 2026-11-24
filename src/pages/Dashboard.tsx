import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Calendar,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Clock,
  Route,
  X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { up } from '../lib/format'
import { eachDay, localISO } from '../lib/dates'
import { useDateFilter } from '../date/DateFilterContext'
import type { TripStatus } from '../lib/types'

interface TripRow {
  id: number
  status: TripStatus
  departure_at: string
}

interface PassRow {
  id: number
  trip_id: number
  dni: string | number
  full_name: string
  department: string | null
}

/** Filas de trip_passenger_destinations con destino y viaje embebidos */
interface DestLinkRow {
  trip_passenger_id: number
  seq: number | null
  trip_destination: { name: string } | null
  trip_passengers: { trip_id: number } | null
}

interface DeptStat {
  name: string
  count: number
}

interface PendingTrip {
  id: number
  status: TripStatus
  departure_at: string
  notes: string | null
  vehicle: { plate: string; brand: string | null; model: string | null } | null
  driver: { full_name: string } | null
  branch: { name: string } | null
  /** Avance: traslados finalizados / totales (pasajero ↔ destino) */
  progress: { done: number; total: number }
}

const COLORS = [
  '#2563eb',
  '#16a34a',
  '#d97706',
  '#dc2626',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#65a30d',
  '#ea580c',
  '#4f46e5',
]

/** Filas maximas visibles de las leyendas antes del "Ver mas" */
const LEGEND_MAX = 5

const STATUS_LABEL: Record<TripStatus, string> = {
  programado: 'Programado',
  en_curso: 'En curso',
  finalizado: 'Finalizado',
  cancelado: 'Cancelado',
}

/** "6 AM" / "11 PM" a partir de una hora (0-23) */
function fmtHour(h: number): string {
  const ampm = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12} ${ampm}`
}


// ===== Dona generica (SVG a mano) =====
function Donut({
  data,
  total,
  centerValue,
  centerLabel,
  hoverLabel,
  onSelect,
}: {
  data: (DeptStat & { color: string })[]
  /** suma de los sectores (para el calculo de angulos) */
  total: number
  /** numero a mostrar en el centro sin hover (default: total) */
  centerValue?: number
  centerLabel: string
  hoverLabel?: string
  /** clic en un sector: abre el detalle (ej. pasajeros del depto) */
  onSelect?: (name: string) => void
}) {
  const [hover, setHover] = useState<number | null>(null)
  const R = 70
  const C = 2 * Math.PI * R
  const GAP = 2.5

  let acc = 0
  const slices = data.map((d, i) => {
    const len = (d.count / total) * C
    const visible = Math.max(len - GAP, 1)
    const slice = { ...d, dash: visible, acc, idx: i }
    acc += len
    return slice
  })

  const active = hover != null ? data[hover] : null

  return (
    <div className="donut-wrap">
      <svg
        viewBox="0 0 200 200"
        className="donut"
        role="img"
        aria-label={centerLabel}
      >
        <g transform="rotate(-90 100 100)">
          <circle cx="100" cy="100" r={R} fill="none" stroke="#eef2f7" strokeWidth="26" />
          {slices.map((s) => (
            <circle
              key={s.idx}
              cx="100"
              cy="100"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={hover === s.idx ? 33 : 26}
              strokeDasharray={`${s.dash} ${C - s.dash}`}
              strokeDashoffset={-s.acc}
              onMouseEnter={() => setHover(s.idx)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect?.(s.name)}
              style={{
                transition: 'stroke-width 0.15s',
                cursor: onSelect ? 'pointer' : 'default',
              }}
            />
          ))}
        </g>
        <text x="100" y="92" textAnchor="middle" className="donut-center-num">
          {active ? active.count : centerValue ?? total}
        </text>
        <text x="100" y="114" textAnchor="middle" className="donut-center-label">
          {active ? (hoverLabel ?? centerLabel) : centerLabel}
        </text>
        {active && (
          <text x="100" y="135" textAnchor="middle" className="donut-center-dept">
            {active.name.length > 22 ? active.name.slice(0, 21) + '…' : active.name}
          </text>
        )}
      </svg>
    </div>
  )
}

// ===== Grafico de curvas: viajes por dia =====
function LineChart({
  data,
  onSelect,
}: {
  data: { date: string; count: number }[]
  /** clic en un dia: abre el listado de viajes de esa fecha */
  onSelect?: (date: string) => void
}) {
  const [hover, setHover] = useState<number | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)

  // Se adapta al ancho real del contenedor (sin escalar el SVG,
  // asi el texto queda nitido y la altura se mantiene)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => setWidth(Math.max(320, Math.round(el.clientWidth)))
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const W = width
  const H = 240
  const PAD_L = 38
  const PAD_R = 16
  const PAD_T = 22
  const PAD_B = 34

  const max = Math.max(1, ...data.map((d) => d.count))
  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B
  const baseY = PAD_T + innerH

  const px = (i: number) =>
    PAD_L + (data.length > 1 ? (i * innerW) / (data.length - 1) : innerW / 2)
  const py = (v: number) => baseY - (v / max) * innerH

  // Sumatoria acumulada de viajes dia a dia
  let run = 0
  const acc = data.map((d) => (run += d.count))

  const pts = data.map((d, i) => ({ x: px(i), y: py(d.count) }))

  // Curva suave (bezier) que pasa por todos los puntos
  let path = ''
  if (pts.length > 0) {
    path = `M ${pts[0].x} ${pts[0].y}`
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1]
      const p1 = pts[i]
      const cx = (p0.x + p1.x) / 2
      path += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`
    }
  }

  const area =
    pts.length > 1
      ? `${path} L ${pts[pts.length - 1].x} ${baseY} L ${pts[0].x} ${baseY} Z`
      : ''

  const gridVals = [max, Math.max(1, Math.round(max / 2)), 0]
  const labelEvery = Math.max(1, Math.ceil(data.length / 7))
  const hitW = data.length > 1 ? innerW / (data.length - 1) : innerW
  const showDots = data.length <= 62

  return (
    <div className="line-scroll" ref={wrapRef}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="line-chart"
        role="img"
        aria-label="Viajes por día"
      >
        <defs>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Lineas de referencia del eje Y */}
        {gridVals.map((v) => (
          <g key={`g${v}`}>
            <line
              x1={PAD_L}
              y1={py(v)}
              x2={W - PAD_R}
              y2={py(v)}
              className="line-grid"
            />
            <text x={PAD_L - 7} y={py(v) + 3} textAnchor="end" className="line-axis">
              {v}
            </text>
          </g>
        ))}

        {area && <path d={area} fill="url(#lineGrad)" />}
        <path d={path} className="line-path" />

        {/* Puntos y valor del dia activo */}
        {pts.map((p, i) => (
          <g key={`p${i}`} className="line-point">
            {showDots && (
              <circle cx={p.x} cy={p.y} r={hover === i ? 5 : 3} className="line-dot" />
            )}
            <text
              x={p.x}
              y={p.y - 11}
              textAnchor="middle"
              className="line-value"
              opacity={hover === i ? 1 : 0}
            >
              {data[i].count}
            </text>
          </g>
        ))}

        {/* Zonas de hover / clic por dia */}
        {data.map((d, i) => (
          <rect
            key={`h${i}`}
            className="line-hit"
            x={px(i) - hitW / 2}
            y={PAD_T}
            width={hitW}
            height={innerH}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onSelect?.(d.date)}
            style={{ cursor: onSelect ? 'pointer' : 'default' }}
          >
            <title>{`${d.date.slice(8, 10)}/${d.date.slice(5, 7)}: ${d.count} viaje(s) · acumulado ${acc[i]}`}</title>
          </rect>
        ))}

        {/* Etiquetas del eje X (fechas) */}
        {data.map((d, i) =>
          i % labelEvery === 0 || i === data.length - 1 ? (
            <text
              key={`x${i}`}
              x={px(i)}
              y={H - 10}
              textAnchor="middle"
              className="line-axis"
            >
              {d.date.slice(8, 10)}/{d.date.slice(5, 7)}
            </text>
          ) : null
        )}
      </svg>
    </div>
  )
}

export default function Dashboard() {
  // Rango de fechas: el control vive en la barra superior
  // (DateFilterProvider) y aqui solo se consume
  const { from, to } = useDateFilter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trips, setTrips] = useState<TripRow[]>([])
  const [passengers, setPassengers] = useState<PassRow[]>([])
  const [linkRows, setLinkRows] = useState<DestLinkRow[]>([])

  // Modal de viajes pendientes
  const [showPending, setShowPending] = useState(false)
  const [pendingTrips, setPendingTrips] = useState<PendingTrip[]>([])
  const [pendingLoading, setPendingLoading] = useState(false)
  const [pendingError, setPendingError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (from > to) {
        setError('La fecha "desde" no puede ser mayor que "hasta".')
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)

      const fromIso = new Date(`${from}T00:00:00`).toISOString()
      const toIso = new Date(`${to}T23:59:59.999`).toISOString()

      const { data: tripData, error: tripErr } = await supabase
        .from('trips')
        .select('id, status, departure_at')
        .gte('departure_at', fromIso)
        .lte('departure_at', toIso)

      if (tripErr) {
        if (!cancelled) {
          setError(tripErr.message)
          setLoading(false)
        }
        return
      }

      const ids = (tripData ?? []).map((t) => t.id)
      let passData: PassRow[] = []
      let stopLinks: DestLinkRow[] = []

      if (ids.length > 0) {
        const [passRes, stopRes] = await Promise.all([
          supabase
            .from('trip_passengers')
            .select('id, trip_id, dni, full_name, department')
            .in('trip_id', ids),
          // Solo DESTINOS marcados por pasajeros: una ubicacion que es
          // solo ORIGEN no aparece aqui y por tanto no se cuenta
          supabase
            .from('trip_passenger_destinations')
            .select(
              'trip_passenger_id, seq, trip_destination:trip_destinations(name), trip_passengers!inner(trip_id)'
            )
            .in('trip_passengers.trip_id', ids),
        ])
        if (passRes.error || stopRes.error) {
          if (!cancelled) {
            setError(
              passRes.error?.message || stopRes.error?.message || 'Error al cargar el plan'
            )
            setLoading(false)
          }
          return
        }
        passData = (passRes.data as PassRow[]) ?? []
        // PostgREST devuelve objetos (many-to-one); el tipo inferido
        // por supabase-js declara arrays, por eso el doble cast
        stopLinks = (stopRes.data as unknown as DestLinkRow[]) ?? []
      }

      if (!cancelled) {
        setTrips((tripData as TripRow[]) ?? [])
        setPassengers(passData)
        setLinkRows(stopLinks)
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [from, to])

  const stats = useMemo(() => {
    const listos = trips.filter((t) => t.status === 'finalizado').length
    const pendientes = trips.filter(
      (t) => t.status === 'programado' || t.status === 'en_curso'
    ).length
    const cancelados = trips.filter((t) => t.status === 'cancelado').length
    return { listos, pendientes, cancelados, total: trips.length }
  }, [trips])

  // Departamentos con más traslados (agrupa por department de la instantánea)
  const topDepts = useMemo(() => {
    const byDept = new Map<string, number>()
    for (const p of passengers) {
      const key = p.department?.trim() || 'Sin departamento'
      byDept.set(key, (byDept.get(key) ?? 0) + 1)
    }
    const sorted = [...byDept.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)

    const top = sorted.slice(0, 10).map((d, i) => ({ ...d, color: COLORS[i % COLORS.length] }))
    const restCount = sorted.slice(10).reduce((s, d) => s + d.count, 0)
    if (restCount > 0) {
      top.push({
        name: `Otros (${sorted.length - 10} deptos.)`,
        count: restCount,
        color: '#94a3b8',
      })
    }
    return top
  }, [passengers])

  const totalTraslados = passengers.length
  const totalDepts = useMemo(
    () => new Set(passengers.map((p) => p.department?.trim() || 'Sin departamento')).size,
    [passengers]
  )

  /**
   * Paradas ÚNICAS del rango: agrupa por nombre (3 pasajeros hacia
   * el mismo destino = 1 parada) y cuenta en cuántos viajes aparece
   * cada una (para dimensionar los sectores del gráfico).
   */
  const stopStats = useMemo(() => {
    const byName = new Map<string, Set<number>>()
    for (const r of linkRows) {
      const name = r.trip_destination?.name?.trim()
      const tripId = r.trip_passengers?.trip_id
      if (!name || tripId == null) continue
      let trips = byName.get(name)
      if (!trips) {
        trips = new Set()
        byName.set(name, trips)
      }
      trips.add(tripId)
    }
    const uniqueCount = byName.size
    const list = [...byName.entries()]
      .map(([name, trips]) => ({ name, count: trips.size }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es'))
    return { uniqueCount, list }
  }, [linkRows])

  const stopDonut = useMemo(
    () => stopStats.list.map((d, i) => ({ ...d, color: COLORS[i % COLORS.length] })),
    [stopStats]
  )

  /** suma de usos (para los angulos de la dona de paradas) */
  const stopTotalUses = stopDonut.reduce((s, d) => s + d.count, 0)

  // ---- Detalle al clickear un departamento del grafico ----
  const [deptModal, setDeptModal] = useState<string | null>(null)
  // ---- Detalle al clickear una parada/destino del segundo grafico ----
  const [stopModal, setStopModal] = useState<string | null>(null)
  // ---- Leyendas: maximo 5 filas visibles y despues "Ver mas" ----
  const [deptAll, setDeptAll] = useState(false)
  const [stopAll, setStopAll] = useState(false)
  const [hourAll, setHourAll] = useState(false)
  // ---- Detalle al clickear una hora del grafico de horas ----
  const [hourModal, setHourModal] = useState<number | null>(null)
  // ---- Detalle al clickear un dia del grafico de curvas ----
  const [dayModal, setDayModal] = useState<string | null>(null)

  /**
   * Hora del dia con mas viajes de salida (0-23), ordenada de
   * mayor a menor cantidad de viajes en el rango seleccionado.
   */
  const hourStats = useMemo(() => {
    const byHour = new Map<number, number>()
    for (const t of trips) {
      const h = new Date(t.departure_at).getHours()
      byHour.set(h, (byHour.get(h) ?? 0) + 1)
    }
    return [...byHour.entries()]
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => b.count - a.count || a.hour - b.hour)
  }, [trips])

  /** mayor cantidad de viajes en una hora (para escalar las barras) */
  const hourMax = hourStats.reduce((m, h) => Math.max(m, h.count), 0)

  /** Viajes de la hora clickeada (para el modal) */
  const hourTrips = useMemo(() => {
    if (hourModal == null) return []
    return trips
      .filter((t) => new Date(t.departure_at).getHours() === hourModal)
      .sort((a, b) => a.departure_at.localeCompare(b.departure_at))
  }, [hourModal, trips])

  /**
   * Viajes por dia del rango completo (incluye los dias sin
   * viajes, para que la curva sea continua). La sumatoria
   * acumulada se calcula dentro del grafico.
   */
  const dailyTrips = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of trips) {
      const key = localISO(new Date(t.departure_at))
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return eachDay(from, to).map((date) => ({ date, count: counts.get(date) ?? 0 }))
  }, [trips, from, to])

  /** Viajes del dia clickeado (para el modal) */
  const dayTrips = useMemo(() => {
    if (!dayModal) return []
    return trips
      .filter((t) => localISO(new Date(t.departure_at)) === dayModal)
      .sort((a, b) => a.departure_at.localeCompare(b.departure_at))
  }, [dayModal, trips])

  /** Pasajeros del departamento elegido: nombre, destino, hora y fecha */
  const deptRows = useMemo(() => {
    if (!deptModal) return []
    const list = passengers.filter(
      (p) => (p.department?.trim() || 'Sin departamento') === deptModal
    )
    const tripById = new Map(trips.map((t) => [t.id, t]))

    // Destinos asignados por pasajero (ordenados por seq)
    const destsByPassenger = new Map<number, { name: string; seq: number | null }[]>()
    for (const r of linkRows) {
      const name = r.trip_destination?.name?.trim()
      if (!name) continue
      const arr = destsByPassenger.get(r.trip_passenger_id) ?? []
      arr.push({ name, seq: r.seq })
      destsByPassenger.set(r.trip_passenger_id, arr)
    }

    return list
      .map((p) => {
        const trip = tripById.get(p.trip_id)
        const dests = (destsByPassenger.get(p.id) ?? [])
          .sort((a, b) => (a.seq ?? 999) - (b.seq ?? 999))
          .map((d) => d.name)
        return {
          name: p.full_name,
          dests,
          at: trip?.departure_at ?? null,
        }
      })
      .sort(
        (a, b) =>
          (a.at ?? '').localeCompare(b.at ?? '') || a.name.localeCompare(b.name, 'es')
      )
  }, [deptModal, passengers, trips, linkRows])

  /** "11:55 AM" / "6:00 PM" */
  function fmtTime12(iso: string): string {
    return new Date(iso)
      .toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: true })
      .replace(/a\.\s*m\.?/i, 'AM')
      .replace(/p\.\s*m\.?/i, 'PM')
  }

  /** Pasajeros que bajaron en el destino elegido */
  const stopModalRows = useMemo(() => {
    if (!stopModal) return []
    const pids = new Set<number>()
    for (const r of linkRows) {
      if (r.trip_destination?.name?.trim() === stopModal) pids.add(r.trip_passenger_id)
    }
    const tripById = new Map(trips.map((t) => [t.id, t]))
    return passengers
      .filter((p) => pids.has(p.id))
      .map((p) => ({
        name: p.full_name,
        dept: p.department ?? '—',
        at: tripById.get(p.trip_id)?.departure_at ?? null,
      }))
      .sort(
        (a, b) =>
          (a.at ?? '').localeCompare(b.at ?? '') || a.name.localeCompare(b.name, 'es')
      )
  }, [stopModal, passengers, trips, linkRows])

  const pct = (n: number) => (stats.total > 0 ? Math.round((n / stats.total) * 100) : 0)

  /** Carga y abre el modal de viajes pendientes (rango de fechas activo) */
  async function openPending() {
    setShowPending(true)
    setPendingLoading(true)
    setPendingError(null)

    const fromIso = new Date(`${from}T00:00:00`).toISOString()
    const toIso = new Date(`${to}T23:59:59.999`).toISOString()

    const { data, error } = await supabase
      .from('trips')
      .select(
        `id, status, departure_at, notes,
         vehicle:vehicles(plate, brand, model),
         driver:drivers(full_name),
         branch:branches(name)`
      )
      .gte('departure_at', fromIso)
      .lte('departure_at', toIso)
      .in('status', ['programado', 'en_curso'])
      .order('departure_at', { ascending: true })

    if (error) {
      setPendingError(error.message)
      setPendingLoading(false)
      return
    }

    const rows = (data as unknown as PendingTrip[]) ?? []

    // ---- Avance de traslados por viaje ----
    const progress = new Map<number, { done: number; total: number }>()
    if (rows.length > 0) {
      const { data: passData, error: pErr } = await supabase
        .from('trip_passengers')
        .select('trip_id, trip_passenger_destinations(arrived_at)')
        .in(
          'trip_id',
          rows.map((t) => t.id)
        )

      if (pErr) {
        setPendingError(pErr.message)
        setPendingLoading(false)
        return
      }

      for (const p of (passData ?? []) as {
        trip_id: number
        trip_passenger_destinations: { arrived_at: string | null }[] | null
      }[]) {
        const links = p.trip_passenger_destinations ?? []
        const cur = progress.get(p.trip_id) ?? { done: 0, total: 0 }
        cur.total += links.length
        cur.done += links.filter((l) => l.arrived_at != null).length
        progress.set(p.trip_id, cur)
      }
    }

    setPendingTrips(
      rows.map((t) => ({ ...t, progress: progress.get(t.id) ?? { done: 0, total: 0 } }))
    )
    setPendingLoading(false)
  }

  return (
    <div className="page dash">
      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="stat-grid">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card stat-card skeleton">
              <span className="sk-chip" />
              <span className="sk-line wide" />
              <span className="sk-line" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* ---- Totales ---- */}
          <div className="stat-grid">
            <div className="card stat-card stat-ok">
              <span className="stat-icon stat-icon-ok">
                <CircleCheck size={20} />
              </span>
              <div className="stat-body">
                <span className="stat-num">{stats.listos}</span>
                <span className="stat-label">Viajes listos</span>
                <div className="mini-bar">
                  <div className="mini-fill ok" style={{ width: `${pct(stats.listos)}%` }} />
                </div>
                <span className="muted small">
                  {pct(stats.listos)}% del total
                  {stats.cancelados > 0 ? ` · ${stats.cancelados} cancelado(s)` : ''}
                </span>
              </div>
            </div>

            <div
              className="card stat-card stat-pend clickable"
              onClick={openPending}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  openPending()
                }
              }}
              title="Ver viajes pendientes"
            >
              <span className="stat-icon stat-icon-pend">
                <Clock size={20} />
              </span>
              <div className="stat-body">
                <span className="stat-num">{stats.pendientes}</span>
                <span className="stat-label">Viajes pendientes</span>
                <div className="mini-bar">
                  <div className="mini-fill pend" style={{ width: `${pct(stats.pendientes)}%` }} />
                </div>
                <span className="stat-cta">
                  Ver listado <ArrowRight size={13} />
                </span>
              </div>
            </div>

            <div className="card stat-card stat-total">
              <span className="stat-icon stat-icon-total">
                <Route size={20} />
              </span>
              <div className="stat-body">
                <span className="stat-num">{stats.total}</span>
                <span className="stat-label">Total en el periodo</span>
                <div className="mini-bar">
                  <div className="mini-fill total" style={{ width: '100%' }} />
                </div>
                <span className="muted small">
                  {from} → {to}
                </span>
              </div>
            </div>
          </div>

          {/* ---- Curva: viajes por día (sumatoria) ---- */}
          <div className="card chart-card chart-card-wide">
            <div className="chart-head">
              <div>
                <h2 className="chart-title">Viajes por día</h2>
                <p className="chart-sub">
                  {stats.total} viaje(s) en el período · la curva acumula la sumatoria
                  día a día (pasa el mouse para ver el acumulado)
                </p>
              </div>
              <span className="chart-badge">
                <ArrowRight size={13} /> {from} → {to}
              </span>
            </div>

            {trips.length === 0 ? (
              <div className="chart-empty">
                <Calendar size={28} />
                <p>No hay viajes en el rango de fechas seleccionado.</p>
              </div>
            ) : (
              <LineChart data={dailyTrips} onSelect={setDayModal} />
            )}
          </div>

          {/* ---- Gráficos ---- */}
          <div className="charts-row">
          <div className="card chart-card">
            <div className="chart-head">
              <div>
                <h2 className="chart-title">Departamentos con más traslados</h2>
                <p className="chart-sub">
                  {totalTraslados} traslado(s) · {totalDepts} departamento(s)
                </p>
              </div>
              <span className="chart-badge">
                <ArrowRight size={13} /> {from} → {to}
              </span>
            </div>

            {totalTraslados === 0 ? (
              <div className="chart-empty">
                <Route size={28} />
                <p>No hay pasajeros en el rango de fechas seleccionado.</p>
              </div>
            ) : (
              <div className="chart-grid">
                <Donut
                  data={topDepts}
                  total={totalTraslados}
                  centerLabel="traslados"
                  onSelect={setDeptModal}
                />
                <ul className="chart-legend">
                  {(deptAll ? topDepts : topDepts.slice(0, LEGEND_MAX)).map((d) => {
                    const p = Math.round((d.count / totalTraslados) * 100)
                    return (
                      <li
                        key={d.name}
                        className="legend-clickable"
                        onClick={() => setDeptModal(d.name)}
                        title="Ver los pasajeros de este departamento"
                      >
                        <span className="legend-dot" style={{ background: d.color }} />
                        <span className="legend-name">{d.name}</span>
                        <span className="legend-pct">{p}%</span>
                        <span className="legend-track">
                          <span
                            className="legend-fill"
                            style={{ width: `${p}%`, background: d.color }}
                          />
                        </span>
                        <strong className="legend-count">{d.count}</strong>
                      </li>
                    )
                  })}
                  {topDepts.length > LEGEND_MAX && (
                    <li
                      className="legend-more"
                      role="button"
                      tabIndex={0}
                      onClick={() => setDeptAll((v) => !v)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setDeptAll((v) => !v)
                        }
                      }}
                    >
                      {deptAll ? (
                        <>
                          <ChevronUp size={13} /> Ver menos
                        </>
                      ) : (
                        <>
                          <ChevronDown size={13} /> Ver más (
                          {topDepts.length - LEGEND_MAX} más)
                        </>
                      )}
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>

          {/* ---- Gráfico: paradas únicas ---- */}
          <div className="card chart-card">
            <div className="chart-head">
              <div>
                <h2 className="chart-title">Paradas / destinos del período</h2>
                <p className="chart-sub">
                  {stopStats.uniqueCount} parada(s) única(s) · solo destinos marcados por
                  pasajeros; los orígenes no cuentan
                </p>
              </div>
              <span className="chart-badge">
                <ArrowRight size={13} /> {from} → {to}
              </span>
            </div>

            {stopStats.uniqueCount === 0 ? (
              <div className="chart-empty">
                <Route size={28} />
                <p>No hay destinos marcados en el rango de fechas.</p>
              </div>
            ) : (
              <div className="chart-grid">
                <Donut
                  data={stopDonut}
                  total={stopTotalUses}
                  centerValue={stopStats.uniqueCount}
                  centerLabel="paradas"
                  hoverLabel="viajes"
                  onSelect={setStopModal}
                />
                <ul className="chart-legend">
                  {(stopAll ? stopDonut : stopDonut.slice(0, LEGEND_MAX)).map((d) => (
                    <li
                      key={d.name}
                      className="legend-clickable"
                      onClick={() => setStopModal(d.name)}
                      title="Ver los pasajeros que bajaron aquí"
                    >
                      <span className="legend-dot" style={{ background: d.color }} />
                      <span className="legend-name">{d.name}</span>
                      <strong className="legend-count">{d.count} viajes</strong>
                    </li>
                  ))}
                  {stopDonut.length > LEGEND_MAX && (
                    <li
                      className="legend-more"
                      role="button"
                      tabIndex={0}
                      onClick={() => setStopAll((v) => !v)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setStopAll((v) => !v)
                        }
                      }}
                    >
                      {stopAll ? (
                        <>
                          <ChevronUp size={13} /> Ver menos
                        </>
                      ) : (
                        <>
                          <ChevronDown size={13} /> Ver más (
                          {stopDonut.length - LEGEND_MAX} más)
                        </>
                      )}
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>

          {/* ---- Gráfico: horas con más viajes ---- */}
          <div className="card chart-card">
            <div className="chart-head">
              <div>
                <h2 className="chart-title">Horas con más viajes</h2>
                <p className="chart-sub">
                  {trips.length} viaje(s) · hora pico:{' '}
                  {hourStats.length > 0
                    ? `${fmtHour(hourStats[0].hour)} con ${hourStats[0].count}`
                    : '—'}
                </p>
              </div>
              <span className="chart-badge">
                <ArrowRight size={13} /> {from} → {to}
              </span>
            </div>

            {trips.length === 0 ? (
              <div className="chart-empty">
                <Clock size={28} />
                <p>No hay viajes en el rango de fechas seleccionado.</p>
              </div>
            ) : (
              <ul className="hour-list">
                {(hourAll ? hourStats : hourStats.slice(0, LEGEND_MAX)).map((h) => {
                  const p = hourMax > 0 ? Math.round((h.count / hourMax) * 100) : 0
                  return (
                    <li
                      key={h.hour}
                      className="hour-row legend-clickable"
                      role="button"
                      tabIndex={0}
                      onClick={() => setHourModal(h.hour)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setHourModal(h.hour)
                        }
                      }}
                      title="Ver los viajes de esta hora"
                    >
                      <span className="hour-label">{fmtHour(h.hour)}</span>
                      <span className="legend-track hour-track">
                        <span
                          className="legend-fill"
                          style={{ width: `${p}%`, background: '#2563eb' }}
                        />
                      </span>
                      <strong className="hour-count">{h.count}</strong>
                    </li>
                  )
                })}
                {hourStats.length > LEGEND_MAX && (
                  <li
                    className="legend-more"
                    role="button"
                    tabIndex={0}
                    onClick={() => setHourAll((v) => !v)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setHourAll((v) => !v)
                      }
                    }}
                  >
                    {hourAll ? (
                      <>
                        <ChevronUp size={13} /> Ver menos
                      </>
                    ) : (
                      <>
                        <ChevronDown size={13} /> Ver más (
                        {hourStats.length - LEGEND_MAX} más)
                      </>
                    )}
                  </li>
                )}
              </ul>
            )}
          </div>
          </div>
        </>
      )}

      {/* ===== Modal: pasajeros de un departamento ===== */}
      {deptModal && (
        <div className="modal-backdrop" onClick={() => setDeptModal(null)}>
          <div
            className="card modal modal-wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Pasajeros de ${deptModal}`}
          >
            <div className="modal-head">
              <div>
                <h2>{deptModal}</h2>
                <p className="muted small">
                  {deptRows.length} pasajero(s) · {from} → {to}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setDeptModal(null)}
                aria-label="Cerrar"
              >
                <X size={15} />
              </button>
            </div>

            <div className="dept-list">
              {deptRows.length === 0 ? (
                <p className="muted">Sin pasajeros en este rango de fechas.</p>
              ) : (
                deptRows.map((r, i) => (
                  <div key={i} className="dept-row">
                    <strong className="dept-name">{r.name}</strong>
                    <span className="dept-dest">
                      ({r.dests.length > 0 ? r.dests.map((n) => up(n)).join(', ') : '—'})
                    </span>
                    <span className="dept-when">
                      {r.at
                        ? `${fmtTime12(r.at)} ${new Date(r.at).toLocaleDateString('es-VE', {
                            dateStyle: 'short',
                          })}`
                        : '—'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== Modal: pasajeros de un destino ===== */}
      {stopModal && (
        <div className="modal-backdrop" onClick={() => setStopModal(null)}>
          <div
            className="card modal modal-wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Pasajeros de ${stopModal}`}
          >
            <div className="modal-head">
              <div>
                <h2>{up(stopModal)}</h2>
                <p className="muted small">
                  {stopModalRows.length} pasajero(s) que bajaron aquí · {from} → {to}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setStopModal(null)}
                aria-label="Cerrar"
              >
                <X size={15} />
              </button>
            </div>

            <div className="dept-list">
              {stopModalRows.length === 0 ? (
                <p className="muted">Sin pasajeros en este rango de fechas.</p>
              ) : (
                stopModalRows.map((r, i) => (
                  <div key={i} className="dept-row">
                    <strong className="dept-name">{r.name}</strong>
                    <span className="dept-dest">({r.dept})</span>
                    <span className="dept-when">
                      {r.at
                        ? `${fmtTime12(r.at)} ${new Date(r.at).toLocaleDateString('es-VE', {
                            dateStyle: 'short',
                          })}`
                        : '—'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== Modal: viajes de una hora ===== */}
      {hourModal !== null && (
        <div className="modal-backdrop" onClick={() => setHourModal(null)}>
          <div
            className="card modal modal-wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Viajes por hora"
          >
            <div className="modal-head">
              <div>
                <h2>
                  <Clock size={18} /> Viajes a las {fmtHour(hourModal)}
                </h2>
                <p className="muted small">
                  {hourTrips.length} viaje(s) · {from} → {to}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setHourModal(null)}
                aria-label="Cerrar"
              >
                <X size={15} />
              </button>
            </div>

            {hourTrips.length === 0 ? (
              <div className="chart-empty">
                <Clock size={28} />
                <p>Sin viajes en esta hora del rango seleccionado.</p>
              </div>
            ) : (
              <div className="pending-list">
                {hourTrips.map((t) => (
                  <Link
                    key={t.id}
                    to={`/viajes/${t.id}`}
                    className="pending-row"
                    onClick={() => setHourModal(null)}
                  >
                    <div className="pending-main">
                      <strong>{fmtTime12(t.departure_at)}</strong>
                      <span className="muted small">
                        {new Date(t.departure_at).toLocaleDateString('es-VE', {
                          dateStyle: 'medium',
                        })}
                      </span>
                    </div>
                    <div className="pending-side">
                      <span className={`badge badge-${t.status}`}>
                        {STATUS_LABEL[t.status]}
                      </span>
                      <ArrowRight size={16} className="pending-arrow" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== Modal: viajes de un día ===== */}
      {dayModal && (
        <div className="modal-backdrop" onClick={() => setDayModal(null)}>
          <div
            className="card modal modal-wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Viajes del día"
          >
            <div className="modal-head">
              <div>
                <h2>
                  <Calendar size={18} />{' '}
                  {new Date(`${dayModal}T00:00:00`).toLocaleDateString('es-VE', {
                    dateStyle: 'full',
                  })}
                </h2>
                <p className="muted small">{dayTrips.length} viaje(s) en este día</p>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setDayModal(null)}
                aria-label="Cerrar"
              >
                <X size={15} />
              </button>
            </div>

            {dayTrips.length === 0 ? (
              <div className="chart-empty">
                <Calendar size={28} />
                <p>Sin viajes en esta fecha.</p>
              </div>
            ) : (
              <div className="pending-list">
                {dayTrips.map((t) => (
                  <Link
                    key={t.id}
                    to={`/viajes/${t.id}`}
                    className="pending-row"
                    onClick={() => setDayModal(null)}
                  >
                    <div className="pending-main">
                      <strong>{fmtTime12(t.departure_at)}</strong>
                      <span className="muted small">
                        {fmtHour(new Date(t.departure_at).getHours())} · viaje #{t.id}
                      </span>
                    </div>
                    <div className="pending-side">
                      <span className={`badge badge-${t.status}`}>
                        {STATUS_LABEL[t.status]}
                      </span>
                      <ArrowRight size={16} className="pending-arrow" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== Modal: viajes pendientes ===== */}
      {showPending && (
        <div className="modal-backdrop" onClick={() => setShowPending(false)}>
          <div
            className="card modal modal-wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Viajes pendientes"
          >
            <div className="modal-head">
              <div>
                <h2>
                  <Clock size={18} /> Viajes pendientes
                </h2>
                <p className="muted small">
                  {from} → {to} · programados y en curso
                </p>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setShowPending(false)}
                aria-label="Cerrar"
              >
                <X size={15} />
              </button>
            </div>

            {pendingLoading ? (
              <div className="pending-list">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="pending-row skeleton">
                    <span className="sk-line wide" />
                    <span className="sk-line" />
                  </div>
                ))}
              </div>
            ) : pendingError ? (
              <div className="alert alert-error">{pendingError}</div>
            ) : pendingTrips.length === 0 ? (
              <div className="chart-empty">
                <CircleCheck size={28} />
                <p>No hay viajes pendientes en este rango. Todo listo.</p>
              </div>
            ) : (
              <div className="pending-list">
                {pendingTrips.map((t) => {
                  const { done, total } = t.progress
                  const pctTrip = total > 0 ? Math.round((done / total) * 100) : 0
                  const pending = total - done
                  return (
                    <Link
                      key={t.id}
                      to={`/viajes/${t.id}`}
                      className="pending-row"
                      onClick={() => setShowPending(false)}
                    >
                      <div className="pending-main">
                        <strong>
                          {t.vehicle?.plate ?? '—'}
                          {t.branch?.name ? ` → ${t.branch.name}` : ''}
                        </strong>
                        <span className="muted small">
                          {new Date(t.departure_at).toLocaleString('es-VE', {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                          {' · '}
                          {t.driver?.full_name ?? 'Sin chofer'}
                        </span>
                        {t.notes && <span className="pending-notes">{t.notes}</span>}

                        {/* Avance de traslados */}
                        <span className="pending-progress">
                          <span className="progress-track">
                            <span
                              className={`progress-fill ${
                                pctTrip === 100 ? 'complete' : 'partial'
                              }`}
                              style={{ width: `${pctTrip}%` }}
                            />
                          </span>
                          <span className="progress-text">
                            <strong>
                              {done}/{total}
                            </strong>{' '}
                            traslados
                            {pending > 0 ? (
                              <em className="progress-pend"> · {pending} pendiente(s)</em>
                            ) : (
                              <em className="progress-done"> · ¡completado!</em>
                            )}
                          </span>
                        </span>
                      </div>
                      <div className="pending-side">
                        <span className={`badge badge-${t.status}`}>
                          {t.status === 'programado' ? 'Programado' : 'En curso'}
                        </span>
                        <ArrowRight size={16} className="pending-arrow" />
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
