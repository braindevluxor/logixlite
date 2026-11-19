import { useEffect, useState, type FormEvent } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Driver, Vehicle, VehicleStatus } from '../lib/types'

const EMPTY: Partial<Vehicle> = {
  plate: '',
  brand: '',
  model: '',
  year: undefined,
  capacity: 4,
  status: 'activo',
  notes: '',
  default_driver_id: null,
}

export default function Vehicles() {
  const [items, setItems] = useState<Vehicle[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Vehicle | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<Partial<Vehicle>>(EMPTY)

  async function load() {
    setLoading(true)
    const [v, d] = await Promise.all([
      supabase.from('vehicles').select('*').order('plate', { ascending: true }),
      supabase.from('drivers').select('*').order('full_name', { ascending: true }),
    ])
    if (v.error) setError(v.error.message)
    else setItems((v.data as Vehicle[]) ?? [])
    if (!d.error) setDrivers((d.data as Driver[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  function openCreate() {
    setEditing(null)
    setForm(EMPTY)
    setShowForm(true)
  }

  function openEdit(v: Vehicle) {
    setEditing(v)
    setForm(v)
    setShowForm(true)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const payload = {
      plate: (form.plate ?? '').trim().toUpperCase(),
      brand: form.brand?.trim() || null,
      model: form.model?.trim() || null,
      year: form.year ? Number(form.year) : null,
      capacity: Number(form.capacity),
      status: form.status ?? 'activo',
      notes: form.notes?.trim() || null,
      default_driver_id: form.default_driver_id ?? null,
    }
    if (!payload.plate) return setError('La placa es obligatoria')
    if (!payload.capacity || payload.capacity < 1)
      return setError('La capacidad debe ser al menos 1 puesto')

    const query = editing
      ? supabase.from('vehicles').update(payload).eq('id', editing.id)
      : supabase.from('vehicles').insert(payload)

    const { error } = await query
    if (error) {
      setError(
        error.code === '23505' ? 'Ya existe un vehículo con esa placa' : error.message
      )
      return
    }
    setShowForm(false)
    load()
  }

  async function onDelete(v: Vehicle) {
    if (!confirm(`¿Eliminar el vehículo ${v.plate}?`)) return
    const { error } = await supabase.from('vehicles').delete().eq('id', v.id)
    if (error) {
      setError(
        error.code === '23503'
          ? 'No se puede eliminar: tiene viajes asociados. Puede marcarlo como "inactivo".'
          : error.message
      )
      return
    }
    load()
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Vehículos</h1>
        <button className="btn btn-primary" onClick={openCreate}>
          <Plus size={15} /> Nuevo
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p className="muted">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="muted">No hay vehículos registrados.</p>
      ) : (
        <ul className="list">
          {items.map((v) => (
            <li key={v.id}>
              <div className="list-item list-item-actions">
                <div>
                  <strong>{v.plate}</strong>{' '}
                  <span className="muted">
                    {[v.brand, v.model, v.year].filter(Boolean).join(' ') || '—'}
                  </span>
                  <div className="muted small">
                    {v.capacity} puesto{v.capacity !== 1 ? 's' : ''}
                    {v.default_driver_id &&
                      ` · chofer: ${drivers.find((d) => d.id === v.default_driver_id)?.full_name ?? '—'}`}
                  </div>
                </div>
                <div className="row gap-sm">
                  <span className={`badge badge-${v.status}`}>{v.status}</span>
                  <button className="btn btn-sm" onClick={() => openEdit(v)}>
                    <Pencil size={13} /> Editar
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => onDelete(v)}
                    aria-label="Eliminar"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit}>
            <h2>{editing ? 'Editar vehículo' : 'Nuevo vehículo'}</h2>

            <label className="field">
              <span>Placa *</span>
              <input
                value={form.plate ?? ''}
                onChange={(e) => setForm({ ...form, plate: e.target.value })}
                placeholder="ABC123"
                required
              />
            </label>

            <div className="row gap">
              <label className="field grow">
                <span>Marca</span>
                <input
                  value={form.brand ?? ''}
                  onChange={(e) => setForm({ ...form, brand: e.target.value })}
                  placeholder="Toyota"
                />
              </label>
              <label className="field grow">
                <span>Modelo</span>
                <input
                  value={form.model ?? ''}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder="Hiace"
                />
              </label>
            </div>

            <div className="row gap">
              <label className="field grow">
                <span>Año</span>
                <input
                  type="number"
                  min={1980}
                  max={2100}
                  value={form.year ?? ''}
                  onChange={(e) =>
                    setForm({ ...form, year: e.target.value ? Number(e.target.value) : undefined })
                  }
                />
              </label>
              <label className="field grow">
                <span>Puestos (capacidad) *</span>
                <input
                  type="number"
                  min={1}
                  value={form.capacity ?? ''}
                  onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })}
                  required
                />
              </label>
            </div>

            <label className="field">
              <span>Estado</span>
              <select
                value={form.status ?? 'activo'}
                onChange={(e) => setForm({ ...form, status: e.target.value as VehicleStatus })}
              >
                <option value="activo">Activo</option>
                <option value="mantenimiento">Mantenimiento</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </label>

            <label className="field">
              <span>Chofer predeterminado</span>
              <select
                value={form.default_driver_id ?? ''}
                onChange={(e) =>
                  setForm({
                    ...form,
                    default_driver_id: e.target.value ? Number(e.target.value) : null,
                  })
                }
              >
                <option value="">— Ninguno —</option>
                {drivers
                  .filter((d) => d.active)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.full_name} (C.I. {d.dni})
                    </option>
                  ))}
              </select>
            </label>
            {drivers.filter((d) => d.active).length === 0 && (
              <p className="muted small">
                No hay choferes activos. Regístralos primero en la sección Choferes.
              </p>
            )}

            <label className="field">
              <span>Notas</span>
              <textarea
                rows={2}
                value={form.notes ?? ''}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>

            <div className="row gap">
              <button type="button" className="btn" onClick={() => setShowForm(false)}>
                Cancelar
              </button>
              <button className="btn btn-primary grow">Guardar</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
