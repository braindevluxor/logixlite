import { Download } from 'lucide-react'
import { useInstallApp } from '../pwa/install'

/**
 * Botón "Instalar app" para las vistas públicas del chofer.
 * Siempre visible, salvo que la app ya esté instalada:
 *  - Chrome/Edge/Android: abre el prompt nativo de instalación
 *  - iOS: instrucciones de "Agregar a pantalla de inicio"
 *  - Otros (o sin service worker): instrucciones manuales
 */
export default function InstallAppButton() {
  const { installed, install } = useInstallApp()

  if (installed) return null

  return (
    <button
      type="button"
      className="btn-install"
      onClick={() => void install()}
      title="Instalar la app en este dispositivo"
    >
      <Download size={15} /> Instalar app
    </button>
  )
}
