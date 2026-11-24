import { ExternalLink, MapPin } from 'lucide-react'
import { up } from '../lib/format'

type MapPointInfo = { lat: number; lon: number } | { place: string }

const NUM = String.raw`-?\d+(?:\.\d+)?`
/** Coordenadas sueltas: "10.22239189, -67.55684945" */
const COORD_RE = new RegExp(`^\\s*(${NUM})\\s*,\\s*(${NUM})\\s*$`)

/** decodeURIComponent que nunca lanza */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '))
  } catch {
    return s.replace(/\+/g, ' ')
  }
}

/**
 * Valida el campo de enlace/coordenadas de una ubicación.
 * Devuelve null si está vacío o es válido, o el mensaje de error.
 * Acepta una URL de Google Maps o coordenadas "lat, lon".
 */
export function checkPointValue(value: string): string | null {
  const s = value.trim()
  if (!s) return null

  const c = s.match(COORD_RE)
  if (c) {
    const lat = parseFloat(c[1])
    const lon = parseFloat(c[2])
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return 'Coordenadas fuera de rango. Usa latitud, longitud (ej: 10.22239189, -67.55684945).'
    }
    return null
  }

  if (/^https?:\/\//i.test(s) || s.includes('google.') || s.includes('goo.gl')) {
    return null
  }
  return 'Pega una URL de Google Maps o coordenadas como 10.22239189, -67.55684945.'
}

/**
 * Extrae coordenadas o el nombre del lugar de un enlace de
 * Google Maps (formatos: coordenadas sueltas, ?q=10.1,-68.1,
 * @lat,lon,z, !3d..!4d, ?origin=lat,lon, /place/<nombre>).
 * Los enlaces cortos (maps.app.goo.gl) no traen coordenadas
 * y se devuelven null para que se use el nombre escrito.
 */
function parseMapsUrl(url: string): MapPointInfo | null {
  const u = url.trim()
  if (!u) return null
  const n = NUM

  // Coordenadas sueltas: "10.2224, -67.5568"
  const bare = u.match(COORD_RE)
  if (bare) {
    const lat = parseFloat(bare[1])
    const lon = parseFloat(bare[2])
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon }
    return null
  }

  const at = u.match(new RegExp(`@(${n}),(${n})`))
  if (at) {
    const lat = parseFloat(at[1])
    const lon = parseFloat(at[2])
    // @0,0 es un marcador vacío de Google, no un punto real
    if (!(lat === 0 && lon === 0)) return { lat, lon }
  }

  const d = u.match(new RegExp(`!3d(${n})!4d(${n})`))
  if (d) return { lat: parseFloat(d[1]), lon: parseFloat(d[2]) }

  const qCoord = u.match(new RegExp(`[?&]q=(${n}),(${n})`))
  if (qCoord) return { lat: parseFloat(qCoord[1]), lon: parseFloat(qCoord[2]) }

  const dir = u.match(new RegExp(`[?&]origin=(${n}),(${n})`))
  if (dir) return { lat: parseFloat(dir[1]), lon: parseFloat(dir[2]) }

  const place = u.match(/\/place\/([^/?#]+)/)
  if (place) return { place: safeDecode(place[1]) }

  const qText = u.match(/[?&]q=([^&#]+)/)
  if (qText) return { place: safeDecode(qText[1]) }

  return null
}

/** Punto a usar en la ruta: coordenadas, lugar o el nombre escrito */
function resolvePoint(url: string | null | undefined, fallback: string): string {
  const info = url ? parseMapsUrl(url) : null
  if (!info) return fallback.trim()
  const s = 'lat' in info ? `${info.lat},${info.lon}` : info.place
  // Un enlace de "direcciones" (X to Y) no sirve como punto único
  if (s.toLowerCase().includes(' to ')) return fallback.trim()
  return s
}

/**
 * Mapa de ruta planificada: Google Maps embebido en un iframe
 * que dibuja la ruta entre dos ubicaciones, sin salir de la
 * pantalla. Si origen/destino tienen enlace de Google Maps se
 * usan sus coordenadas/lugar exactos en lugar del nombre.
 */
export default function RouteMap({
  origin,
  destination,
  originUrl,
  destinationUrl,
  title = 'Mapa de ruta planificada',
}: {
  origin: string
  destination: string
  originUrl?: string | null
  destinationUrl?: string | null
  title?: string
}) {
  const from = resolvePoint(originUrl, origin)
  const to = resolvePoint(destinationUrl, destination)
  const same = from.toLowerCase() === to.toLowerCase()

  // Google resuelve "origen to destino" como indicaciones (A → B)
  const query = same ? from : `${from} to ${to}`
  const embedUrl = `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=15&output=embed`
  const openUrl = same
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(from)}`
    : `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}`

  // ¿Al menos un extremo trae enlace exacto de Google Maps?
  const precise =
    (originUrl ? parseMapsUrl(originUrl) !== null : false) ||
    (destinationUrl ? parseMapsUrl(destinationUrl) !== null : false)

  return (
    <div className="route-map">
      <div className="route-map-head">
        <span className="route-map-title">
          <MapPin size={15} /> {title}
        </span>
        <span className="muted small">
          {up(origin)}
          {origin !== destination && ` → ${up(destination)}`}
          {precise && <span className="route-map-flag">punto exacto</span>}
        </span>
      </div>

      <div className="map-frame">
        <iframe
          src={embedUrl}
          title={title}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>

      <a className="btn btn-block" href={openUrl} target="_blank" rel="noreferrer">
        <ExternalLink size={14} /> Abrir en Google Maps
      </a>
    </div>
  )
}
