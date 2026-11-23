// ------------------------------------------------------------
// Tipos compartidos (base de datos + API externa)
// ------------------------------------------------------------

export interface Branch {
  id: number
  external_id: number
  name: string
  active: boolean
}

export type VehicleStatus = 'activo' | 'mantenimiento' | 'inactivo'

export interface Vehicle {
  id: number
  plate: string
  brand: string | null
  model: string | null
  year: number | null
  capacity: number
  status: VehicleStatus
  notes: string | null
  default_driver_id: number | null
  /** Ruta de la foto en el bucket 'vehicle-photos' */
  photo_path: string | null
  /** Sistema de combustible: gasolina (Lts), gnv (Vol) o ambos */
  fuel_system: FuelSystem
}

export interface Driver {
  id: number
  dni: string
  full_name: string
  phone: string | null
  license_number: string | null
  license_expires: string | null
  active: boolean
  notes: string | null
  /** Token del link publico del chofer: /chofer/<token> */
  link_token?: string | null
  /** Ruta de la foto en el bucket 'driver-photos' */
  photo_path?: string | null
}

// ------------------------------------------------------------
// Combustible (Gasolina / GNV)
// ------------------------------------------------------------

/** Tipo de combustible de una carga */
export type FuelType = 'gasolina' | 'gnv'

/** Sistema de combustible configurado en el vehículo */
export type FuelSystem = FuelType | 'ambos'

/** Cómo se pagó la carga */
export type PaymentMethod = 'electronico' | 'efectivo'

/** Carga de combustible registrada */
export interface FuelRecord {
  id: number
  vehicle_id: number
  fuel_type: FuelType
  /** Litros (gasolina) o volumen en m3 (GNV) */
  quantity: number
  station: string
  /** Fecha y hora locales de la carga (ISO) */
  fueled_at: string
  amount_bs: number
  /** Tasa BCV (Bs por 1 USD) usada al registrar */
  rate: number
  /** amount_bs / rate (calculado en la base de datos) */
  amount_usd: number
  payment_method: PaymentMethod
  /** Referencia (electrónico) o N° de recibo de Logística (efectivo) */
  payment_ref: string
  /** 'bcv' si vino de la API del Banco Central, 'manual' si se escribió a mano */
  rate_source: 'bcv' | 'manual'
  /** Fecha valor de la tasa consultada */
  rate_date: string | null
  notes: string | null
  created_by: string | null
  created_at: string
}

export type TripStatus = 'programado' | 'en_curso' | 'finalizado' | 'cancelado'

export interface Trip {
  id: number
  branch_id: number | null
  vehicle_id: number
  driver_id: number
  departure_at: string
  status: TripStatus
  notes: string | null
  created_by: string | null
  created_at: string
  share_token: string | null
  track_km: boolean
}

export interface TripPassenger {
  id: number
  trip_id: number
  dni: string
  full_name: string
  role_name: string | null
  department: string | null
  branch_id: number | null
  origin_destination_id: number | null
  /** Observación individual (ej. "Fumigación") */
  observation: string | null
  /** Teléfono al momento de crear el viaje (instantánea) */
  phone: string | null
}

export interface TripDestination {
  id: number
  trip_id: number
  position: number
  name: string
  notes: string | null
}

/** Asignación pasajero ↔ destino (muchos a muchos) */
export interface TripPassengerDestination {
  id: number
  trip_passenger_id: number
  trip_destination_id: number
  arrived_at: string | null
  arrival_note: string | null
  latitude: number | null
  longitude: number | null
  gps_accuracy: number | null
  km: number | null
}

/** Novedad reportada por el chofer */
export interface TripIncident {
  id: number
  trip_passenger_id: number | null
  message: string
  created_at: string
}

/** Ubicación del catálogo (reutilizable entre viajes) */
export interface CatalogLocation {
  id: number
  name: string
  active: boolean
}

/** Respuesta de trip_share_get (viaje completo por token) */
export interface SharedTrip {
  trip: Trip & { share_token: string | null; status: TripStatus }
  branch: Branch | null
  vehicle: Vehicle | null
  driver: Driver | null
  passengers: Pick<
    TripPassenger,
    'id' | 'dni' | 'full_name' | 'role_name' | 'department' | 'origin_destination_id'
  >[]
  destinations: TripDestination[]
  links: TripPassengerDestination[]
  incidents: TripIncident[]
}

/** Viaje pendiente del chofer en su link publico */
export interface DriverPendingTrip {
  id: number
  status: TripStatus
  departure_at: string
  share_token: string | null
  notes: string | null
  track_km: boolean
  branch: string | null
  vehicle: string | null
  passengers: number
  destinations: string[]
}

/** Viaje libre activo del chofer (pasajeros + paradas) */
export interface FreeTrip {
  id: number
  status: 'en_curso' | 'finalizado'
  started_at: string
  finished_at: string | null
  passengers: {
    id: number
    full_name: string
    dni: string | null
    phone: string | null
    seq: number
  }[]
  stops: {
    id: number
    name: string
    note: string | null
    arrived_at: string
    seq: number
  }[]
}

/** Respuesta de driver_link_get (menu publico del chofer) */
export interface DriverLinkData {
  driver: {
    id: number
    full_name: string
    dni: string
    phone: string | null
    active: boolean
  }
  trips: DriverPendingTrip[]
  free_trip: FreeTrip | null
}

// ------------------------------------------------------------
// API Talento Humano (desarrolloluxor.lat)
// ------------------------------------------------------------

export interface ApiEmployee {
  nationality: string
  dni: number
  name: string
  lastname: string
  /** Teléfono móvil (ej. 04124362012); puede venir vacío */
  phone?: string | null
  role_id: string | null
  /** La API puede devolver null en campos de texto */
  role_name: string | null
  department_id: number | null
  department_name: string | null
  admin_loc_id: number | null
  admin_loc_name: string | null
  admission_date: string | null
  dismissal_date: string | null
  branch_id: number | null
  branch_name: string | null
  active: boolean
}
