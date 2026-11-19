/**
 * Muestra una ubicación en MAYÚSCULAS (solo visual:
 * no altera los datos guardados en la BD ni el catálogo).
 */
export function up(text: string): string {
  return text.toUpperCase()
}
