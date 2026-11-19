// Genera los iconos PNG de la PWA sin dependencias externas.
// Uso: node scripts/generate-icons.mjs
import { deflateSync, crc32 } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'public', 'icons')
mkdirSync(OUT, { recursive: true })

// ---------- PNG mínimo (RGBA) ----------
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  // filas con filtro 0
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------- Lienzo ----------
class Canvas {
  constructor(size) {
    this.size = size
    this.data = Buffer.alloc(size * size * 4)
  }
  set(x, y, [r, g, b, a = 255]) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return
    const i = (y * this.size + x) * 4
    const na = a / 255
    const oa = this.data[i + 3] / 255
    const outA = na + oa * (1 - na)
    if (outA === 0) return
    this.data[i] = Math.round((r * na + this.data[i] * oa * (1 - na)) / outA)
    this.data[i + 1] = Math.round((g * na + this.data[i + 1] * oa * (1 - na)) / outA)
    this.data[i + 2] = Math.round((b * na + this.data[i + 2] * oa * (1 - na)) / outA)
    this.data[i + 3] = Math.round(outA * 255)
  }
  rect(x0, y0, w, h, color) {
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) this.set(x, y, color)
  }
  roundRect(x0, y0, w, h, r, color) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const dx = Math.max(x0 + r - x, x - (x0 + w - 1 - r), 0)
        const dy = Math.max(y0 + r - y, y - (y0 + h - 1 - r), 0)
        if (dx * dx + dy * dy <= r * r) this.set(x, y, color)
      }
    }
  }
  circle(cx, cy, r, color) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.set(x, y, color)
  }
}

// ---------- Dibujo del icono ----------
const NAVY = [15, 23, 42, 255]
const BLUE = [37, 99, 235, 255]
const SKY = [56, 189, 248, 255]
const WHITE = [241, 245, 249, 255]

function drawIcon(size, { maskable = false } = {}) {
  const c = new Canvas(size)
  const u = size / 64 // unidad de diseño

  if (maskable) {
    // maskable: fondo de borde a borde, arte en zona segura (80%)
    c.rect(0, 0, size, size, NAVY)
  } else {
    c.roundRect(0, 0, size, size, Math.round(14 * u), NAVY)
  }

  const pad = maskable ? 8 * u : 0
  const k = (size - pad * 2) / 64 // escala del arte
  const ox = pad
  const oy = pad

  // Carrocería de van/ómnibus
  c.roundRect(
    Math.round(ox + 12 * k),
    Math.round(oy + 16 * k),
    Math.round(40 * k),
    Math.round(26 * k),
    Math.round(5 * k),
    BLUE
  )
  // Ventanilla
  c.roundRect(
    Math.round(ox + 17 * k),
    Math.round(oy + 21 * k),
    Math.round(30 * k),
    Math.round(9 * k),
    Math.round(3 * k),
    SKY
 )
  // Ruedas
  const wheelY = Math.round(oy + 45 * k)
  c.circle(Math.round(ox + 22 * k), wheelY, Math.round(5.5 * k), WHITE)
  c.circle(Math.round(ox + 43 * k), wheelY, Math.round(5.5 * k), WHITE)
  c.circle(Math.round(ox + 22 * k), wheelY, Math.round(2.4 * k), NAVY)
  c.circle(Math.round(ox + 43 * k), wheelY, Math.round(2.4 * k), NAVY)

  return encodePNG(size, c.data)
}

writeFileSync(join(OUT, 'icon-192.png'), drawIcon(192))
writeFileSync(join(OUT, 'icon-512.png'), drawIcon(512))
writeFileSync(join(OUT, 'icon-maskable-512.png'), drawIcon(512, { maskable: true }))

console.log('Iconos generados en public/icons/')
