import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'

interface SearchContextValue {
  query: string
  setQuery: (q: string) => void
}

const SearchContext = createContext<SearchContextValue>({
  query: '',
  setQuery: () => {},
})

/**
 * Buscador global de la barra superior.
 * Solo lo usan las pantallas que lo necesitan (Vehículos, Choferes);
 * la consulta se limpia automáticamente al cambiar de pantalla.
 */
export function SearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState('')
  const { pathname } = useLocation()

  useEffect(() => {
    setQuery('')
  }, [pathname])

  return (
    <SearchContext.Provider value={{ query, setQuery }}>
      {children}
    </SearchContext.Provider>
  )
}

export function useSearch(): SearchContextValue {
  return useContext(SearchContext)
}
