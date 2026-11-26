import { useEffect, useState } from 'react'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * Captura del evento beforeinstallprompt (Chrome, Edge, Android).
 * Se guarda a nivel de módulo para no perderlo si el componente
 * se monta después de que el navegador lo dispara.
 */
let deferred: InstallPromptEvent | null = null
const listeners = new Set<(hasPrompt: boolean) => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallPromptEvent
    listeners.forEach((fn) => fn(true))
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    listeners.forEach((fn) => fn(false))
  })
}

/** true si la app ya está corriendo como instalada (standalone) */
function isStandalone(): boolean {
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return (
    window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
  )
}

/** iOS/iPadOS no dispara beforeinstallprompt: se instala desde Safari */
function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent)
}

/** Instrucciones manuales cuando el navegador no ofrece el prompt */
function showInstructions(): void {
  if (isIOS()) {
    window.alert(
      'Para instalar la app en iPhone/iPad:\n\n' +
        '1) Toca el botón Compartir de Safari (cuadrado con flecha)\n' +
        '2) Elige "Agregar a pantalla de inicio"\n' +
        '3) Confirma con "Agregar"'
    )
    return
  }
  window.alert(
    'Este navegador no ofrece la instalación automática.\n\n' +
      '• Chrome / Edge (escritorio o Android): menú ⋮ → "Instalar LOGIXLITE" o "Añadir a pantalla de inicio".\n' +
      '• Safari (iPhone/iPad): Compartir → "Agregar a pantalla de inicio".'
  )
}

/**
 * Instalación de la PWA desde las vistas públicas del chofer.
 * - Chrome/Edge/Android: usa el prompt nativo del navegador.
 * - iOS o navegador sin soporte: muestra instrucciones.
 * - Si ya está instalada, el botón no se renderiza.
 * - Nunca falla en silencio: si el prompt no abre, se explican
 *   las instrucciones manuales.
 */
export function useInstallApp() {
  const [available, setAvailable] = useState(deferred !== null && !isStandalone())
  const [installed, setInstalled] = useState(isStandalone)

  useEffect(() => {
    const onChange = (hasPrompt: boolean) => {
      setAvailable(hasPrompt && !isStandalone())
      if (!hasPrompt) setInstalled(isStandalone())
    }
    listeners.add(onChange)
    return () => {
      listeners.delete(onChange)
    }
  }, [])

  async function install(): Promise<void> {
    if (!deferred) {
      showInstructions()
      return
    }

    const prompt = deferred
    deferred = null
    setAvailable(false)
    try {
      await prompt.prompt()
      const { outcome } = await prompt.userChoice
      if (outcome === 'accepted') setInstalled(true)
    } catch (err) {
      // Evento vencido o gesto no válido: nunca fallar en silencio
      console.warn('No se pudo abrir el diálogo de instalación:', err)
      showInstructions()
    }
  }

  return { available, installed, install, isIOS: isIOS() }
}
