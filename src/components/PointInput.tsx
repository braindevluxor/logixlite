import { useState } from 'react'
import { ChevronRight, Map as MapIcon } from 'lucide-react'
import MapPicker from './MapPicker'

/** Lee "lat, lon" del valor actual (para abrir el mapa en ese punto) */
function parseCoords(v: string): { lat: number; lon: number } | null {
  const m = v.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/)
  if (!m) return null
  const lat = parseFloat(m[1])
  const lon = parseFloat(m[2])
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lat, lon }
}

type Mode = 'map' | 'coords' | 'url'

/**
 * Campo de ubicación. Por DEFECTO el MAPA (modal con Leaflet
 * para buscar o marcar el punto), con opción de escribir las
 * coordenadas "lat, lon" o pegar el enlace de Google Maps.
 * El valor siempre termina como enlace o como "lat, lon", que
 * es lo que entienden el mapa de ruta y checkPointValue.
 */
export default function PointInput({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const [mode, setMode] = useState<Mode>('map')
  const [pickOpen, setPickOpen] = useState(false)

  return (
    <div className="point-input">
      <div className="seg">
        <button
          type="button"
          className={mode === 'map' ? 'active' : ''}
          onClick={() => {
            setMode('map')
            setPickOpen(true)
          }}
        >
          <MapIcon size={13} /> Mapa
        </button>
        <button
          type="button"
          className={mode === 'coords' ? 'active' : ''}
          onClick={() => setMode('coords')}
        >
          Coordenadas
        </button>
        <button
          type="button"
          className={mode === 'url' ? 'active' : ''}
          onClick={() => setMode('url')}
        >
          Enlace
        </button>
      </div>

      {/* Mapa: opción por defecto */}
      {mode === 'map' && (
        <button
          type="button"
          className="map-cta"
          onClick={() => setPickOpen(true)}
        >
          <MapIcon size={18} />
          <span>
            <strong>{value ? 'Punto marcado' : 'Buscar o marcar el punto'}</strong>
            <small>{value || 'Toca para abrir el mapa'}</small>
          </span>
          <ChevronRight size={16} />
        </button>
      )}

      {(mode === 'coords' || mode === 'url') && (
        <input
          type="text"
          className="input-url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            mode === 'url'
              ? 'https://www.google.com/maps/…'
              : '10.22239189, -67.55684945'
          }
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label={
            mode === 'url' ? 'Enlace de Google Maps' : 'Coordenadas de la ubicación'
          }
        />
      )}

      <MapPicker
        open={pickOpen}
        initial={parseCoords(value)}
        onPick={(coords) => {
          onChange(coords)
          setMode('map')
          setPickOpen(false)
        }}
        onClose={() => setPickOpen(false)}
      />
    </div>
  )
}
