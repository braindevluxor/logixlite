// Supabase Edge Function: totp-verify
// Verifica un código TOTP de 6 dígitos (RFC 6238, HMAC-SHA1, 30s).
//
// El secreto NUNCA llega al navegador: vive en los secrets de Supabase.
//
// Despliegue:
//   supabase secrets set TOTP_SECRET=<clave base32>
//   supabase functions deploy totp-verify
//
// Uso desde la app:
//   POST {SUPABASE_URL}/functions/v1/totp-verify   { "code": "123456" }
//   Headers: Authorization: Bearer <anon key>

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/** Decodifica Base32 (RFC 4648) a bytes */
function base32Decode(input: string): Uint8Array {
  const ALPH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const clean = input.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = ALPH.indexOf(ch)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

/** Genera el TOTP actual (HMAC-SHA1, step 30s, 6 dígitos) */
async function totp(secret: string, atMs: number): Promise<string> {
  const counter = Math.floor(atMs / 1000 / 30)
  const buf = new ArrayBuffer(8)
  const view = new DataView(buf)
  view.setUint32(0, Math.floor(counter / 4294967296))
  view.setUint32(4, counter % 4294967296)

  const key = await crypto.subtle.importKey(
    'raw',
    base32Decode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  )
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf))
  const offset = sig[sig.length - 1] & 0x0f
  const bin =
    ((sig[offset] & 0x7f) << 24) |
    (sig[offset + 1] << 16) |
    (sig[offset + 2] << 8) |
    sig[offset + 3]
  return String(bin % 1_000_000).padStart(6, '0')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS })
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Método no permitido' }, 405)
  }

  const secret = Deno.env.get('TOTP_SECRET')
  if (!secret) {
    return json({ ok: false, error: 'Falta el secreto TOTP_SECRET en el proyecto' }, 500)
  }

  let code = ''
  try {
    const body = await req.json()
    code = String(body?.code ?? '').trim()
  } catch {
    return json({ ok: false, error: 'Cuerpo JSON inválido' }, 400)
  }

  if (!/^\d{6}$/.test(code)) {
    return json({ ok: false, error: 'El código debe tener 6 dígitos' }, 400)
  }

  // Ventana ±1 step (30s) para tolerar desfases de reloj
  const now = Date.now()
  for (const delta of [-30_000, 0, 30_000]) {
    if ((await totp(secret, now + delta)) === code) {
      return json({ ok: true })
    }
  }

  return json({ ok: false, error: 'Código inválido o expirado' }, 401)
})
