import { Download } from 'lucide-react'
import { useInstallApp } from '../pwa/install'

/**
 * Botón "Instalar app" para las vistas públicas del chofer.
 * Se oculta si la app ya está instalada o si el navegador no
 * ofrece forma de instalarla (en iOS muestra instrucciones).
 */
export default function InstallAppButton() {
  const { available, installed, install, isIOS } = useInstallApp()

  if (installed || (!available && !isIOS)) return null

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
