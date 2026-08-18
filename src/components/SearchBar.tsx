import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Compass, LoaderCircle, MapPin, Search, X } from 'lucide-react'
import type { Parking } from '@/types/parking'
import type { LatLng } from '@/lib/geo'
import { cn } from '@/lib/cn'
import { findLandmarks, type Landmark } from '@/data/landmarks'
import { suggestParkings } from '@/lib/query'
import type { GeoStatus } from '@/hooks/useGeolocation'

export interface SearchTarget {
  kind: 'landmark' | 'parking'
  label: string
  sub: string
  center: LatLng
  zoom: number
  parkingId?: string
}

interface Props {
  value: string
  onChange: (value: string) => void
  onPick: (target: SearchTarget) => void
  onLocate: () => void
  geoStatus: GeoStatus
  parkings: Parking[]
  className?: string
}

function toTargets(query: string, parkings: Parking[]): SearchTarget[] {
  const landmarks: SearchTarget[] = findLandmarks(query, 4).map((lm: Landmark) => ({
    kind: 'landmark',
    label: lm.name,
    sub: lm.region,
    center: { lat: lm.lat, lng: lm.lng },
    zoom: lm.zoom,
  }))

  const lots: SearchTarget[] = suggestParkings(parkings, query, 5).map((p) => ({
    kind: 'parking',
    label: p.name,
    sub: p.address,
    center: { lat: p.lat, lng: p.lng },
    zoom: 17,
    parkingId: p.id,
  }))

  return [...landmarks, ...lots].slice(0, 7)
}

/**
 * 지도 위에 떠 있는 글래스 검색바.
 * 키보드(↑↓/Enter/Esc)로도 완전히 조작되며, 목록은 지역 → 주차장 순으로 묶어 보여준다.
 */
export function SearchBar({ value, onChange, onPick, onLocate, geoStatus, parkings, className }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const targets = useMemo(() => (value.trim() ? toTargets(value.trim(), parkings) : []), [value, parkings])

  useEffect(() => setActive(0), [value])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const commit = (target: SearchTarget | undefined) => {
    if (!target) return
    onPick(target)
    setOpen(false)
    inputRef.current?.blur()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!targets.length) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => (i + 1) % targets.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + targets.length) % targets.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      commit(targets[active])
    }
  }

  const locating = geoStatus === 'locating'

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <div
        className={cn(
          'glass glass-shine relative flex items-center gap-1 rounded-2xl pl-3.5 pr-1.5 transition-shadow',
          open && targets.length > 0 && 'rounded-b-none',
        )}
      >
        <Search className="h-[18px] w-[18px] shrink-0 text-ink-mute" strokeWidth={2.4} />

        <input
          ref={inputRef}
          data-testid="search-input"
          type="search"
          role="combobox"
          aria-expanded={open && targets.length > 0}
          aria-controls="pz-suggestions"
          aria-autocomplete="list"
          enterKeyHint="search"
          value={value}
          placeholder="지역 · 장소 · 주차장 검색"
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="h-12 min-w-0 flex-1 bg-transparent text-[15px] font-medium text-ink placeholder:text-ink-mute focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />

        {value && (
          <button
            type="button"
            data-testid="search-clear"
            aria-label="검색어 지우기"
            onClick={() => {
              onChange('')
              inputRef.current?.focus()
            }}
            className="tap flex h-8 w-8 items-center justify-center rounded-full text-ink-mute transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={2.4} />
          </button>
        )}

        <span className="mx-0.5 h-6 w-px bg-hairline/80" aria-hidden />

        <button
          type="button"
          data-testid="gps-button"
          onClick={onLocate}
          disabled={locating}
          aria-label="내 위치로 이동"
          className={cn(
            'tap flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-semibold transition-all',
            geoStatus === 'granted'
              ? 'bg-brand-500/12 text-brand-600 dark:text-brand-300'
              : 'text-ink-soft hover:bg-ink/5 hover:text-ink',
            locating && 'opacity-70',
          )}
        >
          {locating ? (
            <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={2.4} />
          ) : (
            <Compass className="h-4 w-4" strokeWidth={2.4} />
          )}
          <span className="hidden xs:inline">내 위치</span>
        </button>
      </div>

      <AnimatePresence>
        {open && targets.length > 0 && (
          <motion.ul
            id="pz-suggestions"
            data-testid="search-suggestions"
            role="listbox"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="glass absolute inset-x-0 top-full z-30 overflow-hidden rounded-b-2xl border-t-0 py-1"
          >
            {targets.map((t, i) => (
              <li key={t.kind + t.label + i} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  data-testid="suggestion-item"
                  data-kind={t.kind}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => commit(t)}
                  className={cn(
                    'flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors',
                    i === active ? 'bg-brand-500/10' : 'hover:bg-ink/[0.04]',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                      t.kind === 'landmark' ? 'bg-brand-500/12 text-brand-600 dark:text-brand-300' : 'bg-ink/[0.06] text-ink-soft',
                    )}
                  >
                    {t.kind === 'landmark' ? (
                      <MapPin className="h-4 w-4" strokeWidth={2.4} />
                    ) : (
                      <Search className="h-4 w-4" strokeWidth={2.4} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-ink">{t.label}</span>
                    <span className="block truncate text-[12px] text-ink-mute">{t.sub}</span>
                  </span>
                  <span className="shrink-0 text-[11px] font-medium text-ink-mute">
                    {t.kind === 'landmark' ? '지역' : '주차장'}
                  </span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}
