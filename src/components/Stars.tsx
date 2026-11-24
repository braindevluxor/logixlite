import { Star } from 'lucide-react'

/**
 * Estrellas de calificación (solo lectura).
 * Llenas hasta el valor dado; el resto queda hueco.
 */
export default function Stars({
  value,
  size = 14,
}: {
  value: number
  size?: number
}) {
  return (
    <span className="stars" aria-label={`${value} de 5 estrellas`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          className={n <= value ? 'star-on' : 'star-off'}
          aria-hidden="true"
        />
      ))}
    </span>
  )
}
