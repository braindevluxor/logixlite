import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Check, Send, Star } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { up } from '../lib/format'
import Stars from '../components/Stars'
import type { TripStatus } from '../lib/types'

interface RateData {
  rated: boolean
  rating: number | null
  comment: string | null
  passenger_name: string
  trip: { id: number; departure_at: string; status: TripStatus }
  driver: { full_name: string } | null
  vehicle: { plate: string } | null
  branch: { name: string } | null
  destinations: string[]
}

/**
 * Pantalla PUBLICA de calificacion del viaje (sin login):
 *   /calificar/:token
 * El token es unico por pasajero y viaje, y solo puede usarse
 * una vez (lo valida rating_submit en la base de datos).
 */
export default function RateTrip() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<RateData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const firstLoad = useRef(true)

  // Formulario
  const [stars, setStars] = useState(0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  /** true cuando SE ACABA DE ENVIAR en esta sesión */
  const [justDone, setJustDone] = useState(false)

  const load = useCallback(async () => {
    if (!token) {
      setError('Enlace incompleto.')
      setLoading(false)
      return
    }
    const { data: rpc, error: rpcErr } = await supabase.rpc('rating_get', {
      p_token: token,
    })
    if (firstLoad.current) {
      firstLoad.current = false
      setLoading(false)
    }
    if (rpcErr) {
      setError(
        rpcErr.message.includes('Enlace inválido')
          ? 'Este enlace no es válido o expiró.'
          : `Error: ${rpcErr.message}`
      )
      return
    }
    setData(rpc as unknown as RateData)
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  async function submit() {
    if (stars < 1) {
      setFormError('Selecciona cuántas estrellas quieres dar (de 1 a 5).')
      return
    }
    setFormError(null)
    setSaving(true)
    const { error: rpcErr } = await supabase.rpc('rating_submit', {
      p_token: token,
      p_stars: stars,
      p_comment: comment.trim() ? comment.trim().toUpperCase() : null,
    })
    setSaving(false)

    if (rpcErr) {
      // Otro dispositivo ya usó el enlace: mostrar el estado final
      if (rpcErr.message.includes('ya fue usado')) {
        setJustDone(false)
        await load()
        return
      }
      setFormError(rpcErr.message)
      return
    }

    setJustDone(true)
    await load()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ---- Vistas ----
  if (loading) {
    return (
      <div className="driver-page">
        <div className="loading-screen">Cargando…</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="driver-page">
        <div className="driver-main">
          <div className="driver-card">
            <div className="brand brand-lg">
              <img src="/logo-mark.png" alt="" className="brand-logo brand-logo-lg" />
              LOGIXLITE
            </div>
            <div className="alert alert-error">{error ?? 'Enlace no encontrado'}</div>
          </div>
        </div>
      </div>
    )
  }

  const tripDate = new Date(data.trip.departure_at).toLocaleString('es-VE', {
    dateStyle: 'full',
    timeStyle: 'short',
  })
  const destStr =
    data.destinations.length > 0 ? data.destinations.map((n) => up(n)).join(' → ') : '—'
  const active = hover || stars

  // Ya calificado (por este dispositivo o por otro)
  if (data.rated) {
    const myStars = data.rating ?? 0
    return (
      <div className="driver-page">
        <header className="topbar">
          <span className="brand">
            <img
              src="/logo-white.webp"
              alt="LOGIXLITE"
              className="brand-logo brand-logo-white"
            />
            LOGIXLITE
          </span>
        </header>

        <main className="driver-main">
          <div className="driver-card rate-thanks">
            <span className="rate-ok">
              <Check size={34} />
            </span>
            <h2>{justDone ? '¡Gracias por tu calificación!' : 'Ya calificaste este viaje'}</h2>
            <Stars value={myStars} size={30} />
            {data.comment && <p className="rate-comment">“{data.comment}”</p>}
            <p className="muted small">
              Tu opinión nos ayuda a mejorar el servicio. Este enlace ya no se puede usar
              otra vez.
            </p>

            <dl className="kv rate-kv">
              <dt>Viaje</dt>
              <dd>
                #{data.trip.id} · {tripDate}
              </dd>
              <dt>Destinos</dt>
              <dd>{destStr}</dd>
            </dl>
          </div>
        </main>
      </div>
    )
  }

  // Formulario de calificación
  return (
    <div className="driver-page">
      <header className="topbar">
        <span className="brand">
          <img
            src="/logo-white.webp"
            alt="LOGIXLITE"
            className="brand-logo brand-logo-white"
          />
          LOGIXLITE
        </span>
      </header>

      <main className="driver-main">
        <div className="driver-card">
          <p className="muted small rate-hello">Hola</p>
          <h2 className="rate-name">{data.passenger_name}</h2>
          <p className="rate-ask">Califica tu experiencia de viaje</p>

          <dl className="kv rate-kv">
            <dt>Viaje</dt>
            <dd>
              #{data.trip.id} · {tripDate}
            </dd>
            <dt>Chofer</dt>
            <dd>{data.driver?.full_name ?? '—'}</dd>
            <dt>Vehículo</dt>
            <dd>{data.vehicle?.plate ?? '—'}</dd>
            {data.branch && (
              <>
                <dt>Sucursal</dt>
                <dd>{up(data.branch.name)}</dd>
              </>
            )}
            <dt>Destinos</dt>
            <dd>{destStr}</dd>
          </dl>

          {/* ---- 5 estrellas ---- */}
          <div className="rate-stars" role="radiogroup" aria-label="Calificación del viaje">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`rate-star ${n <= active ? 'on' : ''}`}
                onClick={() => {
                  setStars(n)
                  setFormError(null)
                }}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                onFocus={() => setHover(n)}
                onBlur={() => setHover(0)}
                aria-label={`${n} estrella${n > 1 ? 's' : ''}`}
                aria-pressed={stars === n}
              >
                <Star
                  size={40}
                  strokeWidth={1.5}
                  fill={n <= active ? 'currentColor' : 'none'}
                />
              </button>
            ))}
          </div>
          <p className="rate-hint">
            {stars > 0
              ? `${stars} de 5 estrellas`
              : 'Toca las estrellas para calificar'}
          </p>

          {/* ---- Comentario opcional ---- */}
          <label className="field">
            <span>Comentario (opcional)</span>
            <textarea
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Cuéntanos cómo estuvo el viaje…"
            />
          </label>

          {formError && <div className="alert alert-error">{formError}</div>}

          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={submit}
            disabled={saving}
          >
            <Send size={16} /> {saving ? 'Enviando…' : 'Enviar calificación'}
          </button>

          <p className="muted small rate-note">
            Este enlace es personal y solo puede usarse una vez.
          </p>
        </div>
      </main>
    </div>
  )
}
