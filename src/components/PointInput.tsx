import { useState } from 'react'
import { Map as MapIcon } from 'lucide-react'
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

/**
 * Campo de ubicación con 3 opciones:
 *   1) pegar el enlace de Google Maps
 *   2) escribir las coordenadas "lat, lon"
 *   3) buscar o marcar el punto en un mapa (modal con Leaflet)
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
  const [mode, setMode] = useState<'url' | 'coords'>('url')
  const [pickOpen, setPickOpen] = useState(false)

  return (
    <div className="point-input">
      <div className="seg">
        <button
          type="button"
          className={mode === 'url' ? 'active' : ''}
          onClick={() => setMode('url')}
        >
          1. Enlace
        </button>
        <button
          type="button"
          className={mode === 'coords' ? 'active' : ''}
          onClick={() => setMode('coords')}
        >
          2. Coordenadas
        </button>
        <button
          type="button"
          className="point-map-btn"
          onClick={() => setPickOpen(true)}
        >
          <MapIcon size={13} /> 3. Mapa
        </button>
      </div>

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

      <MapPicker
        open={pickOpen}
        initial={parseCoords(value)}
        onPick={(coords) => {
          onChange(coords)
          setMode('coords')
          setPickOpen(false)
        }}
        onClose={() => setPickOpen(false)}
      />
    </div>
  )
}
