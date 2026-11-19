// Convierte el logo de public/ a WebP con fondo transparente
// para la barra superior. Requiere: npm install -D sharp
//
// Uso: node scripts/convert-logo-webp.mjs
// Entrada: public/logo blanco.png  →  Salida: public/logo-white.webp

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'public', 'logo blanco.png')
const out = join(root, 'public', 'logo-white.webp')

if (!existsSync(src)) {
  console.error('No existe: ' + src)
  process.exit(1)
}

await sharp(src).webp({ quality: 90 }).toFile(out)
const meta = await sharp(out).metadata()
console.log(
  `Convertido: public/logo-white.webp (${meta.width}x${meta.height}, alpha=${meta.hasAlpha})`
)
