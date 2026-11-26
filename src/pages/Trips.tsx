import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Inbox, Plus, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { up } from '../lib/format'
import { SOLICITUD_ORIGEN, type RideRequest } from '../lib/rideRequest'
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
  const navigate = useNavigate()
  const [rows, setRows] = useState<TripRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'todos' | 'activos' | 'finalizados'>('activos')

  // ---- Solicitudes de traslado (link público /solicitud) ----
  const [solicitudes, setSolicitudes] = useState<RideRequest[]>([])

  async function loadSolicitudes() {
    const { data, error: err } = await supabase
      .from('ride_requests')
      .select('*, ride_request_passengers(*)')
      .eq('status', 'pendiente')
      .order('created_at', { ascending: false })
    // Si el SQL no está ejecutado, la lista queda vacía sin romper
    setSolicitudes(err ? [] : ((data as unknown as RideRequest[]) ?? []))
  }

  async function resolveSolicitud(id: number, status: 'atendida' | 'cancelada') {
    if (status === 'cancelada' && !confirm('¿Descartar esta solicitud?')) return
    const { error: err } = await supabase
      .from('ride_requests')
      .update({ status })
      .eq('id', id)
    if (err) {
      setError(err.message)
      return
    }
    setSolicitudes((prev) => prev.filter((s) => s.id !== id))
  }

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
    loadSolicitudes()
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

      {/* ---- Solicitudes de traslado (link público) ---- */}
      {solicitudes.length > 0 && (
        <section className="sol-admin">
          <div className="sol-admin-head">
            <h2>
              <Inbox size={16} /> Solicitudes de traslado ({solicitudes.length})
            </h2>
          </div>
          <p className="muted small">
            Pedidos del link público <code>/solicitud</code> · origen fijo{' '}
            <strong>{SOLICITUD_ORIGEN}</strong>
          </p>
          <ul className="list">
            {solicitudes.map((s) => (
              <li key={s.id}>
                <div className="list-item sol-admin-row">
                  <div className="sol-admin-main">
                    <div className="muted small">
                      {new Date(s.created_at).toLocaleString('es-VE', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                      {s.contact_phone ? ` · ${s.contact_phone}` : ''}
                    </div>
                    <div className="sol-pax">
                      {s.ride_request_passengers.map((p) => (
                        <div key={p.id} className="sol-pax-line">
                          <strong>{up(p.full_name)}</strong>
                          <span className="muted"> → {up(p.destination)}</span>
                          <span className="muted small"> · C.I. {p.dni}</span>
                        </div>
                      ))}
                    </div>
                    {s.notes && <div className="obs-note">Obs: {s.notes}</div>}
                  </div>
                  <div className="row gap-sm wrap">
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => navigate(`/viajes/nuevo?solicitud=${s.id}`)}
                    >
                      <Plus size={13} /> Crear viaje
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => resolveSolicitud(s.id, 'cancelada')}
                      aria-label="Descartar solicitud"
                    >
                      <X size={13} /> Descartar
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

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
