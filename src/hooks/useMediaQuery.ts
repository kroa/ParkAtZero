import { useEffect, useState } from 'react'

export type ViewportTier = 'compact' | 'medium' | 'expanded'

export const BREAKPOINTS = {
  compactMax: '(max-width: 767px)',
  medium: '(min-width: 768px) and (max-width: 1023px)',
  expanded: '(min-width: 1024px)',
} as const

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )

  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    setMatches(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/** 3단계 뷰포트 티어 반환 훅 */
export function useViewportTier(): ViewportTier {
  const isMedium = useMediaQuery(BREAKPOINTS.medium)
  const isExpanded = useMediaQuery(BREAKPOINTS.expanded)

  if (isExpanded) return 'expanded'
  if (isMedium) return 'medium'
  return 'compact'
}

/** 모바일 (< 768px) */
export function useIsMobile(): boolean {
  return useMediaQuery(BREAKPOINTS.compactMax)
}

/** 태블릿 (768px ~ 1023px) */
export function useIsTablet(): boolean {
  return useMediaQuery(BREAKPOINTS.medium)
}

/** 데스크톱 (>= 1024px) */
export function useIsDesktop(): boolean {
  return useMediaQuery(BREAKPOINTS.expanded)
}
