/**
 * Alias históricos de departamento: nombre viejo -> nombre actual.
 *
 * La API de Talento Humano cambió nombres con el tiempo (ej.
 * "EQUIPO TI" ahora es "TECNICO_TI") y los viajes guardan una
 * instantánea del departamento al crearse, así que sin este mapa
 * el dashboard mostraba los mismos departamentos separados.
 *
 * Si la API vuelve a cambiar un nombre, agregar aquí Y en
 * supabase/dept_normalize.sql (que limpia los datos viejos).
 */
const DEPT_ALIASES: Record<string, string> = {
  'EQUIPO TI': 'TECNICO_TI',
}

/** Normaliza el nombre de departamento para mostrar y agrupar */
export function deptName(value: string | null | undefined): string {
  const v = (value ?? '').trim()
  if (!v) return ''
  return DEPT_ALIASES[v.toUpperCase()] ?? v
}
