import { createContext, useContext, useState, type ReactNode } from 'react'
import { localISO, startOfMonthISO } from '../lib/dates'

interface DateFilterValue {
  /** Fecha "desde" (YYYY-MM-DD) */
  from: string
  /** Fecha "hasta" (YYYY-MM-DD) */
  to: string
  setFrom: (v: string) => void
  setTo: (v: string) => void
  /** Vuelve al rango por defecto (inicio del mes a hoy) */
  reset: () => void
}

const DateFilterContext = createContext<DateFilterValue>({
  from: '',
  to: '',
  setFrom: () => {},
  setTo: () => {},
  reset: () => {},
})

/**
 * Rango de fechas global del dashboard.
 * El control vive en la barra superior (Shell) y lo consume
 * la pantalla del dashboard.
 */
export function DateFilterProvider({ children }: { children: ReactNode }) {
  const [from, setFrom] = useState(startOfMonthISO)
  const [to, setTo] = useState(() => localISO(new Date()))

  function reset() {
    setFrom(startOfMonthISO())
    setTo(localISO(new Date()))
  }

  return (
    <DateFilterContext.Provider value={{ from, to, setFrom, setTo, reset }}>
      {children}
    </DateFilterContext.Provider>
  )
}

export function useDateFilter(): DateFilterValue {
  return useContext(DateFilterContext)
}
