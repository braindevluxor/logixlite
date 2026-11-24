import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapPin, Search, X } from 'lucide-react'

interface MapPoint {
  lat: number
  lon: number
}

interface SearchResult extends MapPoint {
  label: string
}

/** Formato "lat, lon" compatible con checkPointValue */
function fmtCoords(p: MapPoint): string {
  const r = (n: number) => String(Math.round(n * 1e7) / 1e7)
  return `${r(p.lat)}, ${r(p.lon)}`
}

/** Marcador propio: evita las imagenes por defecto de Leaflet */
function makeIcon(): L.DivIcon {
  return L.divIcon({
    className: 'mp-pin-wrap',
    html: '<span class="mp-pin"></span>',
    iconSize: [18, 18],
    iconAnchor: [9, 18],
  })
}

/**
 * Selector de punto en un mapa (OpenStreetMap con Leaflet, sin
 * API key): se busca un lugar (Nominatim) o se toca el mapa
 * para marcar el punto exacto. Devuelve "lat, lon".
 */
export default function MapPicker({
  open,
  initial,
  onPick,
  onClose,
}: {
  open: boolean
  initial?: MapPoint | null
  /** Entrega las coordenadas en formato "lat, lon" */
  onPick: (coords: string) => void
  onClose: () => void
}) {
  const mapEl = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const initialRef = useRef(initial)
  initialRef.current = initial

  const [point, setPoint] = useState<MapPoint | null>(initial ?? null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchErr, setSearchErr] = useState<string | null>(null)

  // Crear/destruir el mapa al abrir/cerrar
  useEffect(() => {
    if (!open) return
    const el = mapEl.current
    if (!el || mapRef.current) return

    const start = initialRef.current ?? { lat: 9.6, lon: -66.5 } // Venezuela
    const map = L.map(el, {
      center: [start.lat, start.lon],
      zoom: initialRef.current ? 15 : 7,
    })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© Colaboradores de OpenStreetMap',
      maxZoom: 19,
    }).addTo(map)
    map.on('click', (e: L.LeafletMouseEvent) => {
      setPoint({ lat: e.latlng.lat, lon: e.latlng.lng })
    })
    mapRef.current = map

    // El contenedor puede medir 0 en el primer render
    const t = window.setTimeout(() => map.invalidateSize(), 150)

    return () => {
      window.clearTimeout(t)
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
  }, [open])

  // Estado inicial al abrir
  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults([])
    setSearchErr(null)
    setPoint(initialRef.current ?? null)
  }, [open])

  // Marcador del punto elegido
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!point) {
      if (markerRef.current) {
        map.removeLayer(markerRef.current)
        markerRef.current = null
      }
      return
    }
    const ll: L.LatLngExpression = [point.lat, point.lon]
    if (markerRef.current) markerRef.current.setLatLng(ll)
    else markerRef.current = L.marker(ll, { icon: makeIcon() }).addTo(map)
  }, [point, open])

  /** Buscar lugares con Nominatim (OpenStreetMap, sin API key) */
  async function search() {
    const q = query.trim()
    if (!q || searching) return
    setSearching(true)
    setSearchErr(null)
    setResults([])
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(q)}`,
        { headers: { Accept: 'application/json' } }
      )
      if (!res.ok) throw new Error('No se pudo consultar el buscador')
      const data = (await res.json()) as { lat: string; lon: string; display_name: string }[]
      const rows: SearchResult[] = data.map((r) => ({
        lat: parseFloat(r.lat),
        lon: parseFloat(r.lon),
        label: r.display_name,
      }))
      setResults(rows)
      if (rows.length === 0) {
        setSearchErr('Sin resultados: prueba con otro nombre o toca el mapa directamente.')
      }
    } catch (err) {
      setSearchErr(err instanceof Error ? err.message : 'Error al buscar el lugar')
    } finally {
      setSearching(false)
    }
  }

  function selectResult(r: SearchResult) {
    setPoint({ lat: r.lat, lon: r.lon })
    mapRef.current?.flyTo([r.lat, r.lon], 16, { duration: 0.6 })
    setResults([])
    setQuery(r.label.split(',')[0])
  }

  if (!open) return null

  return (
    <div className="modal-backdrop mp-backdrop" onClick={onClose}>
      <div
        className="card modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Buscar ubicación en el mapa"
      >
        <div className="modal-head">
          <div>
            <h2>Buscar en el mapa</h2>
            <p className="muted small">
              Busca un lugar o toca el mapa para marcar el punto exacto.
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

        <div className="mp-search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void search()
              }
            }}
            placeholder="Escribe un lugar (ej: LOS PROCERES)"
            aria-label="Buscar lugar"
            autoComplete="off"
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void search()}
            disabled={searching}
          >
            <Search size={15} /> {searching ? 'Buscando…' : 'Buscar'}
          </button>
        </div>

        {searchErr && <div className="alert alert-warn">{searchErr}</div>}

        {results.length > 0 && (
          <ul className="mp-results">
            {results.map((r, i) => (
              <li key={`${r.lat}-${r.lon}-${i}`}>
                <button type="button" className="mp-result" onClick={() => selectResult(r)}>
                  <strong>{r.label.split(',')[0]}</strong>
                  <span>{r.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mp-map" ref={mapEl} />

        <div className="mp-point">
          {point ? (
            <>
              <MapPin size={14} /> {fmtCoords(point)}
            </>
          ) : (
            'Toca el mapa o busca un lugar para marcar el punto'
          )}
        </div>

        <div className="row gap">
          <button type="button" className="btn grow" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary grow"
            disabled={!point}
            onClick={() => point && onPick(fmtCoords(point))}
          >
            <MapPin size={15} /> Usar este punto
          </button>
        </div>
      </div>
    </div>
  )
}
