// Genera el QR de inscripción TOTP para la app autenticadora.
// Lee la clave desde .env (TOTP_ENROLL_KEY) — el archivo generado
// (qr-totp.png) está en .gitignore: nunca se commitea.
//
// Uso: node scripts/gen-totp-qr.mjs
// Si pierdes el authenticator, corre esto y escanea de nuevo.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ACCOUNT = 'transporte@luxor.com'
const ISSUER = 'LOGIXLITE'

let secret = ''
try {
  const env = readFileSync(join(root, '.env'), 'utf8')
  const match = env.match(/^TOTP_ENROLL_KEY=(\S+)/m)
  if (match) secret = match[1]
} catch {
  // sin .env
}

if (!secret) {
  console.error('No se encontró TOTP_ENROLL_KEY en .env')
  process.exit(1)
}

const otpauth = `otpauth://totp/${ISSUER}:${encodeURIComponent(
  ACCOUNT
)}?secret=${secret}&issuer=${ISSUER}&algorithm=SHA1&digits=6&period=30`

const out = join(root, 'qr-totp.png')
await QRCode.toFile(out, otpauth, { width: 512, margin: 2 })
console.log('QR generado: ' + out)
console.log('Cuenta: ' + ISSUER + ': ' + ACCOUNT)
