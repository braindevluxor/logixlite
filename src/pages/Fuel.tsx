import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Fuel as FuelIcon, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchBcvRate } from '../lib/bcv'
import { useSearch } from '../search/SearchContext'
import type { FuelRecord, FuelType, PaymentMethod, Vehicle } from '../lib/types'

const FUEL_LABEL: Record<FuelType, string> = { gasolina: 'Gasolina', gnv: 'GNV' }
/** Unidad de medida según el combustible: litros o volumen (gas) */
const FUEL_UNIT: Record<FuelType, string> = { gasolina: 'Lts', gnv: 'Vol' }
const FUEL_TYPES: FuelType[] = ['gasolina', 'gnv']

const PAY_LABEL: Record<PaymentMethod, string> = {
  electronico: 'Electrónico',
  efectivo: 'Efectivo',
}
/** Dato que identifica cada forma de pago */
const PAY_REF_LABEL: Record<PaymentMethod, string> = {
  electronico: 'Referencia',
  efectivo: 'N° recibo Logística',
}

const fmtBs = (n: number) =>
  n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtUsd = (n: number) =>
  n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtQty = (n: number) => n.toLocaleString('es-VE', { maximumFractionDigits: 3 })

const pad = (n: number) => String(n).padStart(2, '0')

/** Fecha (yyyy-mm-dd) en la zona horaria LOCAL, no la del ISO */
function localDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Hora (HH:MM) en la zona horaria LOCAL */
function localTime(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function nowTime(): string {
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface FormState {
  vehicle_id: number | ''
  fuel_type: FuelType
  quantity: string
  station: string
  date: string
  time: string
  amount_bs: string
  rate: string
  payment_method: PaymentMethod
  payment_ref: string
  notes: string
}

function emptyForm(): FormState {
  return {
    vehicle_id: '',
    fuel_type: 'gasolina',
    quantity: '',
    station: '',
    date: todayISO(),
    time: nowTime(),
    amount_bs: '',
    rate: '',
    payment_method: 'electronico',
    payment_ref: '',
    notes: '',
  }
}

export default function FuelPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [rows, setRows] = useState<FuelRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** true si falta ejecutar supabase/fuel.sql en el proyecto */
  const [missingTable, setMissingTable] = useState(false)

  // Buscador global (barra superior)
  const { query: search } = useSearch()

  // Filtros del historial
  const [vehicleFilter, setVehicleFilter] = useState<number | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<'todos' | FuelType>('todos')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  // Formulario
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<FuelRecord | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)

  // Tasa BCV
  const [rateLoading, setRateLoading] = useState(false)
  /** la tasa actual fue cargada desde la API (si no, es manual) */
  const [rateFromApi, setRateFromApi] = useState(false)
  const [rateApiDate, setRateApiDate] = useState<string | null>(null)
  const [rateError, setRateError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const [v, r] = await Promise.all([
      supabase.from('vehicles').select('*').order('plate', { ascending: true }),
      supabase.from('fuel_records').select('*').order('fueled_at', { ascending: false }),
    ])

    if (v.error) setError(v.error.message)
    else setVehicles((v.data as Vehicle[]) ?? [])

    if (r.error) {
      // 42P01 = la tabla todavía no existe
      if (r.error.code === '42P01') setMissingTable(true)
      else setError(r.error.message)
    } else {
      setRows((r.data as FuelRecord[]) ?? [])
      setMissingTable(false)
    }

    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const vehicleById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles])

  const stations = useMemo(
    () => [...new Set(rows.map((r) => r.station.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')),
    [rows]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (vehicleFilter !== 'all' && r.vehicle_id !== vehicleFilter) return false
      if (typeFilter !== 'todos' && r.fuel_type !== typeFilter) return false
      const day = localDate(r.fueled_at)
      if (from && day < from) return false
      if (to && day > to) return false
      if (q) {
        const plate = vehicleById.get(r.vehicle_id)?.plate ?? ''
        if (!`${plate} ${r.station}`.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [rows, vehicleFilter, typeFilter, from, to, search, vehicleById])

  const totals = useMemo(
    () =>
      filtered.reduce(
        (acc, r) => {
          acc.bs += Number(r.amount_bs)
          acc.usd += Number(r.amount_usd)
          acc.qty += Number(r.quantity)
          if (r.fuel_type === 'gasolina') acc.lts += Number(r.quantity)
          else acc.vol += Number(r.quantity)
          acc.count++
          return acc
        },
        { bs: 0, usd: 0, qty: 0, lts: 0, vol: 0, count: 0 }
      ),
    [filtered]
  )

  const hasFilters = vehicleFilter !== 'all' || typeFilter !== 'todos' || !!from || !!to

  function clearFilters() {
    setVehicleFilter('all')
    setTypeFilter('todos')
    setFrom('')
    setTo('')
  }

  // ------------------------------------------------------------------
  // Formulario
  // ------------------------------------------------------------------
  function closeForm() {
    setShowForm(false)
    setError(null)
    setRateError(null)
  }

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setRateFromApi(false)
    setRateApiDate(null)
    setRateError(null)
    setError(null)
    setShowForm(true)
  }

  function openEdit(r: FuelRecord) {
    setEditing(r)
    setForm({
      vehicle_id: r.vehicle_id,
      fuel_type: r.fuel_type,
      quantity: String(r.quantity),
      station: r.station,
      date: localDate(r.fueled_at),
      time: localTime(r.fueled_at),
      amount_bs: String(r.amount_bs),
      rate: String(r.rate),
      payment_method: r.payment_method,
      payment_ref: r.payment_ref,
      notes: r.notes ?? '',
    })
    setRateFromApi(r.rate_source === 'bcv')
    setRateApiDate(r.rate_date)
    setRateError(null)
    setError(null)
    setShowForm(true)
  }

  /** Consulta la tasa BCV del día y la coloca en el formulario */
  async function loadRate() {
    setRateLoading(true)
    setRateError(null)
    try {
      const r = await fetchBcvRate()
      setForm((f) => ({ ...f, rate: String(r.rate) }))
      setRateFromApi(true)
      setRateApiDate(r.date)
    } catch (err) {
      setRateFromApi(false)
      setRateApiDate(null)
      setRateError(
        err instanceof Error
          ? `No se pudo consultar la tasa (${err.message}). Escríbela manualmente.`
          : 'No se pudo consultar la tasa BCV. Escríbela manualmente.'
      )
    } finally {
      setRateLoading(false)
    }
  }

  // Al crear, se intenta traer la tasa BCV automáticamente
  useEffect(() => {
    if (showForm && !editing) void loadRate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForm, editing])

  const selectedVehicle =
    typeof form.vehicle_id === 'number' ? vehicleById.get(form.vehicle_id) : undefined

  /** Tipos de combustible que admite el vehículo elegido */
  const allowedTypes: FuelType[] =
    !selectedVehicle || selectedVehicle.fuel_system === 'ambos'
      ? FUEL_TYPES
      : [selectedVehicle.fuel_system as FuelType]

  function onVehicleChange(value: string) {
    const id = value ? Number(value) : ''
    const veh = value ? vehicleById.get(Number(value)) : undefined
    setForm((f) => {
      const allowed: FuelType[] =
        !veh || veh.fuel_system === 'ambos' ? FUEL_TYPES : [veh.fuel_system as FuelType]
      return {
        ...f,
        vehicle_id: id,
        fuel_type: allowed.includes(f.fuel_type) ? f.fuel_type : allowed[0],
      }
    })
  }

  /** Conversión en vivo Bs → $ según la tasa escrita */
  const rateNum = form.rate.trim() ? Number(form.rate.replace(',', '.')) : NaN
  const amountNum = form.amount_bs.trim() ? Number(form.amount_bs.replace(',', '.')) : NaN
  const usdPreview =
    Number.isFinite(rateNum) && rateNum > 0 && Number.isFinite(amountNum) && amountNum >= 0
      ? amountNum / rateNum
      : null

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (form.vehicle_id === '') return setError('Selecciona el vehículo')

    const quantity = Number(form.quantity.replace(',', '.'))
    if (!Number.isFinite(quantity) || quantity <= 0)
      return setError(`La cantidad en ${FUEL_UNIT[form.fuel_type]} debe ser mayor a 0`)

    const station = form.station.trim()
    if (!station) return setError('La estación es obligatoria')

    const amountBs = Number(form.amount_bs.replace(',', '.'))
    if (!Number.isFinite(amountBs) || amountBs < 0)
      return setError('El monto en Bs es obligatorio')

    const rateValue = Number(form.rate.replace(',', '.'))
    if (!Number.isFinite(rateValue) || rateValue <= 0)
      return setError('La tasa (Bs por 1 $) debe ser mayor a 0')

    const ref = form.payment_ref.trim()
    if (!ref) return setError(`${PAY_REF_LABEL[form.payment_method]} es obligatorio`)

    const when = new Date(`${form.date}T${form.time || '00:00'}`)
    if (Number.isNaN(when.getTime())) return setError('La fecha y hora no son válidas')

    const payload = {
      vehicle_id: form.vehicle_id,
      fuel_type: form.fuel_type,
      quantity,
      station,
      fueled_at: when.toISOString(),
      amount_bs: amountBs,
      rate: rateValue,
      payment_method: form.payment_method,
      payment_ref: ref,
      rate_source: rateFromApi ? 'bcv' : 'manual',
      rate_date: rateFromApi ? rateApiDate : null,
      notes: form.notes.trim() || null,
    }

    setSaving(true)
    const query = editing
      ? supabase.from('fuel_records').update(payload).eq('id', editing.id)
      : supabase.from('fuel_records').insert(payload)
    const { error: saveErr } = await query
    setSaving(false)

    if (saveErr) return setError(saveErr.message)
    closeForm()
    load()
  }

  async function onDelete(r: FuelRecord) {
    const plate = vehicleById.get(r.vehicle_id)?.plate ?? 'este vehículo'
    if (!confirm(`¿Eliminar la carga del ${localDate(r.fueled_at)} en ${plate}?`)) return
    const { error: delErr } = await supabase.from('fuel_records').delete().eq('id', r.id)
    if (delErr) setError(delErr.message)
    else load()
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className="page">
      <div className="page-head">
        <h1>Combustible</h1>
        <button className="btn btn-primary" onClick={openCreate} disabled={vehicles.length === 0}>
          <Plus size={15} /> Nuevo registro
        </button>
      </div>

      {error && !showForm && <div className="alert alert-error">{error}</div>}

      {missingTable && (
        <div className="alert alert-error">
          Falta crear la tabla de combustible. Ejecuta el archivo <code>supabase/fuel.sql</code>{' '}
          en Supabase → SQL Editor y recarga esta página.
        </div>
      )}

      {vehicles.length === 0 && !loading && !missingTable && (
        <p className="muted">
          Primero crea al menos un vehículo en <strong>Vehículos</strong> para registrar cargas.
        </p>
      )}

      {/* ---------- Totales del filtro ---------- */}
      {!loading && rows.length > 0 && (
        <div className="stat-grid">
          <div className="card stat-card stat-total">
            <span className="stat-icon stat-icon-total">
              <FuelIcon size={20} />
            </span>
            <div className="stat-body">
              <span className="stat-num">Bs {fmtBs(totals.bs)}</span>
              <span className="stat-label">Total gastado</span>
              <span className="muted small">
                {totals.count} {totals.count === 1 ? 'carga' : 'cargas'} en el filtro
              </span>
            </div>
          </div>

          <div className="card stat-card stat-ok">
            <span className="stat-icon stat-icon-ok">
              <FuelIcon size={20} />
            </span>
            <div className="stat-body">
              <span className="stat-num">$ {fmtUsd(totals.usd)}</span>
              <span className="stat-label">Total en dólares</span>
              <span className="muted small">convertido con la tasa de cada carga</span>
            </div>
          </div>

          <div className="card stat-card stat-pend">
            <span className="stat-icon stat-icon-pend">
              <FuelIcon size={20} />
            </span>
            <div className="stat-body">
              <span className="stat-num">{fmtQty(totals.lts)}</span>
              <span className="stat-label">Gasolina (Lts)</span>
              <span className="muted small">suma de litros cargados</span>
            </div>
          </div>

          <div className="card stat-card stat-info">
            <span className="stat-icon stat-icon-info">
              <FuelIcon size={20} />
            </span>
            <div className="stat-body">
              <span className="stat-num">{fmtQty(totals.vol)}</span>
              <span className="stat-label">GNV (Vol)</span>
              <span className="muted small">suma de volumen cargado</span>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Filtros ---------- */}
      <div className="filters">
        <label className="field">
          <span>Vehículo</span>
          <select
            value={vehicleFilter}
            onChange={(e) =>
              setVehicleFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
            }
          >
            <option value="all">Todos los vehículos</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate}
                {v.brand ? ` · ${v.brand}` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Combustible</span>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'todos' | FuelType)}
          >
            <option value="todos">Todos</option>
            <option value="gasolina">Gasolina (Lts)</option>
            <option value="gnv">GNV (Vol)</option>
          </select>
        </label>

        <label className="field">
          <span>Desde</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>

        <label className="field">
          <span>Hasta</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>

        {hasFilters && (
          <button type="button" className="btn" onClick={clearFilters}>
            Limpiar
          </button>
        )}
      </div>

      {/* ---------- Historial ---------- */}
      {loading ? (
        <p className="muted">Cargando…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">
          {rows.length === 0
            ? 'Aún no hay cargas registradas. Usa "Nuevo registro" para cargar la primera.'
            : 'Ninguna carga coincide con los filtros.'}
        </p>
      ) : (
        <ul className="list">
          {filtered.map((r) => {
            const vehicle = vehicleById.get(r.vehicle_id)
            return (
              <li key={r.id}>
                <div className="list-item list-item-actions">
                  <div className="fuel-row-main">
                    <strong>
                      {vehicle?.plate ?? '—'} · {r.station}
                    </strong>
                    <div className="muted small">
                      {localDate(r.fueled_at)} {localTime(r.fueled_at)} · {fmtQty(r.quantity)}{' '}
                      {FUEL_UNIT[r.fuel_type]} · tasa {fmtQty(Number(r.rate))} Bs/$
                      {r.rate_source === 'manual' ? ' (manual)' : ''}
                    </div>
                    <div className="muted small">
                      {PAY_LABEL[r.payment_method]} · {PAY_REF_LABEL[r.payment_method]}:{' '}
                      {r.payment_ref}
                      {r.notes ? ` · ${r.notes}` : ''}
                    </div>
                  </div>

                  <div className="fuel-row-side">
                    <div className="fuel-amounts">
                      <strong>Bs {fmtBs(Number(r.amount_bs))}</strong>
                      <span className="muted small">$ {fmtUsd(Number(r.amount_usd))}</span>
                    </div>
                    <span className={`badge badge-${r.fuel_type}`}>
                      {FUEL_LABEL[r.fuel_type]}
                    </span>
                    <button className="btn btn-sm" onClick={() => openEdit(r)}>
                      <Pencil size={13} /> Editar
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => onDelete(r)}
                      aria-label="Eliminar carga"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* ---------- Modal: formulario ---------- */}
      {showForm && (
        <div className="modal-backdrop" onClick={closeForm}>
          <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit}>
            <h2>{editing ? 'Editar carga' : 'Nueva carga'}</h2>

            {error && <div className="alert alert-error">{error}</div>}

            <label className="field">
              <span>Vehículo *</span>
              <select value={form.vehicle_id} onChange={(e) => onVehicleChange(e.target.value)} required>
                <option value="">— Selecciona —</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.plate}
                    {v.brand ? ` · ${v.brand}` : ''}
                    {v.model ? ` ${v.model}` : ''}
                    {v.fuel_system !== 'ambos'
                      ? ` · ${FUEL_LABEL[v.fuel_system as FuelType]}`
                      : ''}
                  </option>
                ))}
              </select>
            </label>

            <div className="field">
              <span>Tipo de combustible *</span>
              <div className="seg">
                {allowedTypes.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={form.fuel_type === t ? 'active' : ''}
                    onClick={() => setForm({ ...form, fuel_type: t })}
                  >
                    {FUEL_LABEL[t]} ({FUEL_UNIT[t]})
                  </button>
                ))}
              </div>
            </div>

            <div className="row gap">
              <label className="field grow">
                <span>
                  Cantidad ({FUEL_UNIT[form.fuel_type]}) *
                </span>
                <input
                  type="number"
                  step="0.001"
                  min="0.001"
                  inputMode="decimal"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  placeholder={form.fuel_type === 'gasolina' ? 'ej: 45.5' : 'ej: 12.3'}
                  required
                />
              </label>
              <label className="field grow">
                <span>Estación *</span>
                <input
                  list="fuel-stations"
                  value={form.station}
                  onChange={(e) => setForm({ ...form, station: e.target.value })}
                  placeholder="ej: Petrolera Centro"
                  required
                />
                <datalist id="fuel-stations">
                  {stations.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </label>
            </div>

            <div className="row gap">
              <label className="field grow">
                <span>Fecha *</span>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  required
                />
              </label>
              <label className="field grow">
                <span>Hora *</span>
                <input
                  type="time"
                  value={form.time}
                  onChange={(e) => setForm({ ...form, time: e.target.value })}
                  required
                />
              </label>
            </div>

            <div className="row gap">
              <label className="field grow">
                <span>Monto (Bs) *</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={form.amount_bs}
                  onChange={(e) => setForm({ ...form, amount_bs: e.target.value })}
                  placeholder="ej: 45000.00"
                  required
                />
              </label>

              <div className="field grow">
                <span>Tasa BCV (Bs por 1 $) *</span>
                <span className="row gap-sm">
                  <input
                    className="grow"
                    type="number"
                    step="0.0001"
                    min="0.0001"
                    inputMode="decimal"
                    value={form.rate}
                    onChange={(e) => {
                      setForm({ ...form, rate: e.target.value })
                      setRateFromApi(false)
                      setRateApiDate(null)
                    }}
                    placeholder="ej: 918.7662"
                    required
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={loadRate}
                    disabled={rateLoading}
                    title="Consultar la tasa BCV del día"
                  >
                    <RefreshCw size={14} className={rateLoading ? 'spin' : ''} />
                    {rateLoading ? '…' : 'BCV'}
                  </button>
                </span>
                {rateFromApi && rateApiDate && (
                  <span className="muted small">Tasa BCV · fecha valor {rateApiDate}</span>
                )}
                {rateError && <span className="muted small">{rateError}</span>}
              </div>
            </div>

            <div className="fuel-convert">
              {usdPreview !== null ? (
                <>
                  <strong>$ {fmtUsd(usdPreview)}</strong>
                  <span className="muted small">
                    Bs {form.amount_bs || '0'} ÷ {fmtQty(rateNum || 0)} ·{' '}
                    {rateFromApi ? 'tasa BCV' : 'tasa manual'}
                  </span>
                </>
              ) : (
                <span className="muted small">
                  El monto en $ aparece aquí al escribir el monto y la tasa.
                </span>
              )}
            </div>

            <div className="field">
              <span>Tipo de pago *</span>
              <div className="seg">
                {(Object.keys(PAY_LABEL) as PaymentMethod[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={form.payment_method === m ? 'active' : ''}
                    onClick={() =>
                      setForm((f) =>
                        f.payment_method === m
                          ? f
                          : { ...f, payment_method: m, payment_ref: '' }
                      )
                    }
                  >
                    {PAY_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>

            <label className="field">
              <span>
                {form.payment_method === 'electronico'
                  ? 'Referencia del pago electrónico *'
                  : 'N° de recibo de entrega de Logística *'}
              </span>
              <input
                value={form.payment_ref}
                onChange={(e) => setForm({ ...form, payment_ref: e.target.value })}
                placeholder={
                  form.payment_method === 'electronico'
                    ? 'ej: 0010-0000-1234'
                    : 'ej: 004512'
                }
                required
              />
            </label>

            <label className="field">
              <span>Notas</span>
              <textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Opcional: tanque lleno, conductor, etc."
              />
            </label>

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
