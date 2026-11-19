import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Branch, Driver, Trip, Vehicle } from '../lib/types'

interface TripRow extends Trip {
  branch?: Branch
  vehicle?: Vehicle
  driver?: Driver
}

const STATUS_LABEL: Record<string, string> = {
  programado: 'Programado',
  en_curso: 'En curso',
  finalizado: 'Finalizado',
  cancelado: 'Cancelado',
}

export default function Trips() {
  const [rows, setRows] = useState<TripRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'todos' | 'activos' | 'finalizados'>('activos')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const query = supabase
        .from('trips')
        .select(
          `*,
           branch:branches(*),
           vehicle:vehicles(*),
           driver:drivers(*)`
        )
        .order('departure_at', { ascending: false })

      const { data, error } = await query
      if (error) {
        setError(error.message)
      } else {
        setRows((data as unknown as TripRow[]) ?? [])
      }
      setLoading(false)
    }
    load()
  }, [])

  const filtered = rows.filter((r) => {
    if (filter === 'activos') return r.status === 'programado' || r.status === 'en_curso'
    if (filter === 'finalizados') return r.status === 'finalizado' || r.status === 'cancelado'
    return true
  })

  return (
    <div className="page">
      <div className="page-head">
        <h1>Viajes</h1>
        <Link className="btn btn-primary" to="/viajes/nuevo">
          <Plus size={15} /> Nuevo
        </Link>
      </div>

      <div className="seg">
        {(
          [
            ['activos', 'Activos'],
            ['finalizados', 'Historial'],
            ['todos', 'Todos'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={filter === key ? 'active' : ''}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p className="muted">Cargando…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">No hay viajes para este filtro.</p>
      ) : (
        <ul className="list">
          {filtered.map((t) => (
            <li key={t.id}>
              <Link className="list-item list-item-actions" to={`/viajes/${t.id}`}>
                <div>
                  <strong>
                    {t.vehicle?.plate ?? '—'}
                    {t.branch?.name ? ` → ${t.branch.name}` : ''}
                  </strong>
                  <div className="muted small">
                    {new Date(t.departure_at).toLocaleString('es-VE', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                    {' · '}
                    {t.driver?.full_name ?? 'Sin chofer'}
                  </div>
                </div>
                <span className={`badge badge-${t.status}`}>{STATUS_LABEL[t.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
