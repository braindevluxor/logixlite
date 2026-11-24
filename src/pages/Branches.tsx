import { useEffect, useState, type FormEvent } from 'react'
import { Pencil, Plus, Power, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Branch } from '../lib/types'

export default function Branches() {
  const [items, setItems] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Branch | null>(null)
  const [name, setName] = useState('')
  const [externalId, setExternalId] = useState('')

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('branches')
      .select('*')
      .order('name', { ascending: true })
    if (error) setError(error.message)
    else setItems((data as Branch[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  function openCreate() {
    setEditing(null)
    setName('')
    setExternalId('')
    setShowForm(true)
  }

  function openEdit(b: Branch) {
    setEditing(b)
    setName(b.name)
    setExternalId(String(b.external_id))
    setShowForm(true)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const payload = {
      name: name.trim().toUpperCase(),
      external_id: Number(externalId),
    }
    if (!payload.name) return setError('El nombre es obligatorio')
    if (!payload.external_id || payload.external_id < 1)
      return setError('El ID de la API (branchID) es obligatorio')

    const query = editing
      ? supabase.from('branches').update(payload).eq('id', editing.id)
      : supabase.from('branches').insert(payload)

    const { error } = await query
    if (error) {
      setError(error.code === '23505' ? 'Ese branchID ya está registrado' : error.message)
      return
    }
    setShowForm(false)
    load()
  }

  async function onToggle(b: Branch) {
    const { error } = await supabase
      .from('branches')
      .update({ active: !b.active })
      .eq('id', b.id)
    if (error) setError(error.message)
    else load()
  }

  async function onDelete(b: Branch) {
    if (!confirm(`¿Eliminar la sucursal ${b.name}?`)) return
    const { error } = await supabase.from('branches').delete().eq('id', b.id)
    if (error) {
      setError(
        error.code === '23503'
          ? 'No se puede eliminar: tiene viajes asociados.'
          : error.message
      )
      return
    }
    load()
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Sucursales</h1>
        <button className="btn btn-primary" onClick={openCreate}>
          <Plus size={15} /> Nueva
        </button>
      </div>

      <p className="muted small">
        El <em>branchID</em> es el <code>ID TRABAJADORES</code> usado para consultar los
        empleados (pasajeros) de esa sucursal.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p className="muted">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="muted">
          No hay sucursales. Ejecuta el SQL de sembrado en Supabase → SQL Editor, o créalas
          con <strong>Nueva</strong>.
        </p>
      ) : (
        <ul className="list">
          {items.map((b) => (
            <li key={b.id}>
              <div className="list-item list-item-actions">
                <div>
                  <strong>{b.name}</strong>
                  <div className="muted small">branchID: {b.external_id}</div>
                </div>
                <div className="row gap-sm">
                  <span className={`badge badge-${b.active ? 'activo' : 'inactivo'}`}>
                    {b.active ? 'activa' : 'inactiva'}
                  </span>
                  <button className="btn btn-sm" onClick={() => openEdit(b)}>
                    <Pencil size={13} /> Editar
                  </button>
                  <button className="btn btn-sm" onClick={() => onToggle(b)}>
                    <Power size={13} /> {b.active ? 'Desactivar' : 'Activar'}
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => onDelete(b)}
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
            <h2>{editing ? 'Editar sucursal' : 'Nueva sucursal'}</h2>

            <label className="field">
              <span>Nombre *</span>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>

            <label className="field">
              <span>branchID (ID TRABAJADORES de la API) *</span>
              <input
                type="number"
                min={1}
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
                required
                placeholder="ej: 5"
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
