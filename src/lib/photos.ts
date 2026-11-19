import { supabase } from './supabase'

/** Bucket de Supabase Storage para fotos de vehículos */
export const VEHICLE_BUCKET = 'vehicle-photos'

/** URL pública de la foto de un vehículo (null si no tiene) */
export function vehiclePhotoUrl(path: string | null): string | null {
  if (!path) return null
  return supabase.storage.from(VEHICLE_BUCKET).getPublicUrl(path).data.publicUrl
}

/** Reduce y comprime la foto en el navegador antes de subirla */
async function optimizeImage(file: File): Promise<Blob> {
  let width: number
  let height: number
  let draw: (ctx: CanvasRenderingContext2D) => void
  let cleanup = () => {}

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    width = bitmap.width
    height = bitmap.height
    draw = (ctx) => ctx.drawImage(bitmap, 0, 0)
    cleanup = () => bitmap.close()
  } catch {
    // Fallback para navegadores sin createImageBitmap
    const url = URL.createObjectURL(file)
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('No se pudo leer la imagen'))
      el.src = url
    })
    width = img.naturalWidth
    height = img.naturalHeight
    draw = (ctx) => ctx.drawImage(img, 0, 0)
    cleanup = () => URL.revokeObjectURL(url)
  }

  try {
    const MAX = 900 // px del lado mayor
    const scale = Math.min(1, MAX / Math.max(width, height))
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('No se pudo procesar la imagen')
    draw(ctx)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.8)
    )
    if (!blob) throw new Error('No se pudo comprimir la imagen')
    return blob
  } finally {
    cleanup()
  }
}

/**
 * Optimiza y sube la foto al bucket. Devuelve la ruta a guardar
 * en vehicles.photo_path.
 */
export async function uploadVehiclePhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('El archivo debe ser una imagen (JPG, PNG o WebP)')
  }
  const blob = await optimizeImage(file)
  const path = `vehiculos/${crypto.randomUUID()}.jpg`

  const { error } = await supabase.storage
    .from(VEHICLE_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false })

  if (error) throw new Error(`No se pudo subir la foto: ${error.message}`)
  return path
}

/** Elimina una foto del bucket (best effort, sin lanzar) */
export async function removeVehiclePhoto(path: string): Promise<void> {
  try {
    await supabase.storage.from(VEHICLE_BUCKET).remove([path])
  } catch (err) {
    console.warn('No se pudo eliminar la foto:', err)
  }
}
