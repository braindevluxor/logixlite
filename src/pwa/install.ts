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

/**
 * Instalación de la PWA desde las vistas públicas del chofer.
 * - Chrome/Edge/Android: usa el prompt nativo del navegador.
 * - iOS: muestra instrucciones de "Agregar a pantalla de inicio".
 * - Si ya está instalada, el botón no se renderiza.
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
      if (isIOS()) {
        window.alert(
          'Para instalar la app en iPhone/iPad:\n\n' +
            '1) Toca el botón Compartir de Safari (cuadrado con flecha)\n' +
            '2) Elige "Agregar a pantalla de inicio"\n' +
            '3) Confirma con "Agregar"'
        )
      }
      return
    }

    const prompt = deferred
    deferred = null
    setAvailable(false)
    try {
      await prompt.prompt()
      const { outcome } = await prompt.userChoice
      if (outcome === 'accepted') setInstalled(true)
    } catch {
      // El navegador canceló el prompt (el usuario ya decidió o no aplica)
    }
  }

  return { available, installed, install, isIOS: isIOS() }
}
