/**
 * Tasa del Banco Central de Venezuela (BCV) en Bs por 1 USD.
 *
 * Se consultan varias fuentes públicas en orden hasta que una responda
 * (todas responden con `Access-Control-Allow-Origin: *`, así que el
 * navegador puede llamarlas directamente). Si ninguna responde, el
 * formulario permite escribir la tasa a mano.
 */

export interface BcvRate {
  /** Bs por 1 USD */
  rate: number
  /** Fecha valor de la tasa (yyyy-mm-dd) cuando la fuente la informa */
  date: string | null
  /** Fuente que respondió (para mostrar en pantalla) */
  source: string
}

interface Source {
  label: string
  url: string
  parse: (data: unknown) => BcvRate | null
}

/** yyyy-mm-dd a partir de un ISO largo; null si no se puede */
function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 10) return null
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null
}

function rate(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

const SOURCES: Source[] = [
  {
    label: 'BCV',
    url: 'https://bcv.today/api/v1/rate.json',
    parse: (data) => {
      const d = data as { USD?: unknown; effective_date?: unknown; date?: unknown }
      const r = rate(d.USD)
      return r ? { rate: r, date: isoDate(d.effective_date) ?? isoDate(d.date), source: 'BCV' } : null
    },
  },
  {
    label: 'BCV',
    url: 'https://bcvhoy.com/api/tasas',
    parse: (data) => {
      const d = data as { oficial?: unknown; oficial_updated?: unknown }
      const r = rate(d.oficial)
      return r ? { rate: r, date: isoDate(d.oficial_updated), source: 'BCV' } : null
    },
  },
  {
    label: 'BCV',
    url: 'https://datos.cromstudio.com.ve/tasa',
    parse: (data) => {
      const d = data as { tasas?: { USD?: unknown }; actualizado_el?: unknown }
      const r = rate(d.tasas?.USD)
      return r ? { rate: r, date: isoDate(d.actualizado_el), source: 'BCV' } : null
    },
  },
]

/**
 * Consulta la tasa BCV del día. Prueba cada fuente en orden y devuelve
 * la primera que responda con un valor válido.
 * @throws Si ninguna fuente responde (el formulario permite tasa manual)
 */
export async function fetchBcvRate(): Promise<BcvRate> {
  let lastError = 'Sin respuesta de las fuentes'

  for (const source of SOURCES) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
      const res = await fetch(source.url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) {
        lastError = `${source.label}: HTTP ${res.status}`
        continue
      }
      const parsed = source.parse(await res.json())
      if (parsed) return parsed
      lastError = `${source.label}: respuesta inesperada`
    } catch (err) {
      lastError = `${source.label}: ${err instanceof Error ? err.message : 'error de red'}`
    } finally {
      clearTimeout(timer)
    }
  }

  throw new Error(lastError)
}
