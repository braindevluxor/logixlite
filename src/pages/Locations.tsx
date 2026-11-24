import { useEffect, useState, type FormEvent } from 'react'
import { ExternalLink, GitMerge, MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { up } from '../lib/format'
import { checkPointValue } from '../components/RouteMap'
import PointInput from '../components/PointInput'
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

  // ---- Unir dos ubicaciones en una ----
  const [mergeTarget, setMergeTarget] = useState<CatalogLocation | null>(null)
  const [mergeWith, setMergeWith] = useState('')
  const [merging, setMerging] = useState(false)
  const [mergeErr, setMergeErr] = useState<string | null>(null)

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
      return setError('Coloca el enlace de Google Maps o las coordenadas de la ubicación')
    }
    const urlErr = checkPointValue(url)
    if (urlErr) return setError(urlErr)

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

  // ---- Unir dos ubicaciones (ej: "LUXOR ACACIAS" + "ACACIAS LUXOR") ----
  function openMerge(l: CatalogLocation) {
    setMergeTarget(l)
    setMergeWith('')
    setMergeErr(null)
  }

  function closeMerge() {
    setMergeTarget(null)
    setMergeWith('')
    setMergeErr(null)
    setMerging(false)
  }

  /**
   * Une la ubicación elegida con otra: las paradas de los viajes
   * que usen el nombre duplicado pasan al nombre canónico, se
   * conserva el enlace de Google Maps y se elimina el duplicado.
   */
  async function confirmMerge() {
    if (!mergeTarget || !mergeWith) return
    const target = items.find((i) => String(i.id) === mergeWith)
    if (!target) return

    setMerging(true)
    setMergeErr(null)
    try {
      // 1) Paradas de los viajes: al nombre canónico
      const { error: upDest } = await supabase
        .from('trip_destinations')
        .update({ name: target.name })
        .ilike('name', mergeTarget.name)
      if (upDest) throw new Error(upDest.message)

      // 2) Conservar el enlace del duplicado si el canónico no tiene
      const dupUrl = (mergeTarget.maps_url ?? '').trim()
      const targetUrl = (target.maps_url ?? '').trim()
      if (dupUrl && !targetUrl) {
        const { error: upUrl } = await supabase
          .from('locations')
          .update({ maps_url: dupUrl })
          .eq('id', target.id)
        if (upUrl) throw new Error(upUrl.message)
      }

      // 3) Eliminar el duplicado
      const { error: delErr } = await supabase
        .from('locations')
        .delete()
        .eq('id', mergeTarget.id)
      if (delErr) throw new Error(delErr.message)

      closeMerge()
      load()
    } catch (err) {
      setMergeErr(err instanceof Error ? err.message : 'No se pudo unir')
      setMerging(false)
    }
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
                <div className="row gap-sm wrap">
                  <button
                    className="btn btn-sm"
                    onClick={() => openMerge(l)}
                    title="Unir esta ubicación con otra"
                  >
                    <GitMerge size={13} /> Unir
                  </button>
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

            <div className="field">
              <span>Ubicación en Google Maps {editing?.maps_url ? '(opcional)' : '*'}</span>
              <PointInput value={formUrl} onChange={setFormUrl} />
            </div>
            <p className="muted small" style={{ margin: '-0.4rem 0 0.7rem' }}>
              {editing?.maps_url
                ? 'Déjalo vacío para conservar el enlace actual.'
                : 'Obligatorio: márqualo en el mapa (por defecto), con coordenadas o con el enlace.'}
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

      {/* ---------- Modal: unir dos ubicaciones ---------- */}
      {mergeTarget && (
        <div className="modal-backdrop" onClick={closeMerge}>
          <div
            className="card modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Unir ubicaciones"
          >
            <h2>
              <GitMerge size={18} /> Unir ubicaciones
            </h2>
            <p className="muted small">
              Se unirá <strong>{up(mergeTarget.name)}</strong> con la que elijas: las
              paradas de los viajes que usen ese nombre pasarán al nombre elegido y el
              duplicado se eliminará. Si el duplicado tiene enlace de Google Maps y el
              otro no, el enlace se conserva.
            </p>

            <label className="field">
              <span>Unir con *</span>
              <select value={mergeWith} onChange={(e) => setMergeWith(e.target.value)}>
                <option value="">— Selecciona la ubicación correcta —</option>
                {items
                  .filter((i) => i.id !== mergeTarget.id)
                  .map((i) => (
                    <option key={i.id} value={String(i.id)}>
                      {up(i.name)}
                      {i.maps_url?.trim() ? '' : ' (sin enlace)'}
                    </option>
                  ))}
              </select>
            </label>

            {items.filter((i) => i.id !== mergeTarget.id).length === 0 && (
              <div className="alert alert-warn">
                No hay otra ubicación con la que unir. Crea primero la correcta.
              </div>
            )}

            {mergeErr && <div className="alert alert-error">{mergeErr}</div>}

            <div className="row gap">
              <button
                type="button"
                className="btn grow"
                onClick={closeMerge}
                disabled={merging}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary grow"
                onClick={confirmMerge}
                disabled={merging || !mergeWith}
              >
                {merging ? 'Uniendo…' : 'Unir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
