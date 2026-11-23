/**
 * Muestra una ubicación en MAYÚSCULAS (solo visual:
 * no altera los datos guardados en la BD ni el catálogo).
 */
export function up(text: string): string {
  return text.toUpperCase()
}

/**
 * Iniciales de un nombre completo para el avatar (máx. 2 letras).
 * Ej: "María Pérez López" → "MP"
 */
export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  return parts
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase()
}
