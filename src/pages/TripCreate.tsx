import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Check, ChevronDown, ChevronUp, Flag, MapPin, Search, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { employeeFullName, fetchEmployees } from '../lib/talentoHumano'
import type {
  ApiEmployee,
  Branch,
  Driver,
  Trip,
  TripDestination,
  TripPassenger,
  Vehicle,
} from '../lib/types'

type Step = 1 | 2 | 3 | 4

interface SelectedPassenger {
  dni: string
  full_name: string
  role_name: string | null
  department: string | null
  branch_id: number | null
}

/** Convierte ISO a valor para input datetime-local (hora local) */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

export default function TripCreate() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const { id: editId } = useParams<{ id: string }>()
  const isEdit = !!editId

  const [step, setStep] = useState<Step>(1)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [editLoading, setEditLoading] = useState(isEdit)
  const [editBlocked, setEditBlocked] = useState(false)

  // Catálogos
  const [branches, setBranches] = useState<Branch[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])

  // Selección
  const [vehicleId, setVehicleId] = useState<number | ''>('')
  const [driverId, setDriverId] = useState<number | ''>('')
  const [departureAt, setDepartureAt] = useState(() => {
    const now = new Date()
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
    return now.toISOString().slice(0, 16)
  })
  const [notes, setNotes] = useState('')
  const [trackKm, setTrackKm] = useState(false)

  // Pasajeros (API)
  const [employees, setEmployees] = useState<ApiEmployee[]>([])
  const [loadingEmployees, setLoadingEmployees] = useState(false)
  const [employeeError, setEmployeeError] = useState<string | null>(null)
  const [employeeWarning, setEmployeeWarning] = useState<string | null>(null)
  const [passengerSearch, setPassengerSearch] = useState('')
  const [selected, setSelected] = useState<SelectedPassenger[]>([])
  const [onlyActive, setOnlyActive] = useState(true)

  // Destinos
  const [destinations, setDestinations] = useState<TripDestination[]>([])
  const [destName, setDestName] = useState('')
  // Asignación pasajero (dni) → posiciones de destino [1, 2, 3...]
  const [passengerDests, setPassengerDests] = useState<Record<string, number[]>>({})
  // Origen de cada pasajero (dni) → una sola posición (1, 2, 3...)
  const [passengerOrigins, setPassengerOrigins] = useState<Record<string, number>>({})

  const vehicle = vehicles.find((v) => v.id === vehicleId) ?? null
  const capacity = vehicle?.capacity ?? 0

  useEffect(() => {
    async function load() {
      const [b, v, d] = await Promise.all([
        supabase.from('branches').select('*').eq('active', true).order('name'),
        isEdit
          ? supabase.from('vehicles').select('*').order('plate')
          : supabase.from('vehicles').select('*').eq('status', 'activo').order('plate'),
        isEdit
          ? supabase.from('drivers').select('*').order('full_name')
          : supabase.from('drivers').select('*').eq('active', true).order('full_name'),
      ])
      if (b.error || v.error || d.error) {
        setError(b.error?.message || v.error?.message || d.error?.message || null)
        return
      }
      setBranches((b.data as Branch[]) ?? [])
      setVehicles((v.data as Vehicle[]) ?? [])
      setDrivers((d.data as Driver[]) ?? [])
    }
    load()
  }, [isEdit])

  // ---- Modo edición: cargar el viaje existente ----
  useEffect(() => {
    if (!editId) return
    let cancelled = false

    async function loadTrip() {
      const { data: trip, error: tErr } = await supabase
        .from('trips')
        .select('*')
        .eq('id', editId!)
        .maybeSingle()
      if (cancelled) return
      if (tErr) {
        setError(tErr.message)
        setEditLoading(false)
        return
      }
      if (!trip) {
        setError('Viaje no encontrado')
        setEditLoading(false)
        return
      }
      const t = trip as Trip
      if (t.status !== 'programado') {
        setEditBlocked(true)
        setEditLoading(false)
        return
      }

      const [p, d] = await Promise.all([
        supabase.from('trip_passengers').select('*').eq('trip_id', editId!),
        supabase
          .from('trip_destinations')
          .select('*')
          .eq('trip_id', editId!)
          .order('position'),
      ])
      if (cancelled) return
      if (p.error || d.error) {
        setError(p.error?.message || d.error?.message || null)
        setEditLoading(false)
        return
      }

      const passRows = (p.data as TripPassenger[]) ?? []
      const destRows = (d.data as TripDestination[]) ?? []

      // Asignaciones pasajero ↔ destino
      let links: { trip_passenger_id: number; trip_destination_id: number }[] = []
      if (passRows.length > 0) {
        const { data: lData, error: lErr } = await supabase
          .from('trip_passenger_destinations')
          .select('trip_passenger_id, trip_destination_id, seq')
          .in(
            'trip_passenger_id',
            passRows.map((x) => x.id)
          )
        if (cancelled) return
        if (lErr) {
          setError(lErr.message)
          setEditLoading(false)
          return
        }
        links = (lData as typeof links) ?? []
      }

      // Mapear IDs reales → posiciones (1..n) del estado local
      const destIdToPos = new Map(destRows.map((x) => [x.id, x.position]))
      const passIdToDni = new Map(passRows.map((x) => [x.id, x.dni]))

      const origins: Record<string, number> = {}
      for (const pRow of passRows) {
        if (pRow.origin_destination_id != null) {
          const pos = destIdToPos.get(pRow.origin_destination_id)
          if (pos != null) origins[pRow.dni] = pos
        }
      }

      const dests: Record<string, number[]> = {}
      // Ordenar por seq (orden de bajada propio de cada pasajero)
      const grouped = new Map<
        number,
        { pos: number; seq: number }[]
      >()
      for (const l of links) {
        const pos = destIdToPos.get(l.trip_destination_id)
        const seq = (l as { seq?: number }).seq
        if (pos == null) continue
        const arr = grouped.get(l.trip_passenger_id) ?? []
        arr.push({ pos, seq: seq ?? pos })
        grouped.set(l.trip_passenger_id, arr)
      }
      for (const [passId, arr] of grouped) {
        const dni = passIdToDni.get(passId)
        if (!dni) continue
        arr.sort((a, b) => a.seq - b.seq)
        dests[dni] = arr.map((x) => x.pos)
      }

      if (cancelled) return
      setVehicleId(t.vehicle_id)
      setDriverId(t.driver_id)
      setDepartureAt(toLocalInput(t.departure_at))
      setNotes(t.notes ?? '')
      setTrackKm(!!t.track_km)
      setDestinations(destRows)
      setSelected(
        passRows.map((x) => ({
          dni: x.dni,
          full_name: x.full_name,
          role_name: x.role_name,
          department: x.department,
          branch_id: x.branch_id,
        }))
      )
      setPassengerOrigins(origins)
      setPassengerDests(dests)
      setEditLoading(false)
    }

    loadTrip()
    return () => {
      cancelled = true
    }
  }, [editId])

  // Cargar empleados de TODAS las sucursales (los pasajeros pueden
  // venir de cualquier branch, incluso combinados en un mismo viaje)
  const loadEmployees = useCallback(async () => {
    if (branches.length === 0) {
      setEmployees([])
      return
    }
    setLoadingEmployees(true)
    setEmployeeError(null)
    setEmployeeWarning(null)
    try {
      const ids = branches.map((b) => b.external_id)
      const results = await Promise.allSettled(ids.map((id) => fetchEmployees(id)))
      const ok = results.filter(
        (r): r is PromiseFulfilledResult<ApiEmployee[]> => r.status === 'fulfilled'
      )
      const failed = results.length - ok.length

      if (ok.length === 0) {
        throw new Error('No se pudo consultar la API de empleados en ninguna sucursal')
      }

      // Dedupe por dni por si una cédula apareciera en más de una sucursal
      const seen = new Set<string>()
      const all = ok.flatMap((r) => r.value).filter((e) => {
        const dni = String(e.dni)
        if (seen.has(dni)) return false
        seen.add(dni)
        return true
      })

      setEmployees(all)
      if (failed > 0) {
        setEmployeeWarning(
          `${failed} sucursal(es) no respondieron. Los pasajeros podrían estar incompletos.`
        )
      }
    } catch (err) {
      setEmployeeError(err instanceof Error ? err.message : 'Error al consultar empleados')
      setEmployees([])
    } finally {
      setLoadingEmployees(false)
    }
  }, [branches])

  // Cargar cuando las sucursales estén listas (una sola vez)
  useEffect(() => {
    loadEmployees()
  }, [loadEmployees])

  const selectedDnis = useMemo(() => new Set(selected.map((p) => p.dni)), [selected])

  /** Seleccionados que ya no aparecen en la API (viajes antiguos) */
  const selectedMissing = useMemo(
    () => selected.filter((p) => !employees.some((e) => String(e.dni) === p.dni)),
    [selected, employees]
  )

  const filteredEmployees = useMemo(() => {
    const q = passengerSearch.trim().toLowerCase()

    const matchesSearch = (e: ApiEmployee): boolean => {
      if (!q) return true
      return (
        employeeFullName(e).toLowerCase().includes(q) ||
        String(e.dni).includes(q) ||
        e.role_name.toLowerCase().includes(q) ||
        e.department_name.toLowerCase().includes(q) ||
        e.branch_name.toLowerCase().includes(q)
      )
    }

    // 1) Seleccionados: SIEMPRE visibles, aunque no coincidan con
    //    la búsqueda ni estén inactivos (ya fueron elegidos)
    const selectedList = employees.filter((e) => selectedDnis.has(String(e.dni)))

    // 2) No seleccionados: SOLO si hay búsqueda escrita
    //    (con la búsqueda vacía no se lista nada)
    const matchesList = q
      ? employees.filter(
          (e) =>
            !selectedDnis.has(String(e.dni)) &&
            (!onlyActive || e.active) &&
            matchesSearch(e)
        )
      : []

    return [...selectedList, ...matchesList]
  }, [employees, passengerSearch, onlyActive, selectedDnis])

  /** true si aún no se ha escrito nada en la búsqueda */
  const searchEmpty = passengerSearch.trim().length === 0

  const overCapacity = capacity > 0 && selected.length > capacity

  function togglePassenger(e: ApiEmployee) {
    const dni = String(e.dni)
    setSelected((prev) => {
      if (prev.some((p) => p.dni === dni)) {
        return prev.filter((p) => p.dni !== dni)
      }
      if (capacity > 0 && prev.length >= capacity) {
        setError(`El vehículo solo tiene ${capacity} puestos`)
        return prev
      }
      setError(null)
      return [
        ...prev,
        {
          dni,
          full_name: employeeFullName(e),
          role_name: e.role_name || null,
          department: e.department_name || null,
          branch_id: e.branch_id,
        },
      ]
    })
  }

  function selectAllFiltered() {
    if (capacity > 0 && filteredEmployees.length > capacity) {
      setError(`Solo hay ${capacity} puestos disponibles`)
      return
    }
    const additions = filteredEmployees
      .filter((e) => !selectedDnis.has(String(e.dni)))
      .map((e) => ({
        dni: String(e.dni),
        full_name: employeeFullName(e),
        role_name: e.role_name || null,
        department: e.department_name || null,
        branch_id: e.branch_id,
      }))
    const total = selected.length + additions.length
    if (capacity > 0 && total > capacity) {
      setError(`Capacidad excedida: ${capacity} puestos, selección de ${total}`)
      return
    }
    setError(null)
    setSelected((prev) => [...prev, ...additions])
  }

  // ---- Destinos ----
  function addDestination() {
    const name = destName.trim()
    if (!name) return
    setDestinations((prev) => [
      ...prev,
      {
        id: prev.length + 1, // temporal, se reemplaza al guardar
        trip_id: 0,
        position: prev.length + 1,
        name,
        notes: null,
      },
    ])
    setDestName('')
    setError(null)
  }

  function removeDestination(pos: number) {
    setDestinations((prev) => {
      const next = prev
        .filter((d) => d.position !== pos)
        .map((d, i) => ({ ...d, position: i + 1 }))
      // Reasignar posiciones en los pasajeros: quitar la eliminada y recorrer
      setPassengerDests((pd) => {
        const out: Record<string, number[]> = {}
        for (const [dni, positions] of Object.entries(pd)) {
          out[dni] = positions
            .filter((p) => p !== pos)
            .map((p) => (p > pos ? p - 1 : p))
        }
        return out
      })
      // El origen apunta a una parada: recorrer o limpiar
      setPassengerOrigins((po) => {
        const out: Record<string, number> = {}
        for (const [dni, p] of Object.entries(po)) {
          if (p === pos) continue // parada eliminada: queda sin origen
          out[dni] = p > pos ? p - 1 : p
        }
        return out
      })
      return next
    })
  }

  function moveDestination(pos: number, dir: -1 | 1) {
    setDestinations((prev) => {
      const idx = prev.findIndex((d) => d.position === pos)
      const target = idx + dir
      if (idx < 0 || target < 0 || target >= prev.length) return prev
      const copy = [...prev]
      ;[copy[idx], copy[target]] = [copy[target], copy[idx]]
      const renumbered = copy.map((d, i) => ({ ...d, position: i + 1 }))
      // Intercambiar también las posiciones asignadas a los pasajeros
      const newPos1 = idx + 1
      const newPos2 = target + 1
      const swap = (p: number) => (p === newPos1 ? newPos2 : p === newPos2 ? newPos1 : p)
      setPassengerDests((pd) => {
        const out: Record<string, number[]> = {}
        for (const [dni, positions] of Object.entries(pd)) {
          out[dni] = positions.map(swap)
        }
        return out
      })
      setPassengerOrigins((po) => {
        const out: Record<string, number> = {}
        for (const [dni, p] of Object.entries(po)) {
          out[dni] = swap(p)
        }
        return out
      })
      return renumbered
    })
  }

  // ---- Asignación pasajero ↔ destino ----
  function togglePassengerDest(dni: string, pos: number) {
    setPassengerDests((prev) => {
      const current = prev[dni] ?? []
      if (current.includes(pos)) {
        return { ...prev, [dni]: current.filter((p) => p !== pos) }
      }
      // Se agrega al final: el orden de clic es el orden de bajada
      return { ...prev, [dni]: [...current, pos] }
    })
  }

  /** Reordenar la secuencia de bajada de UN pasajero */
  function movePassengerDest(dni: string, idx: number, dir: -1 | 1) {
    setPassengerDests((prev) => {
      const arr = [...(prev[dni] ?? [])]
      const j = idx + dir
      if (j < 0 || j >= arr.length) return prev
      ;[arr[idx], arr[j]] = [arr[j], arr[idx]]
      return { ...prev, [dni]: arr }
    })
  }

  function assignAllDests(dni: string) {
    setPassengerDests((prev) => ({
      ...prev,
      [dni]: destinations.map((d) => d.position),
    }))
  }

  function clearPassengerDests(dni: string) {
    setPassengerDests((prev) => ({ ...prev, [dni]: [] }))
  }

  // ---- Origen del pasajero (una sola parada) ----
  function setPassengerOrigin(dni: string, pos: number | null) {
    setPassengerOrigins((prev) => {
      const out = { ...prev }
      if (pos === null) delete out[dni]
      else out[dni] = pos
      return out
    })
  }

  /** Pasajeros sin al menos un destino asignado */
  const passengersWithoutDest = selected.filter(
    (p) => (passengerDests[p.dni] ?? []).length === 0
  )

  /** Pasajeros sin origen asignado */
  const passengersWithoutOrigin = selected.filter(
    (p) => passengerOrigins[p.dni] == null
  )

  // ---- Validaciones por paso ----
  function canNext(): boolean {
    if (step === 1) return vehicleId !== '' && driverId !== ''
    if (step === 2) return selected.length > 0 && !overCapacity
    if (step === 3)
      return (
        destinations.length > 0 &&
        passengersWithoutDest.length === 0 &&
        passengersWithoutOrigin.length === 0
      )
    return true
  }

  // ---- Guardar ----
  async function save() {
    if (!vehicleId || !driverId) return
    if (selected.length === 0) return setError('Selecciona al menos un pasajero')
    if (overCapacity) return setError('La cantidad de pasajeros excede la capacidad')
    if (destinations.length === 0) return setError('Agrega al menos una ubicación')
    if (passengersWithoutOrigin.length > 0)
      return setError(
        `Falta el origen de ${passengersWithoutOrigin.length} pasajero(s). Elige de qué parada suben.`
      )
    if (passengersWithoutDest.length > 0)
      return setError(
        `Falta la ubicación de ${passengersWithoutDest.length} pasajero(s).`
      )

    setSaving(true)
    setError(null)

    let tripId: number

    if (isEdit) {
      // ---- EDICIÓN: actualizar el viaje y reemplazar hijos ----
      const { data: trip, error: tripErr } = await supabase
        .from('trips')
        .update({
          vehicle_id: vehicleId,
          driver_id: driverId,
          departure_at: new Date(departureAt).toISOString(),
          notes: notes.trim() || null,
          track_km: trackKm,
        })
        .eq('id', Number(editId))
        .eq('status', 'programado') // por si otro usuario lo inició a la vez
        .select('id')
        .single()

      if (tripErr || !trip) {
        setError(
          tripErr?.message.includes('iniciado')
            ? tripErr.message
            : 'No se pudo actualizar: el viaje pudo haber cambiado de estado. Recarga e inténtalo.'
        )
        setSaving(false)
        return
      }

      tripId = trip.id as number

      // Reemplazar hijos: primero pasajeros (borra en cascada las
      // asignaciones), luego destinos. Solo permitido en viaje programado
      // (lo garantizan los triggers de BD).
      const delPass = await supabase
        .from('trip_passengers')
        .delete()
        .eq('trip_id', tripId)
      if (delPass.error) {
        setError(delPass.error.message)
        setSaving(false)
        return
      }

      const delDest = await supabase
        .from('trip_destinations')
        .delete()
        .eq('trip_id', tripId)
      if (delDest.error) {
        setError(delDest.error.message)
        setSaving(false)
        return
      }
    } else {
      // ---- CREACIÓN ----
      const { data: trip, error: tripErr } = await supabase
        .from('trips')
        .insert({
          vehicle_id: vehicleId,
          driver_id: driverId,
          departure_at: new Date(departureAt).toISOString(),
          notes: notes.trim() || null,
          track_km: trackKm,
          created_by: session?.user.id ?? null,
        })
        .select('id')
        .single()

      if (tripErr || !trip) {
        setError(tripErr?.message ?? 'No se pudo crear el viaje')
        setSaving(false)
        return
      }

      tripId = trip.id as number
    }

    // 1) Destinos PRIMERO (los pasajeros referencian su origen)
    const destRes = await supabase
      .from('trip_destinations')
      .insert(
        destinations.map((d) => ({
          trip_id: tripId,
          position: d.position,
          name: d.name,
          notes: d.notes,
        }))
      )
      .select('id, position')

    if (destRes.error) {
      setError(destRes.error.message)
      setSaving(false)
      return
    }

    const destIdByPos = new Map<number, number>(
      (destRes.data ?? []).map((d) => [d.position as number, d.id as number])
    )

    // 2) Pasajeros con su origen (FK a la parada elegida)
    const passRes = await supabase
      .from('trip_passengers')
      .insert(
        selected.map((p) => ({
          trip_id: tripId,
          dni: p.dni,
          full_name: p.full_name,
          role_name: p.role_name,
          department: p.department,
          branch_id: p.branch_id,
          origin_destination_id:
            passengerOrigins[p.dni] != null
              ? destIdByPos.get(passengerOrigins[p.dni]) ?? null
              : null,
        }))
      )
      .select('id, dni')

    if (passRes.error) {
      setError(passRes.error.message)
      setSaving(false)
      return
    }

    // 3) Asignaciones pasajero ↔ destino (muchos a muchos)
    const passIdByDni = new Map<string, number>(
      (passRes.data ?? []).map((p) => [p.dni as string, p.id as number])
    )

    const links: {
      trip_passenger_id: number
      trip_destination_id: number
      seq: number
    }[] = []
    for (const p of selected) {
      const passId = passIdByDni.get(p.dni)
      if (!passId) continue
      const positions = passengerDests[p.dni] ?? []
      for (let i = 0; i < positions.length; i++) {
        const destId = destIdByPos.get(positions[i])
        if (destId)
          links.push({
            trip_passenger_id: passId,
            trip_destination_id: destId,
            seq: i + 1, // orden de bajada de ESTE pasajero
          })
      }
    }

    if (links.length > 0) {
      const { error: linkErr } = await supabase
        .from('trip_passenger_destinations')
        .insert(links)
      if (linkErr) {
        setError(`Viaje creado, pero falló la asignación de destinos: ${linkErr.message}`)
        setSaving(false)
        navigate(`/viajes/${tripId}`)
        return
      }
    }

    navigate(`/viajes/${tripId}`)
  }

  // ---- Modo edición: pantalla de carga / bloqueo ----
  if (editLoading) {
    return (
      <div className="page">
        <p className="muted">Cargando viaje…</p>
      </div>
    )
  }

  if (editBlocked) {
    return (
      <div className="page">
        <div className="page-head">
          <h1>Editar viaje</h1>
          <Link className="btn btn-sm" to={`/viajes/${editId}`}>
            Volver
          </Link>
        </div>
        <div className="alert alert-error">
          Este viaje ya fue iniciado y no se puede editar. Solo los viajes en estado{' '}
          <strong>programado</strong> son editables.
        </div>
        <Link className="btn btn-primary" to={`/viajes/${editId}`}>
          Ver viaje
        </Link>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>{isEdit ? `Editar viaje #${editId}` : 'Nuevo viaje'}</h1>
        <Link className="btn btn-sm" to={isEdit ? `/viajes/${editId}` : '/viajes'}>
          Cancelar
        </Link>
      </div>

      {/* Stepper */}
      <ol className="stepper">
        {['Vehículo y chofer', 'Pasajeros', 'Ubicaciones', 'Confirmar'].map((label, i) => {
          const num = (i + 1) as Step
          return (
            <li
              key={label}
              className={num === step ? 'active' : num < step ? 'done' : ''}
              onClick={() => num < step && setStep(num)}
            >
              <span className="dot">{num < step ? <Check size={14} /> : num}</span>
              <span className="step-label">{label}</span>
            </li>
          )
        })}
      </ol>

      {error && <div className="alert alert-error">{error}</div>}

      {/* ---------- PASO 1 ---------- */}
      {step === 1 && (
        <div className="card">
          <label className="field">
            <span>
              Vehículo * ({selected.length} pasajeros / {capacity || '—'} puestos)
            </span>
            <select
              value={vehicleId}
              onChange={(e) => {
                const id = e.target.value ? Number(e.target.value) : ''
                setVehicleId(id)
                // Asignar chofer predeterminado del vehículo (si tiene)
                const v = vehicles.find((x) => x.id === id)
                if (v?.default_driver_id) {
                  const stillValid = drivers.some(
                    (d) => d.id === v.default_driver_id && d.active
                  )
                  if (stillValid) setDriverId(v.default_driver_id)
                }
              }}
            >
              <option value="">— Selecciona un vehículo —</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plate} — {[v.brand, v.model].filter(Boolean).join(' ') || '—'} (
                  {v.capacity} puestos)
                </option>
              ))}
            </select>
            {vehicles.length === 0 && (
              <span className="muted small">
                No hay vehículos activos. Regístralos primero.
              </span>
            )}
          </label>

          <label className="field">
            <span>Chofer *</span>
            <select value={driverId} onChange={(e) => setDriverId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">— Selecciona un chofer —</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name} — C.I. {d.dni}
                </option>
              ))}
            </select>
            {drivers.length === 0 && (
              <span className="muted small">
                No hay choferes activos. Regístralos primero.
              </span>
            )}
          </label>

          <label className="field">
            <span>Fecha y hora de salida</span>
            <input
              type="datetime-local"
              value={departureAt}
              onChange={(e) => setDepartureAt(e.target.value)}
            />
          </label>

          <label className="field">
            <span>Notas</span>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          <label className="check km-check">
            <input
              type="checkbox"
              checked={trackKm}
              onChange={(e) => setTrackKm(e.target.checked)}
            />
            <span>
              <strong>Registrar kilometraje (KM)</strong>
              <span className="muted small block">
                Al marcar la llegada, el chofer deberá indicar los KM del vehículo.
                Se guarda junto con la hora y la ubicación GPS.
              </span>
            </span>
          </label>

          <button
            className="btn btn-primary btn-block"
            disabled={!canNext()}
            onClick={() => setStep(2)}
          >
            Siguiente: Pasajeros
          </button>
        </div>
      )}

      {/* ---------- PASO 2 ---------- */}
      {step === 2 && (
        <div className="card">
          <div className="row spread wrap gap-sm">
            <label className="search grow">
              <input
                autoFocus
                placeholder="Buscar por nombre, cédula, cargo…"
                value={passengerSearch}
                onChange={(e) => setPassengerSearch(e.target.value)}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={onlyActive}
                onChange={(e) => setOnlyActive(e.target.checked)}
              />
              Solo activos
            </label>
          </div>

          <div className="row spread gap-sm">
            <span className={`capacity-pill ${overCapacity ? 'over' : ''}`}>
              {selected.length} / {capacity} puestos
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={selectAllFiltered}
              disabled={searchEmpty || filteredEmployees.length === 0}
              title={
                searchEmpty
                  ? 'Escribe primero en el buscador'
                  : undefined
              }
            >
              Seleccionar todos los filtrados
            </button>
          </div>

          {loadingEmployees && <p className="muted">Consultando empleados…</p>}
          {employeeError && (
            <div className="alert alert-error">
              {employeeError}
              <div style={{ marginTop: '0.5rem' }}>
                <button type="button" className="btn btn-sm" onClick={loadEmployees}>
                  Reintentar
                </button>
              </div>
            </div>
          )}

          {!loadingEmployees && !employeeError && (
            <>
              <p className="muted small">
                {employees.length > 0
                  ? `API: ${employees.length} empleado(s) en ${branches.length} sucursal(es) · mostrando ${filteredEmployees.length}`
                  : 'La API no devolvió empleados en ninguna sucursal.'}
              </p>

              {employeeWarning && (
                <div className="alert alert-warn">{employeeWarning}</div>
              )}

              {employees.length === 0 && (
                <div className="alert alert-error">
                  No se encontraron trabajadores en ninguna sucursal. Revisa las sucursales
                  en la página <strong>Sucursales</strong> (branchID).
                </div>
              )}

              {employees.length > 0 &&
                !searchEmpty &&
                filteredEmployees.length === 0 &&
                selectedMissing.length === 0 && (
                <div className="alert alert-error">
                  Ninguno de los {employees.length} empleado(s) coincide con la
                  búsqueda <strong>"{passengerSearch}"</strong>
                  {onlyActive ? ' (y activos)' : ''}.
                  <div style={{ marginTop: '0.5rem' }} className="row gap-sm">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setPassengerSearch('')}
                    >
                      Limpiar búsqueda
                    </button>
                    {onlyActive && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setOnlyActive(false)}
                      >
                        Ver inactivos
                      </button>
                    )}
                  </div>
                </div>
              )}

              {searchEmpty && (
                <div className="search-hint">
                  <Search size={16} />
                  Escribe un <strong>nombre</strong> o <strong>cédula</strong> para buscar
                  pasajeros entre los {employees.length} disponibles.
                </div>
              )}
            </>
          )}

          {!loadingEmployees &&
            !employeeError &&
            (filteredEmployees.length > 0 || selectedMissing.length > 0) && (
            <div className="passenger-scroll">
              <ul className="list checkbox-list">
                {filteredEmployees.map((e, idx) => {
                  const dni = String(e.dni)
                  const isChecked = selectedDnis.has(dni)
                  const disabled = !isChecked && capacity > 0 && selected.length >= capacity
                  const prev = filteredEmployees[idx - 1]
                  const prevSelected = prev ? selectedDnis.has(String(prev.dni)) : null
                  // Separador solo en la frontera entre grupos
                  const showDivider =
                    idx === 0
                      ? isChecked
                      : prevSelected !== null && prevSelected !== isChecked
                  return (
                    <li key={dni}>
                      {showDivider && (
                        <div className="list-divider">
                          {isChecked ? 'Seleccionados' : 'Coincidencias de la búsqueda'}
                        </div>
                      )}
                      <label
                        className={`check-row ${disabled ? 'disabled' : ''} ${
                          isChecked ? 'is-selected' : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={disabled}
                          onChange={() => togglePassenger(e)}
                        />
                        <span>
                          <strong>{employeeFullName(e)}</strong>
                          <span className="muted small block">
                            C.I. {e.dni} · {e.role_name}
                            {!e.active && <em className="badge badge-inactivo"> inactivo</em>}
                          </span>
                          <span className="muted small block">
                            {e.department_name}
                            <span className="branch-tag"> · {e.branch_name}</span>
                          </span>
                        </span>
                      </label>
                    </li>
                  )
                })}

                {/* Seleccionados que ya no aparecen en la API
                    (común al editar viajes antiguos) */}
                {selectedMissing.length > 0 && (
                  <li>
                    <div className="list-divider">Seleccionados</div>
                  </li>
                )}
                {selectedMissing.map((p) => (
                    <li key={p.dni}>
                      <label className="check-row">
                        <input
                          type="checkbox"
                          checked
                          onChange={() =>
                            setSelected((prev) => prev.filter((x) => x.dni !== p.dni))
                          }
                        />
                        <span>
                          <strong>{p.full_name}</strong>
                          <span className="muted small block">
                            C.I. {p.dni} · {p.role_name ?? '—'}
                          </span>
                          <span className="muted small block">
                            {p.department ?? '—'}
                            <em className="badge badge-inactivo"> no está en la API</em>
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <div className="row gap">
            <button className="btn" onClick={() => setStep(1)}>
              Atrás
            </button>
            <button
              className="btn btn-primary grow"
              disabled={!canNext()}
              onClick={() => setStep(3)}
            >
              Siguiente: Ubicaciones
            </button>
          </div>
        </div>
      )}

      {/* ---------- PASO 3 ---------- */}
      {step === 3 && (
        <div className="card">
          <div className="row gap">
            <label className="field grow">
              <span>Ubicación</span>
              <input
                value={destName}
                onChange={(e) => setDestName(e.target.value)}
                placeholder="ej: Terminal de pasajeros"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addDestination()
                  }
                }}
              />
            </label>
            <button
              type="button"
              className="btn btn-primary"
              onClick={addDestination}
              disabled={!destName.trim()}
            >
              Agregar
            </button>
          </div>

          {destinations.length === 0 ? (
            <p className="muted">Agrega al menos una ubicación. El orden se respeta tal cual.</p>
          ) : (
            <>
              <ol className="dest-list editable">
                {destinations.map((d) => (
                  <li key={d.position}>
                    <div className="row spread gap-sm">
                      <div>
                        <strong>
                          {d.position}. {d.name}
                        </strong>
                        {d.notes && <div className="muted small">{d.notes}</div>}
                      </div>
                      <div className="row gap-sm">
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => moveDestination(d.position, -1)}
                          disabled={d.position === 1}
                          aria-label="Subir"
                        >
                          <ChevronUp size={15} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => moveDestination(d.position, 1)}
                          disabled={d.position === destinations.length}
                          aria-label="Bajar"
                        >
                          <ChevronDown size={15} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => removeDestination(d.position)}
                          aria-label="Quitar"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>

              {/* ---- Origen y ubicación de cada pasajero ---- */}
              <h2>Origen y ubicación de cada pasajero</h2>
              <p className="muted small">
                <strong>Origen</strong>: de qué parada sube (una sola).{' '}
                <strong>Ubicaciones</strong>: en qué paradas baja (una o varias).
              </p>

              <div className="passenger-scroll assign-scroll">
                <ul className="list">
                  {selected.map((p) => {
                    const assigned = passengerDests[p.dni] ?? []
                    const originPos = passengerOrigins[p.dni]
                    const missingDest = assigned.length === 0
                    const missingOrigin = originPos == null
                    return (
                      <li key={p.dni}>
                        <div className="assign-row">
                          <div className="assign-head">
                            <div>
                              <strong>{p.full_name}</strong>
                              <span className="muted small"> · C.I. {p.dni}</span>
                            </div>
                            <div className="row gap-sm">
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => assignAllDests(p.dni)}
                              >
                                Todas las ubicaciones
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => clearPassengerDests(p.dni)}
                                disabled={assigned.length === 0}
                              >
                                Limpiar ubicaciones
                              </button>
                            </div>
                          </div>

                          {/* ORIGEN (radio: una sola parada) */}
                          <div className="assign-label">
                            <MapPin size={13} /> Origen (sube)
                          </div>
                          <div className="chips">
                            {destinations.map((d) => {
                              const on = originPos === d.position
                              return (
                                <button
                                  type="button"
                                  key={`o-${d.position}`}
                                  className={`chip chip-origin ${on ? 'on' : ''}`}
                                  onClick={() =>
                                    setPassengerOrigin(
                                      p.dni,
                                      on ? null : d.position
                                    )
                                  }
                                >
                                  {d.position}. {d.name}
                                </button>
                              )
                            })}
                          </div>
                          {missingOrigin && (
                            <span className="assign-warning">
                              Selecciona el origen (donde sube)
                            </span>
                          )}

                          {/* UBICACIONES: lista ordenada + agregar */}
                          <div className="assign-label">
                            <Flag size={13} /> Ubicaciones (baja) — orden de bajada
                          </div>

                          {assigned.length > 0 && (
                            <ol className="dest-seq">
                              {assigned.map((pos, idx) => {
                                const d = destinations.find((x) => x.position === pos)
                                return (
                                  <li key={pos}>
                                    <span className="seq-num">{idx + 1}</span>
                                    <span className="seq-name">{d?.name ?? `Parada ${pos}`}</span>
                                    <span className="seq-actions">
                                      <button
                                        type="button"
                                        className="btn btn-sm"
                                        onClick={() => movePassengerDest(p.dni, idx, -1)}
                                        disabled={idx === 0}
                                        aria-label="Subir"
                                      >
                                        <ChevronUp size={14} />
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn-sm"
                                        onClick={() => movePassengerDest(p.dni, idx, 1)}
                                        disabled={idx === assigned.length - 1}
                                        aria-label="Bajar"
                                      >
                                        <ChevronDown size={14} />
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn-sm btn-danger"
                                        onClick={() => togglePassengerDest(p.dni, pos)}
                                        aria-label="Quitar"
                                      >
                                        <X size={13} />
                                      </button>
                                    </span>
                                  </li>
                                )
                              })}
                            </ol>
                          )}

                          <div className="chips">
                            {destinations
                              .filter((d) => !assigned.includes(d.position))
                              .map((d) => (
                                <button
                                  type="button"
                                  key={`d-${d.position}`}
                                  className="chip chip-add"
                                  onClick={() => togglePassengerDest(p.dni, d.position)}
                                >
                                  + {d.name}
                                </button>
                              ))}
                            {assigned.length === destinations.length &&
                              destinations.length > 0 && (
                                <span className="muted small">
                                  Todas las ubicaciones asignadas.
                                </span>
                              )}
                          </div>

                          {missingDest && (
                            <span className="assign-warning">
                              Selecciona al menos una ubicación
                            </span>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>

              {(passengersWithoutDest.length > 0 || passengersWithoutOrigin.length > 0) && (
                <div className="alert alert-error">
                  {passengersWithoutOrigin.length > 0 && (
                    <div>
                      {passengersWithoutOrigin.length} pasajero(s) sin origen asignado.
                    </div>
                  )}
                  {passengersWithoutDest.length > 0 && (
                    <div>{passengersWithoutDest.length} pasajero(s) sin ubicación asignada.</div>
                  )}
                </div>
              )}
            </>
          )}

          <div className="row gap">
            <button className="btn" onClick={() => setStep(2)}>
              Atrás
            </button>
            <button
              className="btn btn-primary grow"
              disabled={!canNext()}
              onClick={() => setStep(4)}
            >
              Siguiente: Confirmar
            </button>
          </div>
        </div>
      )}

      {/* ---------- PASO 4 ---------- */}
      {step === 4 && (
        <div className="card">
          <dl className="kv">
            <dt>Vehículo</dt>
            <dd>
              {vehicle
                ? `${vehicle.plate} — ${vehicle.capacity} puestos`
                : '—'}
            </dd>
            <dt>Chofer</dt>
            <dd>{drivers.find((d) => d.id === driverId)?.full_name ?? '—'}</dd>
            <dt>Salida</dt>
            <dd>
              {new Date(departureAt).toLocaleString('es-VE', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </dd>
            <dt>Pasajeros</dt>
            <dd>
              {selected.length} / {capacity}
            </dd>
            <dt>Kilometraje</dt>
            <dd>{trackKm ? 'Sí — el chofer registrará KM en cada llegada' : 'No'}</dd>
            <dt>Ubicaciones</dt>
            <dd>{destinations.map((d) => `${d.position}. ${d.name}`).join(' → ')}</dd>
            {notes && (
              <>
                <dt>Notas</dt>
                <dd>{notes}</dd>
              </>
            )}
          </dl>

          <details className="passenger-summary" open>
            <summary>Pasajeros: origen y ubicaciones ({selected.length})</summary>
            <ul className="list">
              {selected.map((p) => {
                const positions = passengerDests[p.dni] ?? []
                const names = positions.map(
                  (pos) => destinations.find((d) => d.position === pos)?.name ?? pos
                )
                const originPos = passengerOrigins[p.dni]
                const originName =
                  originPos != null
                    ? destinations.find((d) => d.position === originPos)?.name
                    : null
                return (
                  <li key={p.dni} className="list-item">
                    <div>
                      <strong>{p.full_name}</strong>
                      <div className="muted small">
                        C.I. {p.dni}
                        {p.role_name ? ` · ${p.role_name}` : ''}
                      </div>
                      <div className="dest-tags">
                        <span className={`chip chip-origin ${originName ? 'on' : ''}`}>
                          <MapPin size={12} /> {originName ?? 'Sin origen'}
                        </span>
                        {names.length === 0 ? (
                          <span className="assign-warning">Sin ubicación</span>
                        ) : (
                          names.map((n, i) => (
                            <span key={i} className="chip on">
                              <Flag size={12} /> {n}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </details>

          <div className="row gap">
            <button className="btn" onClick={() => setStep(3)}>
              Atrás
            </button>
            <button
              className="btn btn-primary grow"
              disabled={saving}
              onClick={save}
            >
              {saving
                ? 'Guardando…'
                : isEdit
                  ? 'Guardar cambios'
                  : 'Crear viaje'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
