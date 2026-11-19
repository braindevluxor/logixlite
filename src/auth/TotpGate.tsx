import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../lib/supabase'

const FLAG = 'logixlite_totp_ok'

/**
 * Gate TOTP para pantallas sensibles (Sucursales).
 * El código se verifica en una Edge Function: el secreto nunca
 * llega al navegador. La sesión del código dura mientras viva
 * la pestaña (sessionStorage); al cerrarla se vuelve a pedir.
 */
export default function TotpGate({ children }: { children: ReactNode }) {
  const [ok, setOk] = useState(() => sessionStorage.getItem(FLAG) === '1')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  async function verify(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/totp-verify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code: code.trim() }),
      })

      if (res.status === 404) {
        setError(
          'La función totp-verify no está desplegada. Ejecuta: supabase functions deploy totp-verify'
        )
        return
      }

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
      }

      if (res.ok && data.ok) {
        sessionStorage.setItem(FLAG, '1')
        setOk(true)
        setCode('')
      } else {
        setError(data.error ?? 'Código inválido')
        setCode('')
      }
    } catch {
      setError('No se pudo verificar. Revisa tu conexión e inténtalo de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  if (ok) return <>{children}</>

  return (
    <div className="totp-gate">
      <form className="card totp-card" onSubmit={verify}>
        <span className="totp-icon">
          <ShieldCheck size={30} />
        </span>
        <h1>Acceso restringido</h1>
        <p className="muted">
          Esta pantalla requiere un <strong>código TOTP</strong> de tu aplicación
          autenticadora (Google Authenticator, Authy, Microsoft Authenticator…).
        </p>

        <label className="field">
          <span>Código de 6 dígitos</span>
          <input
            className="totp-input"
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
            }
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            autoFocus
            maxLength={6}
          />
        </label>

        {error && <div className="alert alert-error">{error}</div>}

        <button
          className="btn btn-primary btn-block"
          disabled={busy || code.length !== 6}
        >
          {busy ? 'Verificando…' : <><KeyRound size={15} /> Verificar</>}
        </button>

        <div className="totp-foot">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => navigate('/')}
          >
            <ArrowLeft size={14} /> Volver al inicio
          </button>
          <Link className="btn btn-sm" to="/">
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  )
}
