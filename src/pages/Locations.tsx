import { useEffect, useState, type FormEvent } from 'react'
import { ExternalLink, MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { up } from '../lib/format'
import { useSearch } from '../search/SearchContext'
import type { CatalogLocation } from '../lib/types'

/**
 * Gestión del catálogo de ubicaciones (/ubicaciones).
 * Permite ver todas las paradas/origenes y agregarles o
 * corregir el enlace de Google Maps para que la ruta del mapa
 * salga exacta.
 */
export default function Locations() {
  const [items, setItems] = useState<CatalogLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<CatalogLocation | null>(null)
  const [formName, setFormName] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [saving, setSaving] = useState(false)

  // Buscador global (barra superior)
  const { query: search } = useSearch()

  async function load() {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('locations')
      .select('*')
      .order('name', { ascending: true })
    if (err) setError(err.message)
    else setItems((data as CatalogLocation[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = items.filter((l) =>
    l.name.toLowerCase().includes(search.trim().toLowerCase())
  )
  const missingUrl = items.filter((l) => !l.maps_url?.trim()).length

  function openCreate() {
    setEditing(null)
    setFormName('')
    setFormUrl('')
    setError(null)
    setShowForm(true)
  }

  function openEdit(l: CatalogLocation) {
    setEditing(l)
    setFormName(l.name)
    setFormUrl(l.maps_url ?? '')
    setError(null)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditing(null)
    setFormName('')
    setFormUrl('')
    setError(null)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const name = formName.trim().toUpperCase()
    const url = formUrl.trim()
    if (!name) return setError('El nombre es obligatorio')
    // La URL es obligatoria la primera vez que se registra una
    // ubicacion (mismo criterio que el asistente de viajes)
    if (!url && !editing?.maps_url) {
      return setError('Coloca el enlace de Google Maps de la ubicación')
    }

    setSaving(true)
    const payload: Record<string, unknown> = { name, maps_url: url || null }
    const query = editing
      ? supabase.from('locations').update(payload).eq('id', editing.id)
      : supabase.from('locations').insert(payload)

    const { error: saveErr } = await query
    setSaving(false)
    if (saveErr) {
      setError(
        saveErr.code === '23505'
          ? 'Ya existe una ubicación con ese nombre'
          : saveErr.message
      )
      return
    }

    closeForm()
    load()
  }

  async function onDelete(l: CatalogLocation) {
    if (!confirm(`¿Eliminar "${l.name}" del catálogo? Los viajes anteriores no se modifican.`))
      return
    const { error: delErr } = await supabase.from('locations').delete().eq('id', l.id)
    if (delErr) {
      setError(delErr.message)
      return
    }
    load()
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>
          Ubicaciones
          {missingUrl > 0 && (
            <span className="loc-missing-badge">{missingUrl} sin enlace</span>
          )}
        </h1>
        <div className="page-head-actions">
          <button className="btn btn-primary" onClick={openCreate}>
            <Plus size={15} /> Nueva
          </button>
        </div>
      </div>

      <p className="muted small">
        Catálogo de paradas y orígenes. Agrega el enlace de Google Maps de cada una para
        que el mapa de la ruta dibuje el recorrido exacto.
      </p>

      {error && !showForm && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p className="muted">Cargando…</p>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">
            <MapPin size={32} />
          </span>
          <p className="muted">
            {items.length === 0
              ? 'Aún no hay ubicaciones registradas.'
              : `Ninguna ubicación coincide con "${search}".`}
          </p>
          {items.length === 0 && (
            <button className="btn btn-primary" onClick={openCreate}>
              <Plus size={15} /> Nueva ubicación
            </button>
          )}
        </div>
      ) : (
        <ul className="list">
          {filtered.map((l) => (
            <li key={l.id}>
              <div className="list-item list-item-actions">
                <div className="loc-info">
                  <strong>{up(l.name)}</strong>
                  <div className="muted small">
                    {l.maps_url?.trim() ? (
                      <a href={l.maps_url} target="_blank" rel="noreferrer">
                        <ExternalLink size={12} /> Abrir en Google Maps
                      </a>
                    ) : (
                      <span className="loc-no-url">sin enlace</span>
                    )}
                  </div>
                </div>
                <div className="row gap-sm">
                  <button className="btn btn-sm" onClick={() => openEdit(l)}>
                    <Pencil size={13} /> Editar
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => onDelete(l)}
                    aria-label={`Eliminar ${l.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ---------- Modal: crear / editar ubicación ---------- */}
      {showForm && (
        <div className="modal-backdrop" onClick={closeForm}>
          <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit}>
            <h2>{editing ? `Editar ${up(editing.name)}` : 'Nueva ubicación'}</h2>

            {error && <div className="alert alert-error">{error}</div>}

            <label className="field">
              <span>Nombre *</span>
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="EJ: TERMINAL VALENCIA"
                required
              />
            </label>

            <label className="field">
              <span>
                Enlace de Google Maps {editing?.maps_url ? '(opcional)' : '*'}
              </span>
              <input
                type="url"
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                placeholder="https://www.google.com/maps/…"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required={!editing?.maps_url}
              />
            </label>
            <p className="muted small" style={{ margin: '-0.4rem 0 0.7rem' }}>
              {editing?.maps_url
                ? 'Déjalo vacío para conservar el enlace actual.'
                : 'Obligatorio: sin el enlace el asistente pedirá la URL al usar esta ubicación.'}
            </p>

            <div className="row gap">
              <button type="button" className="btn" onClick={closeForm} disabled={saving}>
                Cancelar
              </button>
              <button className="btn btn-primary grow" disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
