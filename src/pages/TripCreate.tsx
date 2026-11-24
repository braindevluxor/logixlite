import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Check,
  ChevronDown,
  ChevronUp,
  Flag,
  MapPin,
  Search,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { employeeFullName, fetchEmployees } from '../lib/talentoHumano'
import { up } from '../lib/format'
import RouteMap from '../components/RouteMap'
import type {
  ApiEmployee,
  Branch,
  CatalogLocation,
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
  /** true si se agregó a mano (no viene de la API de trabajadores) */
  manual?: boolean
  /** Observación individual (ej. "Fumigación") */
  observation?: string | null
  /** Teléfono (de la API o capturado a mano) */
  phone?: string | null
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
  const [searchParams] = useSearchParams()
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
  /** Pasajeros cancelados del viaje: se conservan al editar */
  const [cancelledRows, setCancelledRows] = useState<TripPassenger[]>([])
  const [onlyActive, setOnlyActive] = useState(true)

  // Pasajero manual (persona que no aparece en la API)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualName, setManualName] = useState('')
  const [manualDni, setManualDni] = useState('')
  const [manualRole, setManualRole] = useState('')
  const [manualPhone, setManualPhone] = useState('')
  const [manualError, setManualError] = useState<string | null>(null)

  // Destinos
  const [destinations, setDestinations] = useState<TripDestination[]>([])

  // Catálogo de ubicaciones (reutilizables entre viajes)
  const [catalog, setCatalog] = useState<CatalogLocation[]>([])
  const [picker, setPicker] = useState<
    { mode: 'trip' } | { mode: 'origin' | 'route'; dni: string } | null
  >(null)
  const [pickQuery, setPickQuery] = useState('')
  const [pickBusy, setPickBusy] = useState(false)
  // Enlace de Google Maps de la ubicación que se crea o elige
  const [pickUrl, setPickUrl] = useState('')
  // Error de validación visible DENTRO del selector
  const [pickError, setPickError] = useState('')
  // Asignación pasajero (dni) → posiciones de destino [1, 2, 3...]
  const [passengerDests, setPassengerDests] = useState<Record<string, number[]>>({})
  // Origen de cada pasajero (dni) → una sola posición (1, 2, 3...)
  const [passengerOrigins, setPassengerOrigins] = useState<Record<string, number>>({})
  // Observación individual por pasajero (ej. "Fumigación")
  const [passengerObs, setPassengerObs] = useState<Record<string, string>>({})

  const vehicle = vehicles.find((v) => v.id === vehicleId) ?? null
  const capacity = vehicle?.capacity ?? 0

  // Si llegamos desde el plan del día (?date=YYYY-MM-DD), usamos esa fecha
  useEffect(() => {
    if (isEdit) return
    const d = searchParams.get('date')
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const now = new Date()
      const hh = String(now.getHours()).padStart(2, '0')
      const mm = String(now.getMinutes()).padStart(2, '0')
      setDepartureAt(`${d}T${hh}:${mm}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    async function load() {
      const [b, v, d, loc] = await Promise.all([
        supabase.from('branches').select('*').eq('active', true).order('name'),
        isEdit
          ? supabase.from('vehicles').select('*').order('plate')
          : supabase.from('vehicles').select('*').eq('status', 'activo').order('plate'),
        isEdit
          ? supabase.from('drivers').select('*').order('full_name')
          : supabase.from('drivers').select('*').eq('active', true).order('full_name'),
        supabase.from('locations').select('*').eq('active', true).order('name'),
      ])
      if (b.error || v.error || d.error) {
        setError(b.error?.message || v.error?.message || d.error?.message || null)
        return
      }
      setBranches((b.data as Branch[]) ?? [])
      setVehicles((v.data as Vehicle[]) ?? [])
      setDrivers((d.data as Driver[]) ?? [])
      // El catálogo es auxiliar: si falla (tabla no creada) no bloquea el viaje
      if (loc.error) {
        console.warn('Catálogo de ubicaciones no disponible:', loc.error.message)
      } else {
        setCatalog((loc.data as CatalogLocation[]) ?? [])
      }
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
      // Solo los ACTIVOS entran al formulario; los cancelados se
      // guardan aparte para re-insertarlos al guardar
      const activeRows = passRows.filter((x) => x.status !== 'cancelado')
      setSelected(
        activeRows.map((x) => ({
          dni: x.dni,
          full_name: x.full_name,
          role_name: x.role_name,
          department: x.department,
          branch_id: x.branch_id,
          observation: x.observation,
          phone: x.phone,
        }))
      )
      setCancelledRows(passRows.filter((x) => x.status === 'cancelado'))
      setPassengerOrigins(origins)
      setPassengerDests(dests)
      const obs: Record<string, string> = {}
      for (const x of passRows) {
        if (x.observation) obs[x.dni] = x.observation
      }
      setPassengerObs(obs)
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
        (e.role_name ?? '').toLowerCase().includes(q) ||
        (e.department_name ?? '').toLowerCase().includes(q) ||
        (e.branch_name ?? '').toLowerCase().includes(q)
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
          phone: e.phone || null,
        },
      ]
    })
  }

  /** Agrega a la selección una persona que no está en la API */
  function openManualAdd() {
    setManualName('')
    setManualDni('')
    setManualRole('')
    setManualPhone('')
    setManualError(null)
    setManualOpen(true)
  }

  function addManualPassenger(e: FormEvent) {
    e.preventDefault()
    const name = manualName.trim().toUpperCase()
    const dni = manualDni.trim()

    if (!name) return setManualError('El nombre es obligatorio')
    if (!dni) return setManualError('La cédula es obligatoria')
    if (selected.some((p) => p.dni === dni))
      return setManualError('Esa cédula ya está en la lista de pasajeros')
    if (employees.some((emp) => String(emp.dni) === dni))
      return setManualError(
        'Esa cédula pertenece a un trabajador de la API: seleccionalo en la lista'
      )
    if (capacity > 0 && selected.length >= capacity)
      return setManualError(`El vehículo solo tiene ${capacity} puestos`)

    setSelected((prev) => [
      ...prev,
      {
        dni,
        full_name: name,
        role_name: manualRole.trim() ? manualRole.trim().toUpperCase() : null,
        department: null,
        branch_id: null,
        manual: true,
        phone: manualPhone.replace(/\D/g, '') || null,
      },
    ])
    setManualOpen(false)
    setManualName('')
    setManualDni('')
    setManualRole('')
    setManualPhone('')
    setManualError(null)
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
        phone: e.phone || null,
      }))
    const total = selected.length + additions.length
    if (capacity > 0 && total > capacity) {
      setError(`Capacidad excedida: ${capacity} puestos, selección de ${total}`)
      return
    }
    setError(null)
    setSelected((prev) => [...prev, ...additions])
  }

  // ---- Ubicaciones: catálogo + picker ----
  const pickFiltered = useMemo(() => {
    const q = pickQuery.trim().toLowerCase()
    return catalog.filter((l) => !q || l.name.toLowerCase().includes(q))
  }, [catalog, pickQuery])

  const pickExactMatch = useMemo(
    () =>
      catalog.some((l) => l.name.toLowerCase() === pickQuery.trim().toLowerCase()),
    [catalog, pickQuery]
  )

  /**
   * El enlace de Google Maps es obligatorio la PRIMERA vez que
   * se usa una ubicacion: si el nombre aun no esta en el
   * catalogo, o esta pero sin enlace, hay que pegarlo para que
   * la ruta del mapa salga exacta.
   */
  const pickNeedsUrl = useMemo(() => {
    const q = pickQuery.trim()
    if (!q) return false
    const match = catalog.find((l) => l.name.toLowerCase() === q.toLowerCase())
    if (!match) return true
    return !match.maps_url?.trim()
  }, [catalog, pickQuery])

  function openPicker(mode: 'trip' | 'origin' | 'route', dni?: string) {
    setPickQuery('')
    setPickUrl('')
    setPickError('')
    setPicker(mode === 'trip' ? { mode } : { mode, dni: dni! })
  }

  /**
   * Elige (o crea) una ubicación del catálogo y la asigna según el
   * destino del picker: ruta del viaje, origen o ruta del pasajero.
   */
  async function pickLocation(rawName: string) {
    if (pickBusy) return
    const name = rawName.trim().toUpperCase()
    if (!name) return
    const target = picker
    if (!target) return

    // Obligatorio la PRIMERA vez que se usa una ubicacion:
    // sin enlace de Google Maps la ruta sale mal geolocalizada
    const existing = catalog.find((l) => l.name.toLowerCase() === name.toLowerCase())
    const urlValue = pickUrl.trim()
    if (!urlValue && !existing?.maps_url?.trim()) {
      setPickError(
        `Coloca el enlace de Google Maps de "${name}" antes de continuar: es obligatorio la primera vez que se crea una ubicación.`
      )
      return
    }

    setPickBusy(true)
    setError(null)
    setPickError('')

    // Enlace de Google Maps: se guarda en el catálogo y en la
    // parada del viaje para que el mapa sea preciso
    const mapsUrl = urlValue || null

    let canonical = name
    let catalogUrl: string | null = null
    if (existing) {
      canonical = existing.name
      catalogUrl = existing.maps_url ?? null
      // Si se colocó un enlace nuevo, actualiza el catálogo
      if (mapsUrl && mapsUrl !== catalogUrl) {
        const { error: upErr } = await supabase
          .from('locations')
          .update({ maps_url: mapsUrl })
          .eq('id', existing.id)
        if (!upErr) {
          catalogUrl = mapsUrl
          setCatalog((prev) =>
            prev.map((l) => (l.id === existing.id ? { ...l, maps_url: mapsUrl } : l))
          )
        }
      }
    } else {
      const { data, error } = await supabase
        .from('locations')
        .insert({ name, maps_url: mapsUrl })
        .select('*')
        .single()
      if (error && error.code !== '23505') {
        setError(error.message)
        setPickBusy(false)
        return
      }
      if (data) {
        const loc = data as CatalogLocation
        setCatalog((prev) =>
          [...prev, loc].sort((a, b) => a.name.localeCompare(b.name, 'es'))
        )
        canonical = loc.name
        catalogUrl = loc.maps_url ?? null
      } else {
        // Conflicto de unicidad: ya existía, tomar su nombre canónico
        const { data: ex } = await supabase
          .from('locations')
          .select('*')
          .ilike('name', name)
          .maybeSingle()
        if (ex) {
          canonical = (ex as CatalogLocation).name
          catalogUrl = (ex as CatalogLocation).maps_url ?? null
        }
      }
    }

    // Enlace que usará la parada del viaje
    const stopUrl = mapsUrl ?? catalogUrl

    setPicker(null)
    setPickQuery('')
    setPickUrl('')
    setPickBusy(false)

    // Asegurar que la ubicación exista como parada de la ruta del viaje
    let pos = destinations.find(
      (x) => x.name.toLowerCase() === canonical.toLowerCase()
    )?.position
    if (pos == null) {
      pos = destinations.length + 1
      const newStop: TripDestination = {
        id: -Date.now(), // id temporal único
        trip_id: 0,
        position: pos,
        name: canonical,
        notes: null,
        maps_url: stopUrl,
      }
      setDestinations((prev) => [...prev, newStop])
    } else if (stopUrl) {
      // La parada ya existía: adjuntar el enlace si se colocó uno
      setDestinations((prev) =>
        prev.map((d) => (d.position === pos ? { ...d, maps_url: stopUrl } : d))
      )
    }
    const stopPos = pos

    if (target.mode === 'origin') {
      setPassengerOrigin(target.dni, stopPos)
    } else if (target.mode === 'route') {
      setPassengerDests((prev) => {
        const cur = prev[target.dni] ?? []
        if (cur.includes(stopPos)) return prev
        return { ...prev, [target.dni]: [...cur, stopPos] }
      })
    }
  }

  async function deleteLocation(loc: CatalogLocation) {
    if (!confirm(`¿Eliminar "${loc.name}" del catálogo? Los viajes anteriores no se modifican.`))
      return
    const { error } = await supabase.from('locations').delete().eq('id', loc.id)
    if (error) {
      setError(error.message)
      return
    }
    setCatalog((prev) => prev.filter((l) => l.id !== loc.id))
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

    // La cédula de un activo no puede chocar con un cancelado
    // (se re-insertan ambos al guardar)
    const cancelledDnis = new Set(cancelledRows.map((c) => c.dni))
    const conflict = selected.find((s) => cancelledDnis.has(s.dni))
    if (conflict) {
      return setError(
        `La cédula ${conflict.dni} pertenece a un pasajero cancelado de este viaje: usa otra cédula para el nuevo pasajero.`
      )
    }
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
          notes: notes.trim() ? notes.trim().toUpperCase() : null,
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
          notes: notes.trim() ? notes.trim().toUpperCase() : null,
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
          name: d.name.toUpperCase(),
          notes: d.notes ? d.notes.toUpperCase() : null,
          maps_url: d.maps_url ?? null,
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
          full_name: p.full_name.toUpperCase(),
          role_name: p.role_name,
          department: p.department,
          branch_id: p.branch_id,
          phone: p.phone ?? null,
          origin_destination_id:
            passengerOrigins[p.dni] != null
              ? destIdByPos.get(passengerOrigins[p.dni]) ?? null
              : null,
          observation: passengerObs[p.dni]?.trim().toUpperCase() || null,
        }))
      )
      .select('id, dni')

    if (passRes.error) {
      setError(passRes.error.message)
      setSaving(false)
      return
    }

    // Pasajeros CANCELADOS: se re-insertan conservando su motivo,
    // su fecha y su ubicación de origen
    const cancelledIdByDni = new Map<string, number>()
    if (cancelledRows.length > 0) {
      const cRes = await supabase
        .from('trip_passengers')
        .insert(
          cancelledRows.map((c) => ({
            trip_id: tripId,
            dni: c.dni,
            full_name: c.full_name.toUpperCase(),
            role_name: c.role_name,
            department: c.department,
            branch_id: c.branch_id,
            phone: c.phone ?? null,
            observation: c.observation ?? null,
            status: 'cancelado',
            cancel_reason: c.cancel_reason ?? null,
            cancelled_at: c.cancelled_at ?? null,
            origin_destination_id:
              passengerOrigins[c.dni] != null
                ? destIdByPos.get(passengerOrigins[c.dni]) ?? null
                : null,
          }))
        )
        .select('id, dni')
      if (cRes.error) {
        setError(
          `Viaje guardado, pero no se pudieron conservar los pasajeros cancelados: ${cRes.error.message}`
        )
        setSaving(false)
        return
      }
      for (const row of (cRes.data ?? []) as { id: number; dni: string }[]) {
        cancelledIdByDni.set(row.dni, row.id)
      }
    }

    // Actualizar el catálogo con las ubicaciones usadas
    // (cubre viajes antiguos creados antes del catálogo)
    const { error: catErr } = await supabase.from('locations').upsert(
      destinations.map((d) => ({ name: d.name.toUpperCase() })),
      { onConflict: 'name', ignoreDuplicates: true }
    )
    if (catErr) console.warn('Catálogo no actualizado:', catErr.message)

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

    // Paradas de los pasajeros cancelados (se conservan)
    const cancelledLinks: typeof links = []
    for (const c of cancelledRows) {
      const passId = cancelledIdByDni.get(c.dni)
      if (!passId) continue
      const positions = passengerDests[c.dni] ?? []
      for (let i = 0; i < positions.length; i++) {
        const destId = destIdByPos.get(positions[i])
        if (destId) {
          cancelledLinks.push({
            trip_passenger_id: passId,
            trip_destination_id: destId,
            seq: i + 1,
          })
        }
      }
    }
    if (cancelledLinks.length > 0) {
      const { error: clErr } = await supabase
        .from('trip_passenger_destinations')
        .insert(cancelledLinks)
      if (clErr) console.warn('Paradas de pasajeros cancelados:', clErr.message)
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

          <div className="row spread gap-sm wrap">
            <div className="row gap-sm">
              <span className={`capacity-pill ${overCapacity ? 'over' : ''}`}>
                {selected.length} / {capacity} puestos
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={openManualAdd}
                disabled={capacity > 0 && selected.length >= capacity}
                title={
                  capacity > 0 && selected.length >= capacity
                    ? 'No hay puestos disponibles'
                    : 'Agregar una persona que no aparece en la nómina'
                }
              >
                <UserPlus size={14} /> Pasajero manual
              </button>
            </div>
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

                {/* Seleccionados que no están en la API:
                    pasajeros manuales y trabajadores fuera de ella */}
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
                            C.I. {p.dni}
                            {p.role_name ? ` · ${p.role_name}` : ''}
                          </span>
                          <span className="muted small block">
                            {p.department ?? (p.manual ? 'Pasajero manual' : '—')}
                            {p.manual ? (
                              <em className="badge badge-manual"> manual</em>
                            ) : (
                              <em className="badge badge-inactivo"> no está en la API</em>
                            )}
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
          {/* 1) RUTA DE CADA PASAJERO — directa desde el catálogo */}
          <h2>Ruta de cada pasajero</h2>
          <p className="muted small">
            <strong>Origen</strong>: dónde sube (una ubicación).{' '}
            <strong>Ubicaciones</strong>: dónde baja, en orden de bajada. Las ubicaciones
            que crees quedan guardadas para reutilizarlas en próximos viajes.
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
                            Limpiar
                          </button>
                        </div>
                      </div>

                      {/* ORIGEN (una sola ubicación) */}
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
                                setPassengerOrigin(p.dni, on ? null : d.position)
                              }
                            >
                              {up(d.name)}
                            </button>
                          )
                        })}
                        <button
                          type="button"
                          className="chip chip-add"
                          onClick={() => openPicker('origin', p.dni)}
                        >
                          + Otra ubicación
                        </button>
                      </div>
                      {missingOrigin && (
                        <span className="assign-warning">
                          Selecciona el origen (donde sube)
                        </span>
                      )}

                      {/* UBICACIONES: orden de bajada */}
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
                                <span className="seq-name">
                                  {d ? up(d.name) : `Parada ${pos}`}
                                </span>
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
                              + {up(d.name)}
                            </button>
                          ))}
                        <button
                          type="button"
                          className="chip chip-add chip-new"
                          onClick={() => openPicker('route', p.dni)}
                        >
                          <Search size={12} /> Buscar o crear ubicación
                        </button>
                      </div>

                      {missingDest && (
                        <span className="assign-warning">
                          Selecciona al menos una ubicación
                        </span>
                      )}

                      {/* OBSERVACIÓN individual (se muestra en el plan del día) */}
                      <label className="field obs-field">
                        <span>Observación (opcional)</span>
                        <input
                          value={passengerObs[p.dni] ?? ''}
                          onChange={(e) =>
                            setPassengerObs((prev) => ({
                              ...prev,
                              [p.dni]: e.target.value,
                            }))
                          }
                          placeholder="Ej: Fumigación, requiere EPP, etc."
                        />
                      </label>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>

          {(passengersWithoutDest.length > 0 || passengersWithoutOrigin.length > 0) && (
            <div className="alert alert-error">
              {passengersWithoutOrigin.length > 0 && (
                <div>{passengersWithoutOrigin.length} pasajero(s) sin origen asignado.</div>
              )}
              {passengersWithoutDest.length > 0 && (
                <div>{passengersWithoutDest.length} pasajero(s) sin ubicación asignada.</div>
              )}
            </div>
          )}

          {/* 2) RUTA DEL VEHÍCULO — derivada, reordenable */}
          <h2>Ruta del vehículo</h2>
          <p className="muted small">
            Se arma con las rutas de los pasajeros. Puedes agregar más paradas o
            reordenarlas; el orden es el que sigue el vehículo.
          </p>

          <button
            type="button"
            className="picker-trigger"
            onClick={() => openPicker('trip')}
          >
            <MapPin size={15} /> Agregar ubicación a la ruta
          </button>

          {destinations.length === 0 ? (
            <p className="muted small">
              Aún no hay paradas. Se agregan desde las rutas de los pasajeros o con el
              botón de arriba.
            </p>
          ) : (
            <ol className="dest-list editable">
              {destinations.map((d) => (
                <li key={d.position}>
                  <div className="row spread gap-sm">
                    <div>
                      <strong>
                        {d.position}. {up(d.name)}
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
          )}

          {/* Mapa de la ruta planificada (Google Maps embebido) */}
          {destinations.length > 0 && (
            <RouteMap
              origin={destinations[0].name}
              destination={destinations[destinations.length - 1].name}
              originUrl={destinations[0].maps_url}
              destinationUrl={destinations[destinations.length - 1].maps_url}
            />
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
            <dd>
              {destinations
                .map((d) => `${d.position}. ${up(d.name)}`)
                .join(' → ')}
            </dd>
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
                  (pos) =>
                    destinations.find((d) => d.position === pos)?.name ??
                    `Parada ${pos}`
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
                          <MapPin size={12} />{' '}
                          {originName ? up(originName) : 'Sin origen'}
                        </span>
                        {names.length === 0 ? (
                          <span className="assign-warning">Sin ubicación</span>
                        ) : (
                          names.map((n, i) => (
                            <span key={i} className="chip on">
                              <Flag size={12} /> {up(n)}
                            </span>
                          ))
                        )}
                      </div>
                      {passengerObs[p.dni]?.trim() && (
                        <div className="obs-note">
                          Obs: {passengerObs[p.dni].trim()}
                        </div>
                      )}
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

      {/* ===== Modal: pasajero manual ===== */}
      {manualOpen && (
        <div className="modal-backdrop" onClick={() => setManualOpen(false)}>
          <form
            className="card modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={addManualPassenger}
            role="dialog"
            aria-modal="true"
          >
            <h2>Agregar pasajero manual</h2>
            <p className="muted small">
              Para personas que no aparecen en la nómina: invitados, proveedores,
              visitantes, familiares.
            </p>

            <label className="field">
              <span>Nombre completo *</span>
              <input
                autoFocus
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="Ej: María Pérez"
              />
            </label>

            <label className="field">
              <span>Cédula *</span>
              <input
                value={manualDni}
                onChange={(e) => setManualDni(e.target.value.replace(/\D/g, ''))}
                placeholder="Solo números, ej: 12345678"
                inputMode="numeric"
              />
            </label>

            <label className="field">
              <span>Cargo o identificación (opcional)</span>
              <input
                value={manualRole}
                onChange={(e) => setManualRole(e.target.value)}
                placeholder="Ej: Invitado, Proveedor, Familiar"
              />
            </label>

            <label className="field">
              <span>Teléfono (opcional)</span>
              <input
                value={manualPhone}
                onChange={(e) => setManualPhone(e.target.value.replace(/[^\d+ ]/g, ''))}
                placeholder="Ej: 04124362012"
                inputMode="tel"
              />
            </label>

            {manualError && <div className="alert alert-error">{manualError}</div>}

            <div className="row gap">
              <button
                type="button"
                className="btn"
                onClick={() => setManualOpen(false)}
              >
                Cancelar
              </button>
              <button className="btn btn-primary grow">
                <UserPlus size={15} /> Agregar a la lista
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===== Modal: picker de ubicaciones (catálogo) ===== */}
      {picker && (
        <div className="modal-backdrop" onClick={() => setPicker(null)}>
          <div
            className="card modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2>
              {picker.mode === 'trip'
                ? 'Agregar a la ruta del vehículo'
                : picker.mode === 'origin'
                  ? 'Origen del pasajero'
                  : 'Ubicación del pasajero'}
            </h2>
            <p className="muted small">
              Busca una ubicación guardada o crea una nueva: quedará en el catálogo para
              reusarla en próximos viajes.
            </p>

            <label className="field">
              <span>Buscar</span>
              <input
                autoFocus
                value={pickQuery}
                onChange={(e) => {
                  setPickQuery(e.target.value)
                  setPickError('')
                }}
                placeholder="Escribe un nombre…"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (pickQuery.trim()) pickLocation(pickQuery)
                  }
                }}
              />
            </label>

            <label className="field">
              <span>Enlace de Google Maps {pickNeedsUrl ? '*' : '(opcional)'}</span>
              <input
                type="url"
                value={pickUrl}
                onChange={(e) => {
                  setPickUrl(e.target.value)
                  setPickError('')
                }}
                placeholder="https://www.google.com/maps/…"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-label="Enlace de Google Maps de la ubicación"
              />
            </label>
            <p className="muted small" style={{ margin: '-0.4rem 0 0.6rem' }}>
              Pega el enlace del lugar en Google Maps. Es obligatorio la primera vez que
              se crea una ubicación: así la ruta sale exacta.
            </p>

            {pickNeedsUrl && !pickUrl.trim() && (
              <div className="pick-req">
                Este nombre aún no tiene enlace: pega la URL de Google Maps para poder
                continuar.
              </div>
            )}

            {pickError && <div className="alert alert-error">{pickError}</div>}

            {pickQuery.trim() && !pickExactMatch && (
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={() => pickLocation(pickQuery)}
                disabled={pickBusy || (pickNeedsUrl && !pickUrl.trim())}
              >
                {pickBusy
                  ? 'Guardando…'
                  : `Crear "${pickQuery.trim()}" y asignar`}
              </button>
            )}

            <div className="loc-list">
              {pickFiltered.length === 0 ? (
                <p className="muted small">
                  {catalog.length === 0
                    ? 'El catálogo está vacío. Escribe un nombre arriba para crear la primera ubicación.'
                    : 'Ninguna ubicación coincide con la búsqueda.'}
                </p>
              ) : (
                pickFiltered.map((l) => (
                  <div key={l.id} className="loc-row">
                    <button
                      type="button"
                      className="loc-name"
                      onClick={() => pickLocation(l.name)}
                      disabled={pickBusy}
                    >
                      <MapPin size={14} />
                      {up(l.name)}
                      {!l.maps_url?.trim() && (
                        <span className="loc-no-url">sin enlace</span>
                      )}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => deleteLocation(l)}
                      aria-label={`Eliminar ${l.name}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="row gap" style={{ marginTop: '0.7rem' }}>
              <button
                type="button"
                className="btn grow"
                onClick={() => setPicker(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
