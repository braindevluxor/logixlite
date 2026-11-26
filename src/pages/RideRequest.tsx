import { useEffect, useState, type FormEvent } from 'react'
import { CircleCheck, MapPin, Plus, Send, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { up } from '../lib/format'
import { employeeFullName, fetchEmployees } from '../lib/talentoHumano'
import { SOLICITUD_ORIGEN, type SolicitudRow } from '../lib/rideRequest'
import type { ApiEmployee } from '../lib/types'

const EMPTY_ROW: SolicitudRow = { full_name: '', dni: '', destination: '' }

/**
 * Solicitud de traslado PÚBLICA (sin login):
 *   /solicitud
 * Origen fijo CENTRAL LUXOR; se agregan trabajadores con su
 * cédula y su destino. El admin la ve en Viajes.
 */
export default function RideRequest() {
  const [rows, setRows] = useState<SolicitudRow[]>([{ ...EMPTY_ROW }])
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [sentCount, setSentCount] = useState(0)

  // ---- Nómina de trabajadores (búsqueda por CÉDULA) ----
  const [roster, setRoster] = useState<ApiEmployee[] | null>(null)
  const [rosterState, setRosterState] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle'
  )
  const [rosterError, setRosterError] = useState<string | null>(null)

  /** Carga la nómina de TODAS las sucursales (una sola vez) */
  async function loadRoster() {
    if (rosterState === 'loading' || rosterState === 'ready') return
    setRosterState('loading')
    setRosterError(null)
    try {
      const { data: br, error: brErr } = await supabase.rpc('public_branches')
      if (brErr) {
        throw new Error(
          brErr.message.includes('public_branches')
            ? 'SIN_SQL'
            : brErr.message
        )
      }
      const branches = (br ?? []) as { external_id: number }[]
      if (branches.length === 0) throw new Error('No hay sucursales registradas')

      const results = await Promise.allSettled(
        branches.map((b) => fetchEmployees(b.external_id))
      )
      const ok = results.filter(
        (r): r is PromiseFulfilledResult<ApiEmployee[]> => r.status === 'fulfilled'
      )
      if (ok.length === 0) throw new Error('La nómina no respondió en ninguna sucursal')

      const seen = new Set<string>()
      setRoster(
        ok.flatMap((r) => r.value).filter((e) => {
          const dni = String(e.dni)
          if (seen.has(dni)) return false
          seen.add(dni)
          return true
        })
      )
      setRosterState('ready')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al consultar la nómina'
      setRosterError(
        msg === 'SIN_SQL'
          ? 'Nómina no disponible (ejecuta supabase/public_branches.sql). Escribe el nombre a mano.'
          : `${msg}. Escribe el nombre a mano.`
      )
      setRosterState('error')
    }
  }

  /** Busca la cédula en la nómina (null si no está o no cargó) */
  function findByDni(dni: string): ApiEmployee | null {
    const d = dni.trim()
    if (!d || !roster) return null
    return roster.find((e) => String(e.dni) === d) ?? null
  }

  /** Al escribir la cédula, completa el nombre desde la nómina */
  function onDniChange(i: number, value: string) {
    const found = roster ? roster.find((e) => String(e.dni) === value.trim()) : null
    setRows((prev) =>
      prev.map((row, j) =>
        j === i
          ? {
              ...row,
              dni: value,
              ...(found ? { full_name: employeeFullName(found) } : {}),
            }
          : row
      )
    )
  }

  // Si la nómina carga después de escribir las cédulas, completa
  // los nombres que ya estén en la lista
  useEffect(() => {
    if (rosterState !== 'ready' || !roster) return
    setRows((prev) =>
      prev.map((row) => {
        const found = findByDni(row.dni)
        const name = found ? employeeFullName(found) : row.full_name
        return name === row.full_name ? row : { ...row, full_name: name }
      })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterState, roster])

  // ---- Trabajadores ----
  function updateRow(i: number, patch: Partial<SolicitudRow>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  function addRow() {
    setRows((prev) => [...prev, { ...EMPTY_ROW }])
  }

  function removeRow(i: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const clean = rows
      .map((r) => ({
        full_name: r.full_name.trim(),
        dni: r.dni.trim(),
        destination: r.destination.trim(),
      }))
      .filter((r) => r.full_name || r.dni || r.destination)

    if (clean.length === 0) {
      return setError('Agrega al menos un trabajador.')
    }
    if (clean.some((r) => !r.full_name || !r.dni || !r.destination)) {
      return setError('Cada trabajador necesita nombre, cédula y destino.')
    }
    const seen = new Set<string>()
    for (const r of clean) {
      if (seen.has(r.dni)) return setError(`La cédula ${r.dni} está repetida.`)
      seen.add(r.dni)
    }

    setSaving(true)
    const { error: rpcErr } = await supabase.rpc('ride_request_submit', {
      p_phone: phone.trim() || null,
      p_notes: notes.trim() || null,
      p_passengers: clean,
    })
    setSaving(false)

    if (rpcErr) {
      setError(
        rpcErr.message.includes('ride_request_submit')
          ? 'Falta el SQL de solicitudes: ejecuta supabase/ride_requests.sql en Supabase y recarga.'
          : rpcErr.message
      )
      return
    }

    setDone(true)
    setSentCount(clean.length)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function reset() {
    setRows([{ ...EMPTY_ROW }])
    setPhone('')
    setNotes('')
    setError(null)
    setDone(false)
    setSentCount(0)
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
      </header>

      <main className="driver-main">
        {done ? (
          <div className="driver-card rate-thanks">
            <span className="rate-ok">
              <Send size={30} />
            </span>
            <h2>Solicitud enviada</h2>
            <p className="muted">
              Recibimos la solicitud de {sentCount}{' '}
              {sentCount === 1 ? 'trabajador' : 'trabajadores'}. La oficina la revisará
              y confirmará el traslado.
            </p>
            <button type="button" className="btn btn-primary btn-block" onClick={reset}>
              Enviar otra solicitud
            </button>
          </div>
        ) : (
          <div className="driver-card">
            <h2 style={{ marginTop: 0 }}>Solicitud de traslado</h2>
            <p className="muted small">
              Indica quiénes viajan y a dónde se bajan. La oficina revisará tu solicitud.
            </p>

            {/* Origen fijo */}
            <div className="sol-origen">
              <MapPin size={16} /> Origen: {SOLICITUD_ORIGEN}
            </div>

            <form onSubmit={onSubmit}>
              {/* ---- Trabajadores: cédula + nombre + destino en la misma fila ---- */}
              <div className="assign-label">Trabajadores</div>
              <div className="ft-list">
                {rows.map((r, i) => {
                  const found = findByDni(r.dni)
                  const searching = rosterState === 'loading' && !!r.dni.trim()
                  return (
                    <div key={i} className="ft-row sol-row">
                      <span className="ft-seq">{i + 1}</span>
                      <div className="sol-fields">
                        {/* La CÉDULA manda: busca al trabajador en la nómina */}
                        <input
                          value={r.dni}
                          onChange={(e) => onDniChange(i, e.target.value)}
                          onFocus={() => {
                            if (rosterState === 'idle') void loadRoster()
                          }}
                          placeholder="Cédula *"
                          inputMode="numeric"
                          aria-label={`Cédula del trabajador ${i + 1}`}
                        />
                        <input
                          value={r.full_name}
                          onChange={(e) => updateRow(i, { full_name: e.target.value })}
                          readOnly={!!found}
                          placeholder={
                            searching ? 'Buscando en la nómina…' : 'Nombre completo *'
                          }
                          aria-label={`Nombre del trabajador ${i + 1}`}
                        />
                        <input
                          value={r.destination}
                          onChange={(e) => updateRow(i, { destination: e.target.value })}
                          placeholder="Destino *"
                          aria-label={`Destino del trabajador ${i + 1}`}
                        />

                        {/* Estado de la búsqueda por cédula */}
                        {found ? (
                          <span className="sol-hint sol-hint-ok">
                            <CircleCheck size={12} />
                            {up(employeeFullName(found))}
                            {found.department_name ? ` · ${up(found.department_name)}` : ''}
                          </span>
                        ) : searching ? (
                          <span className="sol-hint">Buscando en la nómina…</span>
                        ) : rosterState === 'error' && r.dni.trim() ? (
                          <span className="sol-hint sol-hint-warn">{rosterError}</span>
                        ) : rosterState === 'ready' && r.dni.trim() ? (
                          <span className="sol-hint sol-hint-warn">
                            Cédula no encontrada en la nómina: escribe el nombre.
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => removeRow(i)}
                        aria-label={`Quitar trabajador ${i + 1}`}
                        disabled={rows.length === 1}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )
                })}
              </div>
              <button type="button" className="btn sol-add" onClick={addRow}>
                <Plus size={14} /> Agregar trabajador
              </button>

              {/* ---- Contacto y comentario ---- */}
              <label className="field">
                <span>Teléfono de contacto (opcional)</span>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  inputMode="tel"
                  placeholder="0412…"
                />
              </label>
              <label className="field">
                <span>Comentario (opcional)</span>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Algo que debamos saber…"
                />
              </label>

              {error && <div className="alert alert-error">{error}</div>}

              <button
                type="submit"
                className="btn btn-primary btn-block"
                disabled={saving}
              >
                <Send size={16} /> {saving ? 'Enviando…' : 'Enviar solicitud'}
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  )
}
