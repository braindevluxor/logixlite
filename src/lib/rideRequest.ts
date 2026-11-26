/**
 * Solicitudes de traslado (link público /solicitud).
 * Origen fijo: si cambia la sede de salida, editar aquí.
 */
export const SOLICITUD_ORIGEN = 'CENTRAL LUXOR'

/** Fila de trabajador del formulario de solicitud */
export interface SolicitudRow {
  full_name: string
  dni: string
  destination: string
  /** Teléfono que trae la nómina (API de trabajadores) */
  phone?: string | null
}

/** Solicitud tal como la ve el admin (Viajes) */
export interface RideRequest {
  id: number
  contact_phone: string | null
  notes: string | null
  status: 'pendiente' | 'atendida' | 'cancelada'
  created_at: string
  ride_request_passengers: {
    id: number
    full_name: string
    dni: string
    destination: string
    phone?: string | null
  }[]
}
