import { useCallback, useEffect, useRef, useState } from 'react'

export interface TourStep {
  /** Selector CSS del elemento a resaltar (data-tour="...") */
  target: string
  title: string
  description: string
}

/** Margen alrededor del elemento resaltado */
const PAD = 6

function exists(step: TourStep): boolean {
  return !!document.querySelector(step.target)
}

/**
 * Tutorial interactivo con resaltado (spotlight):
 *  - oscurece la pantalla dejando libre el elemento activo,
 *  - lo encuadra con un anillo celeste,
 *  - muestra un cuadro flotante con "Paso X de N", titulo,
 *    descripcion y los controles Salir / Anterior / Siguiente.
 *
 * Los pasos cuyo elemento no exista en pantalla se saltan
 * automaticamente (las vistas cambian segun el estado).
 */
export default function SpotlightTour({
  open,
  steps,
  onClose,
}: {
  open: boolean
  steps: TourStep[]
  onClose: () => void
}) {
  const [idx, setIdx] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const popRef = useRef<HTMLDivElement>(null)

  // Los pasos pueden cambiar en cada render (estado del viaje):
  // se leen desde una referencia para no reiniciar el recorrido
  const stepsRef = useRef(steps)
  stepsRef.current = steps

  /** Mide el elemento del paso actual */
  const measure = useCallback(() => {
    const step = stepsRef.current[idx]
    const el = step ? document.querySelector(step.target) : null
    if (el) setRect(el.getBoundingClientRect())
  }, [idx])

  // Al abrir: ir al primer paso que exista en pantalla
  useEffect(() => {
    if (!open) return
    const list = stepsRef.current
    let n = 0
    while (n < list.length && !exists(list[n])) n++
    setIdx(n >= list.length ? 0 : n)
    setRect(null)
    setPos(null)
  }, [open])

  // Encuadrar el paso actual (scroll suave + medicion)
  useEffect(() => {
    if (!open) return
    const step = stepsRef.current[idx]
    const el = step ? document.querySelector(step.target) : null
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    measure()
    const t = window.setTimeout(measure, 450)
    return () => window.clearTimeout(t)
  }, [open, idx, measure])

  // Reposicionar al hacer scroll (captura: alcanza los contenedores
  // con scroll propio) o al cambiar el tamaño de la ventana
  useEffect(() => {
    if (!open) return
    const onMove = () => measure()
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open, measure])

  // Colocar el cuadro flotante debajo del elemento (o arriba si no cabe)
  useEffect(() => {
    if (!open || !rect) return
    const pop = popRef.current
    const popH = pop?.offsetHeight ?? 170
    const popW = pop?.offsetWidth ?? 310
    const spaceBelow = window.innerHeight - rect.bottom
    const top =
      spaceBelow >= popH + 20 ? rect.bottom + 14 : Math.max(12, rect.top - popH - 14)
    const left = Math.min(window.innerWidth - popW - 16, Math.max(16, rect.left))
    setPos({ top, left })
  }, [open, rect, idx])

  // Escape para salir
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const list = steps
  const current = list[idx]
  const total = list.filter(exists).length
  const visibleBefore = list.slice(0, idx).filter(exists).length
  const hasMore = list.slice(idx + 1).some(exists)

  function next() {
    let n = idx + 1
    while (n < list.length && !exists(list[n])) n++
    if (n >= list.length) onClose()
    else setIdx(n)
  }

  function prev() {
    let n = idx - 1
    while (n >= 0 && !exists(list[n])) n--
    if (n >= 0) setIdx(n)
  }

  if (!open || !current || !rect) return null

  return (
    <>
      {/* Bloquea la interaccion con la pagina mientras dura el tour */}
      <div className="tour-blocker" onClick={onClose} aria-hidden="true" />

      {/* Anillo que encuadra el elemento activo + sombra oscura */}
      <div
        className="tour-spotlight"
        style={{
          top: rect.top - PAD,
          left: rect.left - PAD,
          width: rect.width + PAD * 2,
          height: rect.height + PAD * 2,
        }}
        aria-hidden="true"
      />

      {/* Cuadro flotante con las instrucciones */}
      <div
        className="tour-popover"
        ref={popRef}
        style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
        role="dialog"
        aria-modal="true"
        aria-label="Tutorial"
      >
        <span className="tour-step-badge">
          Paso {visibleBefore + 1} de {total}
        </span>
        <h3>{current.title}</h3>
        <p>{current.description}</p>
        <div className="tour-controls">
          <button type="button" className="tour-btn tour-btn-close" onClick={onClose}>
            Salir
          </button>
          <div>
            {visibleBefore > 0 && (
              <button type="button" className="tour-btn tour-btn-prev" onClick={prev}>
                Anterior
              </button>
            )}
            <button type="button" className="tour-btn tour-btn-next" onClick={next}>
              {hasMore ? 'Siguiente' : 'Finalizar'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
