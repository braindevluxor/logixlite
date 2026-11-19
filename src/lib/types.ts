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

// ------------------------------------------------------------
// API Talento Humano (desarrolloluxor.lat)
// ------------------------------------------------------------

export interface ApiEmployee {
  nationality: string
  dni: number
  name: string
  lastname: string
  role_id: string
  role_name: string
  department_id: number
  department_name: string
  admin_loc_id: number | null
  admin_loc_name: string | null
  admission_date: string
  dismissal_date: string | null
  branch_id: number
  branch_name: string
  active: boolean
}
