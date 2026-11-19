import { useEffect, useState, type FormEvent } from 'react'
import { Download, Pencil, Plus, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
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

  function openCreate() {
    setEditing(null)
    setForm(EMPTY)
    setShowForm(true)
  }

  function openEdit(d: Driver) {
    setEditing(d)
    setForm(d)
    setShowForm(true)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const payload = {
      dni: (form.dni ?? '').trim(),
      full_name: (form.full_name ?? '').trim(),
      phone: form.phone?.trim() || null,
      license_number: form.license_number?.trim() || null,
      license_expires: form.license_expires || null,
      active: form.active ?? true,
      notes: form.notes?.trim() || null,
    }
    if (!payload.dni) return setError('La cédula (DNI) es obligatoria')
    if (!payload.full_name) return setError('El nombre es obligatorio')

    const query = editing
      ? supabase.from('drivers').update(payload).eq('id', editing.id)
      : supabase.from('drivers').insert(payload)

    const { error } = await query
    if (error) {
      setError(error.code === '23505' ? 'Ya existe un chofer con esa cédula' : error.message)
      return
    }
    setShowForm(false)
    load()
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
    load()
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
          {filtered.map((d) => (
            <li key={d.id}>
              <div className="list-item list-item-actions">
                <div>
                  <strong>{d.full_name}</strong>
                  <div className="muted small">
                    C.I. {d.dni}
                    {d.phone ? ` · ${d.phone}` : ''}
                    {d.license_number ? ` · Lic. ${d.license_number}` : ''}
                  </div>
                </div>
                <div className="row gap-sm">
                  <span className={`badge badge-${d.active ? 'activo' : 'inactivo'}`}>
                    {d.active ? 'activo' : 'inactivo'}
                  </span>
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
          ))}
        </ul>
      )}

      {/* ---------- Modal: formulario chofer ---------- */}
      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit}>
            <h2>{editing ? 'Editar chofer' : 'Nuevo chofer'}</h2>

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
              <button type="button" className="btn" onClick={() => setShowForm(false)}>
                Cancelar
              </button>
              <button className="btn btn-primary grow">Guardar</button>
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
