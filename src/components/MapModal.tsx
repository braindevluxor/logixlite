import { ExternalLink, MapPin, X } from 'lucide-react'

export interface MapPoint {
  lat: number
  lon: number
  /** Título de la ventana (ubicaciones en mayúsculas) */
  title: string
  /** Texto secundario (ej: nombre del pasajero) */
  subtitle?: string
}

/**
 * Modal con el mapa embebido (Google Maps dentro de un iframe)
 * para ver la ubicación sin salir de la vista actual.
 */
export default function MapModal({
  point,
  onClose,
}: {
  point: MapPoint | null
  onClose: () => void
}) {
  if (!point) return null

  const coords = `${point.lat},${point.lon}`
  const embedUrl = `https://www.google.com/maps?q=${encodeURIComponent(coords)}&z=16&output=embed`
  const openUrl = `https://www.google.com/maps?q=${coords}`

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="card modal modal-wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Ubicación en el mapa"
      >
        <div className="modal-head">
          <div>
            <h2>
              <MapPin size={18} /> {point.title}
            </h2>
            <p className="muted small">
              {point.subtitle ? `${point.subtitle} · ` : ''}
              {point.lat}, {point.lon}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <X size={15} />
          </button>
        </div>

        {/* Mapa embebido: no saca de la pantalla */}
        <div className="map-frame">
          <iframe
            src={embedUrl}
            title="Mapa de la ubicación"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>

        <div className="row gap">
          <a className="btn grow" href={openUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> Abrir en Google Maps
          </a>
          <button type="button" className="btn btn-primary grow" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
