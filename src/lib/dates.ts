// ------------------------------------------------------------
// Fechas compartidas: rango filtrado del dashboard
// ------------------------------------------------------------

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 'YYYY-MM-DD' en la zona horaria local */
export function localISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Primer dia del mes en curso */
export function startOfMonthISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`
}

/** Fecha de hace n dias */
export function daysAgoISO(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return localISO(d)
}

/** Lista de fechas (YYYY-MM-DD) entre from y to, inclusive */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  const d = new Date(`${from}T00:00:00`)
  const end = new Date(`${to}T00:00:00`)
  let guard = 0
  while (d <= end && guard < 400) {
    out.push(localISO(d))
    d.setDate(d.getDate() + 1)
    guard++
  }
  return out
}

export interface QuickRange {
  label: string
  from: string
  to: string
}

/** Rangos rapidos del filtro (Hoy / 7 dias / Este mes) */
export function quickRanges(): QuickRange[] {
  const today = localISO(new Date())
  return [
    { label: 'Hoy', from: today, to: today },
    { label: '7 días', from: daysAgoISO(6), to: today },
    { label: 'Este mes', from: startOfMonthISO(), to: today },
  ]
}
