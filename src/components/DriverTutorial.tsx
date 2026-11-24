import type { ReactNode } from 'react'
import { X } from 'lucide-react'

/** Paso numerado de la guia */
function Step({
  n,
  title,
  children,
}: {
  n: number
  title: string
  children: ReactNode
}) {
  return (
    <section className="tut-step">
      <span className="tut-num">{n}</span>
      <div className="tut-step-body">
        <h3>{title}</h3>
        {children}
      </div>
    </section>
  )
}

/** Resalta un boton tal como se ve en la app */
function Btn({ children }: { children: ReactNode }) {
  return <span className="tut-btn">{children}</span>
}

/** Resalta un campo de formulario */
function Field({ children }: { children: ReactNode }) {
  return <span className="tut-field">{children}</span>
}

/**
 * Tutorial paso a paso de la vista del chofer.
 * Se abre con el boton "Tutorial" de la barra superior.
 */
export default function DriverTutorial({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="card modal modal-wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Tutorial del chofer"
      >
        <div className="modal-head">
          <div>
            <h2>Tutorial</h2>
            <p className="muted small">Cómo usar el sistema, paso a paso</p>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onClose}
            aria-label="Cerrar tutorial"
          >
            <X size={15} />
          </button>
        </div>

        <div className="tut-body">
          <Step n={1} title="Tu link y el menú">
            <p>
              Entra al link que te pasó la empresa (normalmente por WhatsApp).
              Verás tu nombre arriba y el menú con dos recuadros grandes:{' '}
              <Btn>Viajes pendientes</Btn> y <Btn>Viaje libre</Btn>.
            </p>
            <p>
              En la barra superior están <Btn>Tutorial</Btn> (esta guía, la
              puedes abrir en cualquier momento) y <Btn>Menú</Btn> (vuelve a la
              pantalla principal).
            </p>
          </Step>

          <Step n={2} title="Viajes pendientes">
            <p>
              Toca el recuadro <Btn>Viajes pendientes</Btn> para ver los viajes
              que tienes asignados. Cada tarjeta muestra el estado (
              <Btn>Programado</Btn> o <Btn>En curso</Btn>), la fecha y hora de
              salida, las paradas en mayúsculas, la cantidad de pasajeros, el
              vehículo y la sucursal.
            </p>
            <p>
              <Btn>Abrir viaje</Btn> te entra al viaje para trabajarlo.{' '}
              <Btn>Volver</Btn> regresa al menú.
            </p>
          </Step>

          <Step n={3} title="Iniciar el viaje">
            <p>
              Si el viaje está Programado, toca <Btn>Iniciar viaje</Btn>. Hasta
              que lo hagas, cada pasajero mostrará el botón deshabilitado{' '}
              <Btn>Esperando inicio</Btn>.
            </p>
            <p>
              Si el viaje no puede salir, usa <Btn>Cancelar viaje</Btn>: se
              abre el campo obligatorio{' '}
              <Field>Motivo de la cancelación *</Field> y los botones{' '}
              <Btn>Volver</Btn> y <Btn>Confirmar cancelación</Btn>. Queda
              registrado como incidencia del viaje.
            </p>
          </Step>

          <Step n={4} title="Registrar la llegada de cada pasajero">
            <p>
              Con el viaje En curso, toca <Btn>Marcar llegada</Btn> junto al
              pasajero. Se abre el recuadro <Btn>Registrar llegada</Btn> con:
            </p>
            <ul className="tut-list">
              <li>
                <strong>Pasajero</strong> y <strong>Destino</strong>: solo
                lectura.
              </li>
              <li>
                <strong>Hora</strong>: se guarda sola cuando confirmas.
              </li>
              <li>
                <strong>Ubicación GPS</strong>: se solicita automáticamente; si
                falla, toca <Btn>Reintentar</Btn> (también puedes confirmar
                sin ubicación).
              </li>
              <li>
                Campo <Field>Kilometraje del vehículo *</Field>: obligatorio
                cuando el viaje registra KM (ej: 125430.5).
              </li>
              <li>
                Botones <Btn>Cancelar</Btn> y <Btn>Confirmar llegada</Btn>.
              </li>
            </ul>
            <p>
              Al confirmar, el botón cambia a <Btn>Llegó</Btn> (verde); tócalo
              otra vez para desmarcar si te equivocaste. Arriba verás la barra{' '}
              <strong>Llegadas: X / Y</strong>: al llegar al 100% el viaje se
              finaliza solo.
            </p>
          </Step>

          <Step n={5} title="Novedades por pasajero">
            <p>
              El botón <Btn>Novedad</Btn> (amarillo) de cada pasajero sirve
              para reportar algo: que no se presentó, que llegó tarde, que
              cambió de parada. Escribe el motivo en el campo{' '}
              <Field>Descripción *</Field> y toca <Btn>Enviar novedad</Btn>.
            </p>
          </Step>

          <Step n={6} title="Viaje libre">
            <p>
              Vuelve al menú con <Btn>Menú</Btn>, toca el recuadro{' '}
              <Btn>Viaje libre</Btn> y luego <Btn>Iniciar viaje libre</Btn>. No
              requiere tener un viaje asignado.
            </p>
            <p>
              <strong>Pasajeros:</strong> campo obligatorio{' '}
              <Field>Nombre del pasajero *</Field> y opcionales{' '}
              <Field>Cédula</Field> y <Field>Teléfono</Field>; toca{' '}
              <Btn>Agregar</Btn>. Quedan numerados y la <Btn>X</Btn> los quita.
            </p>
            <p>
              <strong>Paradas:</strong> campo obligatorio{' '}
              <Field>Parada *</Field> (ej: TERMINAL) y opcional{' '}
              <Field>Nota</Field>; toca <Btn>Agregar</Btn>. Cada parada guarda
              sola la hora de llegada y aparece numerada; la <Btn>X</Btn> la
              quita.
            </p>
            <p>
              <Btn>Finalizar viaje</Btn> pide confirmación y muestra el
              resumen con los totales. Si cierras y vuelves, el viaje sigue
              activo: en el menú aparece destacado en verde como{' '}
              <strong>Viaje libre en curso</strong>.
            </p>
          </Step>

          <Step n={7} title="Consejos finales">
            <ul className="tut-list">
              <li>Refresca la pantalla si no ves un cambio reciente.</li>
              <li>No compartas tus links: son privados para ti.</li>
              <li>Si algo no funciona o falta un viaje, avisa a la oficina.</li>
            </ul>
          </Step>
        </div>
      </div>
    </div>
  )
}
