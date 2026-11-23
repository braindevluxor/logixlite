import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Camera, Check, Download, Link2, Pencil, Plus, UserRound, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  driverPhotoUrl,
  removeDriverPhoto,
  uploadDriverPhoto,
} from '../lib/photos'
import { employeeFullName, fetchEmployees } from '../lib/talentoHumano'
import { useSearch } from '../search/SearchContext'
import type { ApiEmployee, Branch, Driver } from '../lib/types'

const EMPTY: Partial<Driver> = {
  dni: '',
  full_name: '',
  phone: '',
  license_number: '',
  license_expires: undefined,
  active: true,
  notes: '',
}

export default function Drivers() {
  const [items, setItems] = useState<Driver[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Driver | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<Partial<Driver>>(EMPTY)
  const [saving, setSaving] = useState(false)
  // Link publico: muestra "Copiado" un momento tras copiar
  const [copiedId, setCopiedId] = useState<number | null>(null)

  // Foto: archivo elegido (se sube al guardar) + preview local
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const oldPathRef = useRef<string | null>(null)

  // Buscador global (barra superior)
  const { query: search } = useSearch()

  // ---- Importación desde API ----
  const [showImport, setShowImport] = useState(false)
  const [branches, setBranches] = useState<Branch[]>([])
  const [importBranch, setImportBranch] = useState<number | 'all' | ''>('')
  const [onlyDriverRole, setOnlyDriverRole] = useState(true)
  const [importList, setImportList] = useState<ApiEmployee[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [importLoading, setImportLoading] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('drivers')
      .select('*')
      .order('full_name', { ascending: true })
    if (error) setError(error.message)
    else setItems((data as Driver[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  function closeForm() {
    if (photoPreview?.startsWith('blob:')) URL.revokeObjectURL(photoPreview)
    setShowForm(false)
    setPhotoFile(null)
    setPhotoPreview(null)
    setError(null)
  }

  function openCreate() {
    setEditing(null)
    setForm(EMPTY)
    setPhotoFile(null)
    setPhotoPreview(null)
    oldPathRef.current = null
    setError(null)
    setShowForm(true)
  }

  function openEdit(d: Driver) {
    setEditing(d)
    setForm(d)
    setPhotoFile(null)
    setPhotoPreview(driverPhotoUrl(d.photo_path ?? null))
    oldPathRef.current = d.photo_path ?? null
    setError(null)
    setShowForm(true)
  }

  function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite volver a elegir el mismo archivo
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('El archivo debe ser una imagen (JPG, PNG o WebP)')
      return
    }
    if (photoPreview?.startsWith('blob:')) URL.revokeObjectURL(photoPreview)
    setError(null)
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  function clearPhoto() {
    if (photoPreview?.startsWith('blob:')) URL.revokeObjectURL(photoPreview)
    setPhotoFile(null)
    setPhotoPreview(null)
    setForm((f) => ({ ...f, photo_path: null }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const base = {
      dni: (form.dni ?? '').trim(),
      full_name: (form.full_name ?? '').trim(),
      phone: form.phone?.trim() || null,
      license_number: form.license_number?.trim() || null,
      license_expires: form.license_expires || null,
      active: form.active ?? true,
      notes: form.notes?.trim() || null,
    }
    if (!base.dni) return setError('La cédula (DNI) es obligatoria')
    if (!base.full_name) return setError('El nombre es obligatorio')

    setSaving(true)
    let uploadedPath: string | null = null

    try {
      // Subir la foto (si se eligió una nueva) antes de guardar
      let photoPath = form.photo_path ?? null
      if (photoFile) {
        uploadedPath = await uploadDriverPhoto(photoFile)
        photoPath = uploadedPath
      }

      // photo_path solo viaja si hay valor o si se quito una foto
      // existente: sin la columna (driver_photos.sql) no se envia
      const payload: Record<string, unknown> = { ...base }
      if (photoPath) payload.photo_path = photoPath
      else if (editing?.photo_path && form.photo_path === null) payload.photo_path = null

      const query = editing
        ? supabase.from('drivers').update(payload).eq('id', editing.id)
        : supabase.from('drivers').insert(payload)

      const { error: saveErr } = await query
      if (saveErr) {
        if (uploadedPath) removeDriverPhoto(uploadedPath) // no dejar huérfana
        setError(
          saveErr.message.includes('photo_path')
            ? 'Ejecuta supabase/driver_photos.sql en el SQL Editor de Supabase para habilitar las fotos.'
            : saveErr.code === '23505'
              ? 'Ya existe un chofer con esa cédula'
              : saveErr.message
        )
        return
      }

      // Si se reemplazó o quitó la foto anterior, eliminarla del bucket
      const oldPath = oldPathRef.current
      if (oldPath && oldPath !== photoPath) removeDriverPhoto(oldPath)

      closeForm()
      load()
    } catch (err) {
      if (uploadedPath) removeDriverPhoto(uploadedPath)
      setError(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function onDelete(d: Driver) {
    if (!confirm(`¿Eliminar al chofer ${d.full_name}?`)) return
    const { error } = await supabase.from('drivers').delete().eq('id', d.id)
    if (error) {
      setError(
        error.code === '23503'
          ? 'No se puede eliminar: tiene viajes asociados. Puede marcarlo como inactivo.'
          : error.message
      )
      return
    }
    if (d.photo_path) removeDriverPhoto(d.photo_path)
    load()
  }

  // ---- Link publico del chofer (/chofer/<token>) ----
  async function copyLink(d: Driver) {
    setError(null)
    if (!d.link_token) {
      setError(
        'Este chofer aún no tiene link. Ejecuta supabase/driver_link.sql en el SQL Editor de Supabase.'
      )
      return
    }
    const url = `${window.location.origin}/chofer/${d.link_token}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(d.id)
      window.setTimeout(() => setCopiedId((v) => (v === d.id ? null : v)), 2200)
    } catch {
      // Navegadores sin permiso de portapapeles: muestra la URL
      window.prompt('Link público del chofer:', url)
    }
  }

  // ---- Importación ----
  async function openImport() {
    setShowImport(true)
    setImportList([])
    setChecked(new Set())
    setImportError(null)
    if (branches.length === 0) {
      const { data } = await supabase.from('branches').select('*').order('name')
      setBranches((data as Branch[]) ?? [])
    }
  }

  async function loadImportList() {
    if (importBranch === '') return
    setImportLoading(true)
    setImportError(null)
    setImportList([])
    try {
      let employees: ApiEmployee[] = []
      if (importBranch === 'all') {
        const results = await Promise.all(
          branches.map((b) => fetchEmployees(b.external_id))
        )
        employees = results.flat()
      } else {
        employees = await fetchEmployees(importBranch)
      }

      const filtered = onlyDriverRole
        ? employees.filter((e) => /chofer/i.test(e.role_name))
        : employees

      setImportList(filtered)
      setChecked(new Set(filtered.map((e) => String(e.dni))))
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Error al consultar la API')
    } finally {
      setImportLoading(false)
    }
  }

  function toggleChecked(dni: string) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(dni)) next.delete(dni)
      else next.add(dni)
      return next
    })
  }

  async function doImport() {
    const existing = new Set(items.map((d) => d.dni))
    const toInsert = importList
      .filter((e) => checked.has(String(e.dni)) && !existing.has(String(e.dni)))
      .map((e) => ({
        dni: String(e.dni),
        full_name: employeeFullName(e),
        active: e.active,
        notes: `Importado de API · ${e.role_name} · ${e.department_name}`,
      }))

    if (toInsert.length === 0) {
      setImportError('No hay choferes nuevos por importar (ya están registrados).')
      return
    }

    setImporting(true)
    setImportError(null)
    const { error } = await supabase.from('drivers').insert(toInsert)
    setImporting(false)

    if (error) {
      setImportError(
        error.code === '23505' ? 'Algunas cédulas ya existían; revisa la lista.' : error.message
      )
      return
    }

    setShowImport(false)
    load()
  }

  const existingDnis = new Set(items.map((d) => d.dni))
  const newCount = importList.filter(
    (e) => checked.has(String(e.dni)) && !existingDnis.has(String(e.dni))
  ).length

  const filtered = items.filter(
    (d) =>
      d.full_name.toLowerCase().includes(search.toLowerCase()) ||
      d.dni.includes(search)
  )

  return (
    <div className="page">
      <div className="page-head">
        <h1>Choferes</h1>
        <div className="row gap-sm">
          <button className="btn" onClick={openImport}>
            <Download size={15} /> Importar
          </button>
          <button className="btn btn-primary" onClick={openCreate}>
            <Plus size={15} /> Nuevo
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p className="muted">Cargando…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">
          No hay choferes registrados. Crea uno con <strong>Nuevo</strong> o usa{' '}
          <strong>Importar</strong> para traerlos desde la API.
        </p>
      ) : (
        <ul className="list">
          {filtered.map((d) => {
            const photo = driverPhotoUrl(d.photo_path ?? null)
            return (
              <li key={d.id}>
                <div className="list-item list-item-actions">
                  <div className="drv-id">
                    <span className="drv-avatar">
                      {photo ? (
                        <img src={photo} alt={d.full_name} loading="lazy" />
                      ) : (
                        <UserRound size={22} />
                      )}
                    </span>
                    <div>
                      <strong>{d.full_name}</strong>
                      <div className="muted small">
                        C.I. {d.dni}
                        {d.phone ? ` · ${d.phone}` : ''}
                        {d.license_number ? ` · Lic. ${d.license_number}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="row gap-sm">
                    <span className={`badge badge-${d.active ? 'activo' : 'inactivo'}`}>
                      {d.active ? 'activo' : 'inactivo'}
                    </span>
                    <button
                      className="btn btn-sm"
                      onClick={() => copyLink(d)}
                      title="Copiar link público del chofer"
                    >
                      {copiedId === d.id ? (
                        <>
                          <Check size={13} /> Copiado
                        </>
                      ) : (
                        <>
                          <Link2 size={13} /> Link
                        </>
                      )}
                    </button>
                    <button className="btn btn-sm" onClick={() => openEdit(d)}>
                      <Pencil size={13} /> Editar
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => onDelete(d)}
                      aria-label="Eliminar"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* ---------- Modal: formulario chofer ---------- */}
      {showForm && (
        <div className="modal-backdrop" onClick={closeForm}>
          <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit}>
            <h2>{editing ? 'Editar chofer' : 'Nuevo chofer'}</h2>

            {/* Foto del chofer */}
            <div
              className="photo-upload"
              onClick={() => fileRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  fileRef.current?.click()
                }
              }}
            >
              {photoPreview ? (
                <>
                  <img src={photoPreview} alt="Vista previa" />
                  <button
                    type="button"
                    className="photo-remove"
                    onClick={(e) => {
                      e.stopPropagation()
                      clearPhoto()
                    }}
                    aria-label="Quitar foto"
                  >
                    <X size={16} />
                  </button>
                </>
              ) : (
                <span className="photo-hint">
                  <Camera size={26} />
                  <strong>Tomar o elegir foto</strong>
                  <small>JPG, PNG o WebP · se optimiza automáticamente</small>
                </span>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={onPickPhoto}
            />

            <label className="field">
              <span>Cédula (DNI) *</span>
              <input
                value={form.dni ?? ''}
                onChange={(e) => setForm({ ...form, dni: e.target.value })}
                inputMode="numeric"
                required
              />
            </label>

            <label className="field">
              <span>Nombre completo *</span>
              <input
                value={form.full_name ?? ''}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                required
              />
            </label>

            <div className="row gap">
              <label className="field grow">
                <span>Teléfono</span>
                <input
                  value={form.phone ?? ''}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </label>
              <label className="field grow">
                <span>Licencia</span>
                <input
                  value={form.license_number ?? ''}
                  onChange={(e) => setForm({ ...form, license_number: e.target.value })}
                />
              </label>
            </div>

            <label className="field">
              <span>Vencimiento de licencia</span>
              <input
                type="date"
                value={form.license_expires ?? ''}
                onChange={(e) => setForm({ ...form, license_expires: e.target.value || undefined })}
              />
            </label>

            <label className="check">
              <input
                type="checkbox"
                checked={form.active ?? true}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              Activo
            </label>

            <label className="field">
              <span>Notas</span>
              <textarea
                rows={2}
                value={form.notes ?? ''}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>

            <div className="row gap">
              <button
                type="button"
                className="btn"
                onClick={closeForm}
                disabled={saving}
              >
                Cancelar
              </button>
              <button className="btn btn-primary grow" disabled={saving}>
                {saving
                  ? photoFile
                    ? 'Subiendo foto…'
                    : 'Guardando…'
                  : 'Guardar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ---------- Modal: importar desde API ---------- */}
      {showImport && (
        <div className="modal-backdrop" onClick={() => setShowImport(false)}>
          <div className="card modal" onClick={(e) => e.stopPropagation()}>
            <h2>Importar choferes desde la API</h2>

            <label className="field">
              <span>Sucursal</span>
              <select
                value={importBranch}
                onChange={(e) =>
                  setImportBranch(e.target.value === 'all' ? 'all' : e.target.value ? Number(e.target.value) : '')
                }
              >
                <option value="">— Selecciona —</option>
                <option value="all">Todas las sucursales</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.external_id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="check">
              <input
                type="checkbox"
                checked={onlyDriverRole}
                onChange={(e) => setOnlyDriverRole(e.target.checked)}
              />
              Solo cargos que contengan "Chofer"
            </label>

            <button
              className="btn btn-block"
              onClick={loadImportList}
              disabled={importBranch === '' || importLoading}
            >
              {importLoading ? 'Consultando API…' : 'Cargar empleados'}
            </button>

            {importError && <div className="alert alert-error">{importError}</div>}

            {importList.length > 0 && (
              <>
                <p className="muted small">
                  {importList.length} encontrado(s) · {newCount} nuevo(s) por importar
                </p>
                <ul className="list checkbox-list import-list">
                  {importList.map((e) => {
                    const dni = String(e.dni)
                    const already = existingDnis.has(dni)
                    return (
                      <li key={dni}>
                        <label className={`check-row ${already ? 'disabled' : ''}`}>
                          <input
                            type="checkbox"
                            checked={checked.has(dni)}
                            disabled={already}
                            onChange={() => toggleChecked(dni)}
                          />
                          <span>
                            <strong>{employeeFullName(e)}</strong>
                            <span className="muted small block">
                              C.I. {dni} · {e.role_name}
                              {already && ' · ya registrado'}
                              {!e.active && ' · inactivo'}
                            </span>
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}

            <div className="row gap" style={{ marginTop: '0.8rem' }}>
              <button className="btn" onClick={() => setShowImport(false)}>
                Cancelar
              </button>
              <button
                className="btn btn-primary grow"
                onClick={doImport}
                disabled={importing || newCount === 0}
              >
                {importing ? 'Importando…' : `Importar ${newCount} chofer(es)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
