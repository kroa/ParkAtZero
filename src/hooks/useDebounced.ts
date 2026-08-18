import { useEffect, useState } from 'react'

/** 검색 입력처럼 매 타이핑마다 재계산하면 아까운 값에 쓴다. */
export function useDebounced<T>(value: T, delayMs = 180): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(id)
  }, [value, delayMs])

  return debounced
}
