import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  Camera,
  Car,
  Gauge,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { removeVehiclePhoto, uploadVehiclePhoto, vehiclePhotoUrl } from '../lib/photos'
import { useSearch } from '../search/SearchContext'
import type { Driver, FuelSystem, Vehicle, VehicleStatus } from '../lib/types'

/** Cada cuantos KM se le debe hacer el cambio de aceite */
const OIL_CHANGE_KM = 5000

/** Fila devuelta al buscar el ultimo KM de un vehiculo */
type KmRow = {
  km: number | string
  arrived_at: string | null
}

type KmInfo = { km: number; at: string | null }

const EMPTY: Partial<Vehicle> = {
  plate: '',
  brand: '',
  model: '',
  year: undefined,
  capacity: 4,
  status: 'activo',
  notes: '',
  default_driver_id: null,
  photo_path: null,
  fuel_system: 'ambos',
}

const STATUS_LABELS: Record<VehicleStatus, string> = {
  activo: 'Activo',
  mantenimiento: 'Mantenimiento',
  inactivo: 'Inactivo',
}

const FUEL_SYSTEM_LABELS: Record<FuelSystem, string> = {
  gasolina: 'Gasolina',
  gnv: 'GNV',
  ambos: 'Gasolina + GNV',
}

export default function Vehicles() {
  const [items, setItems] = useState<Vehicle[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** Ultimo KM registrado por vehiculo (id -> km y fecha) */
  const [lastKm, setLastKm] = useState<Record<number, KmInfo>>({})

  const [editing, setEditing] = useState<Vehicle | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<Partial<Vehicle>>(EMPTY)
  const [saving, setSaving] = useState(false)

  // Buscador global (barra superior)
  const { query: search, setQuery } = useSearch()

  // Foto: archivo elegido (se sube al guardar) + preview local
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const oldPathRef = useRef<string | null>(null)

  async function load() {
    setLoading(true)
    const [v, d] = await Promise.all([
      supabase.from('vehicles').select('*').order('plate', { ascending: true }),
      supabase.from('drivers').select('*').order('full_name', { ascending: true }),
    ])
    const vehicles = (v.data as Vehicle[]) ?? []
    if (v.error) setError(v.error.message)
    else setItems(vehicles)
    if (!d.error) setDrivers((d.data as Driver[]) ?? [])

    // Ultimo KM registrado por vehiculo: una consulta por vehiculo
    // con limit 1 (el odometro es creciente, la llegada mas
    // reciente trae el KM mas alto)
    const kmEntries = await Promise.all(
      vehicles.map(async (veh) => {
        const { data } = await supabase
          .from('trip_passenger_destinations')
          .select('km, arrived_at, trip_passengers!inner(trip_id, trips!inner(vehicle_id))')
          .eq('trip_passengers.trips.vehicle_id', veh.id)
          .not('km', 'is', null)
          .order('arrived_at', { ascending: false })
          .limit(1)
        const row = (data as unknown as KmRow[] | null)?.[0]
        if (!row || row.km == null) return null
        return [veh.id, { km: Number(row.km), at: row.arrived_at }] as const
      })
    )
    const kmMap: Record<number, KmInfo> = {}
    for (const e of kmEntries) if (e) kmMap[e[0]] = e[1]
    setLastKm(kmMap)

    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = items.filter((v) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (
      String(v.plate ?? '').toLowerCase().includes(q) ||
      (v.brand ?? '').toLowerCase().includes(q) ||
      (v.model ?? '').toLowerCase().includes(q)
    )
  })

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

  function openEdit(v: Vehicle) {
    setEditing(v)
    setForm(v)
    setPhotoFile(null)
    setPhotoPreview(vehiclePhotoUrl(v.photo_path))
    oldPathRef.current = v.photo_path
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

    const payload = {
      plate: (form.plate ?? '').trim().toUpperCase(),
      brand: form.brand?.trim() || null,
      model: form.model?.trim() || null,
      year: form.year ? Number(form.year) : null,
      capacity: Number(form.capacity),
      status: form.status ?? 'activo',
      notes: form.notes?.trim() || null,
      default_driver_id: form.default_driver_id ?? null,
      fuel_system: form.fuel_system ?? 'ambos',
    }
    if (!payload.plate) return setError('La placa es obligatoria')
    if (!payload.capacity || payload.capacity < 1)
      return setError('La capacidad debe ser al menos 1 puesto')

    setSaving(true)
    let uploadedPath: string | null = null

    try {
      // Subir la foto (si se eligió una nueva) antes de guardar
      let photoPath = form.photo_path ?? null
      if (photoFile) {
        uploadedPath = await uploadVehiclePhoto(photoFile)
        photoPath = uploadedPath
      }

      const query = editing
        ? supabase
            .from('vehicles')
            .update({ ...payload, photo_path: photoPath })
            .eq('id', editing.id)
        : supabase.from('vehicles').insert({ ...payload, photo_path: photoPath })

      const { error: saveErr } = await query
      if (saveErr) {
        if (uploadedPath) removeVehiclePhoto(uploadedPath) // no dejar huérfana
        setError(
          saveErr.code === '23505'
            ? 'Ya existe un vehículo con esa placa'
            : saveErr.code === '42703'
              ? 'Falta el campo de combustible: ejecuta supabase/fuel.sql en Supabase → SQL Editor y recarga.'
              : saveErr.message
        )
        return
      }

      // Si se reemplazó o quitó la foto anterior, eliminarla del bucket
      const oldPath = oldPathRef.current
      if (oldPath && oldPath !== photoPath) removeVehiclePhoto(oldPath)

      closeForm()
      load()
    } catch (err) {
      if (uploadedPath) removeVehiclePhoto(uploadedPath)
      setError(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function onDelete(v: Vehicle) {
    if (!confirm(`¿Eliminar el vehículo ${v.plate}?`)) return
    const { error: delErr } = await supabase.from('vehicles').delete().eq('id', v.id)
    if (delErr) {
      setError(
        delErr.code === '23503'
          ? 'No se puede eliminar: tiene viajes asociados. Puede marcarlo como "inactivo".'
          : delErr.message
      )
      return
    }
    if (v.photo_path) removeVehiclePhoto(v.photo_path)
    load()
  }

  const driverName = (id: number | null) =>
    id ? (drivers.find((d) => d.id === id)?.full_name ?? null) : null

  const fmtKm = (n: number) => Math.round(n).toLocaleString('es-VE')

  /**
   * Progreso hacia el proximo cambio de aceite (cada 5000 KM):
   * cuenta desde el ultimo multiplo de 5000 del odometro.
   */
  function oilInfo(km: number) {
    const since = km % OIL_CHANGE_KM // KM desde el ultimo cambio
    const remaining = OIL_CHANGE_KM - since
    const pct = (since / OIL_CHANGE_KM) * 100
    if (km > 0 && since === 0) {
      return { pct: 100, tone: 'danger', text: 'Cambio de aceite pendiente' }
    }
    const tone = remaining <= 500 ? 'warn' : 'ok'
    return { pct, tone, text: `Cambio de aceite en ${fmtKm(remaining)} KM` }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Vehículos</h1>
        <div className="page-head-actions">
          <button className="btn btn-primary" onClick={openCreate}>
            <Plus size={15} /> Nuevo
          </button>
        </div>
      </div>

      {error && !showForm && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="veh-grid">
          {[0, 1, 2].map((i) => (
            <div key={i} className="veh-card skeleton">
              <div className="veh-photo sk-photo" />
              <div className="veh-body">
                <span className="sk-line wide" />
                <span className="sk-line" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">
            <Car size={34} />
          </span>
          <h2>Aún no hay vehículos</h2>
          <p className="muted">
            Registra el primero con su foto, capacidad de puestos y chofer
            predeterminado.
          </p>
          <button className="btn btn-primary" onClick={openCreate}>
            <Plus size={15} /> Nuevo vehículo
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">
            <Search size={30} />
          </span>
          <p className="muted">
            Ningún vehículo coincide con <strong>"{search}"</strong>.
          </p>
          <button className="btn" onClick={() => setQuery('')}>
            Limpiar búsqueda
          </button>
        </div>
      ) : (
        <div className="veh-grid">
          {filtered.map((v) => {
            const photo = vehiclePhotoUrl(v.photo_path)
            const driver = driverName(v.default_driver_id)
            const kmInfo = lastKm[v.id]
            const oil = kmInfo ? oilInfo(kmInfo.km) : null
            return (
              <article key={v.id} className="veh-card">
                <div className="veh-photo">
                  {photo ? (
                    <img src={photo} alt={v.plate} loading="lazy" />
                  ) : (
                    <Car size={44} strokeWidth={1.4} />
                  )}
                  <span className={`badge badge-${v.status}`}>
                    {STATUS_LABELS[v.status]}
                  </span>
                </div>

                <div className="veh-body">
                  <div className="veh-plate">{v.plate}</div>
                  <div className="veh-sub">
                    {[v.brand, v.model].filter(Boolean).join(' ') || '—'}
                    {v.year ? ` · ${v.year}` : ''}
                  </div>

                  <div className="veh-tags">
                    <span className="capacity-pill">{v.capacity} puestos</span>
                    <span className="fuel-pill">
                      {FUEL_SYSTEM_LABELS[v.fuel_system ?? 'ambos']}
                    </span>
                    {driver && (
                      <span className="veh-driver">
                        <UserRound size={12} /> {driver}
                      </span>
                    )}
                  </div>

                  {/* Ultimo KM registrado + proximo cambio de aceite */}
                  <div className="veh-km">
                    <div className="veh-km-top">
                      <span className="veh-km-title">
                        <Gauge size={13} /> Último KM
                      </span>
                      <span className="veh-km-right">
                        {kmInfo ? (
                          <>
                            <strong className="veh-km-value">
                              {fmtKm(kmInfo.km)} KM
                            </strong>
                            {kmInfo.at && (
                              <span className="veh-km-date">
                                {new Date(kmInfo.at).toLocaleDateString('es-VE', {
                                  dateStyle: 'short',
                                })}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="veh-km-date">Sin registro</span>
                        )}
                      </span>
                    </div>

                    {kmInfo && oil && (
                      <>
                        <span className="km-track">
                          <span
                            className={`km-fill km-${oil.tone}`}
                            style={{ width: `${oil.pct}%` }}
                          />
                        </span>
                        <span className={`veh-km-oil km-${oil.tone}`}>{oil.text}</span>
                      </>
                    )}
                  </div>

                  {v.notes && <div className="veh-notes">{v.notes}</div>}

                  <div className="veh-actions">
                    <button className="btn btn-sm" onClick={() => openEdit(v)}>
                      <Pencil size={13} /> Editar
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => onDelete(v)}
                      aria-label={`Eliminar ${v.plate}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {/* ---------- Modal: formulario ---------- */}
      {showForm && (
        <div className="modal-backdrop" onClick={closeForm}>
          <form
            className="card modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={onSubmit}
          >
            <h2>{editing ? `Editar ${editing.plate}` : 'Nuevo vehículo'}</h2>

            {error && <div className="alert alert-error">{error}</div>}

            {/* Foto */}
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
              <span>Placa *</span>
              <input
                value={form.plate ?? ''}
                onChange={(e) => setForm({ ...form, plate: e.target.value })}
                placeholder="ABC123"
                required
                autoCapitalize="characters"
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
                    setForm({
                      ...form,
                      year: e.target.value ? Number(e.target.value) : undefined,
                    })
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

            <div className="field">
              <span>Estado</span>
              <div className="seg">
                {(Object.keys(STATUS_LABELS) as VehicleStatus[]).map((s) => (
                  <button
                    type="button"
                    key={s}
                    className={form.status === s ? 'active' : ''}
                    onClick={() => setForm({ ...form, status: s })}
                  >
                    {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <span>Sistema de combustible</span>
              <div className="seg">
                {(Object.keys(FUEL_SYSTEM_LABELS) as FuelSystem[]).map((s) => (
                  <button
                    type="button"
                    key={s}
                    className={(form.fuel_system ?? 'ambos') === s ? 'active' : ''}
                    onClick={() => setForm({ ...form, fuel_system: s })}
                  >
                    {FUEL_SYSTEM_LABELS[s]}
                  </button>
                ))}
              </div>
              <span className="muted small">
                Define qué puede registrar en <strong>Combustible</strong>: gasolina en Lts, GNV
                en Vol, o ambos.
              </span>
            </div>

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

            <label className="field">
              <span>Notas</span>
              <textarea
                rows={2}
                value={form.notes ?? ''}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>

            <div className="row gap">
              <button type="button" className="btn" onClick={closeForm} disabled={saving}>
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
    </div>
  )
}
