import { ExternalLink, MapPin } from 'lucide-react'
import { up } from '../lib/format'

/**
 * Mapa de ruta planificada: Google Maps embebido en un iframe
 * que dibuja la ruta entre dos ubicaciones por nombre, sin
 * salir de la pantalla.
 */
export default function RouteMap({
  origin,
  destination,
  title = 'Mapa de ruta planificada',
}: {
  origin: string
  destination: string
  title?: string
}) {
  const from = origin.trim()
  const to = destination.trim()
  const same = from.toLowerCase() === to.toLowerCase()

  // Google resuelve "origen to destino" como indicaciones (A → B)
  const query = same ? from : `${from} to ${to}`
  const embedUrl = `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=13&output=embed`
  const openUrl = same
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(from)}`
    : `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}`

  return (
    <div className="route-map">
      <div className="route-map-head">
        <span className="route-map-title">
          <MapPin size={15} /> {title}
        </span>
        <span className="muted small">
          {up(from)}
          {!same && ` → ${up(to)}`}
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
