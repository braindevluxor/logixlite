import type { ApiEmployee } from './types'

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) || ''

/**
 * Base de la API de Talento Humano.
 *
 * - En desarrollo: ruta relativa /api/talento → la resuelve el proxy de Vite
 *   (evita el bloqueo CORS: la API solo permite los headers token/Content-Type
 *   pero exige el header API_KEY, que solo puede agregarse en servidor).
 * - En producción: Supabase Edge Function `talento-employees`
 *   (la clave API vive en los secretos de Supabase, no en el bundle).
 * - Se puede sobrescribir con VITE_TALENTO_BASE.
 */
const EXPLICIT_BASE = import.meta.env.VITE_TALENTO_BASE as string | undefined

const BASE =
  EXPLICIT_BASE ||
  (import.meta.env.DEV
    ? '/api/talento'
    : SUPABASE_URL
      ? `${SUPABASE_URL}/functions/v1/talento-employees`
      : '/api/talento')

const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

const API_KEY =
  (import.meta.env.VITE_TALENTO_HUMANO_KEY as string) ||
  'PBDFeysVkGLa0zRfq5bYEUtNbmV0akhtN3hFakRES3E2cU82TVE9PQ=='

/** Construye los headers según el destino (proxy local, Edge Function o directo). */
function buildHeaders(): Record<string, string> {
  if (BASE.includes('/functions/v1/')) {
    // Edge Function de Supabase: se autentica con la anon key
    return {
      Authorization: `Bearer ${ANON_KEY ?? ''}`,
      'Content-Type': 'application/json',
    }
  }
  if (BASE.startsWith('/')) {
    // Proxy local: la clave la agrega el servidor de Vite
    return {}
  }
  // Llamada directa a la API (requiere que la API permita el header por CORS)
  return { API_KEY }
}

/**
 * Obtiene los empleados (pasajeros) de una sucursal.
 * @param branchId branchID de la API (ej: 5 = CENTRAL)
 */
export async function fetchEmployees(branchId: number): Promise<ApiEmployee[]> {
  const res = await fetch(
    `${BASE}/employee/samir?branchID=${encodeURIComponent(String(branchId))}`,
    { headers: buildHeaders() }
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Error ${res.status} al consultar empleados: ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as ApiEmployee[]
  return Array.isArray(data) ? data : []
}

/** Nombre completo legible de un empleado de la API */
export function employeeFullName(e: ApiEmployee): string {
  return `${e.name} ${e.lastname}`.trim()
}
