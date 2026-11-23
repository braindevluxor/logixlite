import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  CircleCheck,
  MapPin,
  Play,
  Plus,
  UserRound,
  X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { up } from '../lib/format'
import type { DriverLinkData } from '../lib/types'

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-VE', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-VE', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Viaje libre del chofer (no requiere login):
 *   /chofer/:token/libre
 * El chofer declara quienes van con el y las paradas que
 * va haciendo durante el recorrido.
 */
export default function FreeTrip() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<DriverLinkData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const firstLoad = useRef(true)

  // ---- Pasajeros ----
  const [pName, setPName] = useState('')
  const [pDni, setPDni] = useState('')
  const [pPhone, setPPhone] = useState('')
  const [addingP, setAddingP] = useState(false)

  // ---- Paradas ----
  const [sName, setSName] = useState('')
  const [sNote, setSNote] = useState('')
  const [addingS, setAddingS] = useState(false)

  // ---- Iniciar / finalizar ----
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<{
    passengers: number
    stops: number
    finished_at: string
  } | null>(null)

  const load = useCallback(async () => {
    if (!token) {
      setError('Enlace incompleto.')
      setLoading(false)
      return
    }
    const { data: rpc, error: rpcErr } = await supabase.rpc('driver_link_get', {
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
    setData(rpc as unknown as DriverLinkData)
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  function flash(msg: string) {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2600)
  }

  const trip = data?.free_trip ?? null

  // ---- Acciones ----
  async function start() {
    setBusy(true)
    const { error: rpcErr } = await supabase.rpc('driver_free_start', {
      p_token: token,
    })
    setBusy(false)
    if (rpcErr) return flash(`Error: ${rpcErr.message}`)
    setSummary(null)
    flash('Viaje libre iniciado')
    load()
  }

  async function addPassenger(e: FormEvent) {
    e.preventDefault()
    if (!pName.trim()) return flash('Indica el nombre del pasajero')
    setAddingP(true)
    const { error: rpcErr } = await supabase.rpc('driver_free_add_passenger', {
      p_token: token,
      p_name: pName.trim(),
      p_dni: pDni.trim() || null,
      p_phone: pPhone.trim() || null,
    })
    setAddingP(false)
    if (rpcErr) return flash(`Error: ${rpcErr.message}`)
    setPName('')
    setPDni('')
    setPPhone('')
    flash('Pasajero agregado')
    load()
  }

  async function removePassenger(id: number) {
    const { error: rpcErr } = await supabase.rpc('driver_free_remove_passenger', {
      p_token: token,
      p_passenger_id: id,
    })
    if (rpcErr) return flash(`Error: ${rpcErr.message}`)
    flash('Pasajero quitado')
    load()
  }

  async function addStop(e: FormEvent) {
    e.preventDefault()
    if (!sName.trim()) return flash('Indica la parada')
    setAddingS(true)
    const { error: rpcErr } = await supabase.rpc('driver_free_add_stop', {
      p_token: token,
      p_name: sName.trim(),
      p_note: sNote.trim() || null,
    })
    setAddingS(false)
    if (rpcErr) return flash(`Error: ${rpcErr.message}`)
    setSName('')
    setSNote('')
    flash('Parada registrada')
    load()
  }

  async function removeStop(id: number) {
    const { error: rpcErr } = await supabase.rpc('driver_free_remove_stop', {
      p_token: token,
      p_stop_id: id,
    })
    if (rpcErr) return flash(`Error: ${rpcErr.message}`)
    flash('Parada quitada')
    load()
  }

  async function finish() {
    if (!window.confirm('¿Finalizar el viaje libre?')) return
    setBusy(true)
    const { data: rpc, error: rpcErr } = await supabase.rpc('driver_free_finish', {
      p_token: token,
    })
    setBusy(false)
    if (rpcErr) return flash(`Error: ${rpcErr.message}`)
    const row = rpc as {
      passengers: number
      stops: number
      finished_at: string
    }
    setSummary({
      passengers: Number(row.passengers),
      stops: Number(row.stops),
      finished_at: row.finished_at,
    })
    flash('Viaje finalizado')
    load()
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
        <Link className="btn btn-ghost" to={`/chofer/${token}`}>
          <ArrowLeft size={15} /> Menú
        </Link>
      </header>

      <main className="driver-main">
        <p className="muted small dm-driver">{data.driver.full_name}</p>

        {/* Resumen tras finalizar */}
        {summary && !trip && (
          <div className="driver-card ft-summary">
            <CircleCheck size={38} className="ft-summary-ok" />
            <h2>Viaje finalizado</h2>
            <p className="muted">
              {summary.passengers} pasajero(s) · {summary.stops} parada(s)
              <br />
              <span className="small">Terminó: {fmtDateTime(summary.finished_at)}</span>
            </p>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={start}
              disabled={busy}
            >
              <Play size={16} /> {busy ? 'Iniciando…' : 'Nuevo viaje libre'}
            </button>
            <Link className="btn btn-block" to={`/chofer/${token}`}>
              Volver al menú
            </Link>
          </div>
        )}

        {/* Sin viaje activo */}
        {!trip && !summary && (
          <div className="driver-card">
            <h2 style={{ marginTop: 0 }}>Viaje libre</h2>
            <p className="muted">
              Registra a quienes llevas y cada parada que haces durante el
              recorrido. No requiere un viaje asignado.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={start}
              disabled={busy}
            >
              <Play size={16} /> {busy ? 'Iniciando…' : 'Iniciar viaje libre'}
            </button>
            <Link className="btn btn-block" to={`/chofer/${token}`}>
              Volver al menú
            </Link>
          </div>
        )}

        {/* Viaje libre activo */}
        {trip && (
          <>
            <div className="driver-card">
              <div className="row spread">
                <h2 style={{ margin: 0 }}>Viaje libre</h2>
                <span className="badge badge-en_curso">En curso</span>
              </div>
              <p className="muted small" style={{ margin: '0.4rem 0 0.8rem' }}>
                Inicio: {fmtDateTime(trip.started_at)}
              </p>
              <button
                type="button"
                className="btn btn-danger btn-block"
                onClick={finish}
                disabled={busy}
              >
                <Check size={16} /> {busy ? 'Finalizando…' : 'Finalizar viaje'}
              </button>
            </div>

            {/* Pasajeros */}
            <div className="driver-card">
              <h2 className="ft-title">
                <UserRound size={17} /> Pasajeros ({trip.passengers.length})
              </h2>

              <form className="ft-form" onSubmit={addPassenger}>
                <input
                  className="grow"
                  placeholder="Nombre del pasajero *"
                  value={pName}
                  onChange={(e) => setPName(e.target.value)}
                  aria-label="Nombre del pasajero"
                />
                <input
                  placeholder="Cédula"
                  value={pDni}
                  onChange={(e) => setPDni(e.target.value)}
                  inputMode="numeric"
                  aria-label="Cédula del pasajero"
                />
                <input
                  placeholder="Teléfono"
                  value={pPhone}
                  onChange={(e) => setPPhone(e.target.value)}
                  inputMode="tel"
                  aria-label="Teléfono del pasajero"
                />
                <button type="submit" className="btn btn-primary" disabled={addingP}>
                  <Plus size={15} /> {addingP ? 'Agregando…' : 'Agregar'}
                </button>
              </form>

              <div className="ft-list">
                {trip.passengers.length === 0 ? (
                  <p className="muted small">Sin pasajeros registrados.</p>
                ) : (
                  trip.passengers.map((p) => (
                    <div key={p.id} className="ft-row">
                      <span className="ft-seq">{p.seq}</span>
                      <span className="grow">
                        <strong>{p.full_name}</strong>
                        {(p.dni || p.phone) && (
                          <span className="muted small">
                            {' '}
                            {p.dni ? `· C.I. ${p.dni}` : ''}
                            {p.dni && p.phone ? ' ' : ''}
                            {p.phone ? `· ${p.phone}` : ''}
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => removePassenger(p.id)}
                        aria-label={`Quitar ${p.full_name}`}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Paradas */}
            <div className="driver-card">
              <h2 className="ft-title">
                <MapPin size={17} /> Paradas ({trip.stops.length})
              </h2>

              <form className="ft-form" onSubmit={addStop}>
                <input
                  className="grow"
                  placeholder="Parada (ej. TERMINAL) *"
                  value={sName}
                  onChange={(e) => setSName(e.target.value)}
                  aria-label="Parada"
                />
                <input
                  placeholder="Nota (opcional)"
                  value={sNote}
                  onChange={(e) => setSNote(e.target.value)}
                  aria-label="Nota de la parada"
                />
                <button type="submit" className="btn btn-primary" disabled={addingS}>
                  <Plus size={15} /> {addingS ? 'Agregando…' : 'Agregar'}
                </button>
              </form>

              <div className="ft-list">
                {trip.stops.length === 0 ? (
                  <p className="muted small">Aún no registras paradas.</p>
                ) : (
                  trip.stops.map((s) => (
                    <div key={s.id} className="ft-row">
                      <span className="ft-seq">{s.seq}</span>
                      <span className="grow">
                        <strong>{up(s.name)}</strong>
                        {s.note && <span className="muted small"> — {s.note}</span>}
                        <span className="block muted small">
                          Llegada: {fmtTime(s.arrived_at)}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => removeStop(s.id)}
                        aria-label={`Quitar ${s.name}`}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
