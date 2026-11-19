import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { TripStatus } from '../lib/types'

interface TripRow {
  id: number
  status: TripStatus
}

interface PassRow {
  dni: string | number
  full_name: string
  department: string | null
}

interface DeptStat {
  name: string
  count: number
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

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function localISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function startOfMonthISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`
}

// ===== Dona de traslados por departamento (SVG a mano) =====
function Donut({
  data,
  total,
}: {
  data: (DeptStat & { color: string })[]
  total: number
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
      <svg viewBox="0 0 200 200" className="donut" role="img" aria-label="Traslados por departamento">
        <g transform="rotate(-90 100 100)">
          <circle cx="100" cy="100" r={R} fill="none" stroke="#e2e8f0" strokeWidth="26" />
          {slices.map((s) => (
            <circle
              key={s.idx}
              cx="100"
              cy="100"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={hover === s.idx ? 32 : 26}
              strokeDasharray={`${s.dash} ${C - s.dash}`}
              strokeDashoffset={-s.acc}
              onMouseEnter={() => setHover(s.idx)}
              onMouseLeave={() => setHover(null)}
              style={{ transition: 'stroke-width 0.15s', cursor: 'pointer' }}
            />
          ))}
        </g>
        <text x="100" y="94" textAnchor="middle" className="donut-center-num">
          {active ? active.count : total}
        </text>
        <text x="100" y="116" textAnchor="middle" className="donut-center-label">
          {active ? 'traslados' : 'traslados totales'}
        </text>
        {active && (
          <text x="100" y="136" textAnchor="middle" className="donut-center-dept">
            {active.name.length > 22 ? active.name.slice(0, 21) + '…' : active.name}
          </text>
        )}
      </svg>
    </div>
  )
}

export default function Dashboard() {
  const [from, setFrom] = useState(startOfMonthISO)
  const [to, setTo] = useState(() => localISO(new Date()))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trips, setTrips] = useState<TripRow[]>([])
  const [passengers, setPassengers] = useState<PassRow[]>([])

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
        .select('id, status')
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

      if (ids.length > 0) {
        const { data, error } = await supabase
          .from('trip_passengers')
          .select('dni, full_name, department')
          .in('trip_id', ids)
        if (error) {
          if (!cancelled) {
            setError(error.message)
            setLoading(false)
          }
          return
        }
        passData = (data as PassRow[]) ?? []
      }

      if (!cancelled) {
        setTrips((tripData as TripRow[]) ?? [])
        setPassengers(passData)
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

  return (
    <div className="page">
      <div className="page-head">
        <h1>Dashboard</h1>
        <Link className="btn btn-primary" to="/viajes/nuevo">
          <Plus size={15} /> Nuevo viaje
        </Link>
      </div>

      {/* ---- Filtro de fechas ---- */}
      <div className="card date-filter">
        <Calendar size={17} className="date-filter-icon" />
        <label className="field">
          <span>Desde</span>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Hasta</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => e.target.value && setTo(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            setFrom(startOfMonthISO())
            setTo(localISO(new Date()))
          }}
        >
          Este mes
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p className="muted">Cargando…</p>
      ) : (
        <>
          {/* ---- Totales ---- */}
          <div className="stat-grid">
            <div className="card stat">
              <span className="stat-num stat-ok">{stats.listos}</span>
              <span className="stat-label">Viajes listos</span>
              <span className="muted small">finalizados</span>
            </div>
            <div className="card stat">
              <span className="stat-num stat-pend">{stats.pendientes}</span>
              <span className="stat-label">Viajes pendientes</span>
              <span className="muted small">programados + en curso</span>
            </div>
            <div className="card stat">
              <span className="stat-num">{stats.total}</span>
              <span className="stat-label">Total en el periodo</span>
              <span className="muted small">
                {stats.cancelados > 0 ? `${stats.cancelados} cancelado(s)` : 'sin cancelados'}
              </span>
            </div>
          </div>

          {/* ---- Gráfico de torta ---- */}
          <h2>Departamentos con más traslados</h2>
          <p className="muted small chart-sub">
            {from} → {to} · {totalTraslados} traslado(s) en {totalDepts} departamento(s)
          </p>

          {totalTraslados === 0 ? (
            <div className="card">
              <p className="muted">No hay pasajeros en el rango de fechas seleccionado.</p>
            </div>
          ) : (
            <div className="card chart-card">
              <div className="chart-grid">
                <Donut data={topDepts} total={totalTraslados} />
                <ul className="chart-legend">
                  {topDepts.map((d) => (
                    <li key={d.name}>
                      <span className="legend-dot" style={{ background: d.color }} />
                      <span className="legend-name">{d.name}</span>
                      <strong className="legend-count">{d.count}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
