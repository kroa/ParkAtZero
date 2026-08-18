import { useCallback, useEffect, useMemo, useRef } from 'react'
import { motion, useAnimationControls, useDragControls, useMotionValue } from 'framer-motion'
import { cn } from '@/lib/cn'

export type Snap = 'peek' | 'half' | 'full'

interface Props {
  snap: Snap
  onSnapChange: (snap: Snap) => void
  /** 손잡이와 함께 드래그되는 요약 줄 (peek 상태에서도 읽혀야 하는 정보) */
  header: React.ReactNode
  /** 손잡이 아래 고정 영역. 필터칩처럼 '탭'이 필요한 컨트롤은 여기에 둔다 — 드래그와 충돌하지 않는다. */
  subHeader?: React.ReactNode
  children: React.ReactNode
  className?: string
}

const PEEK_PX = 188
const FULL_RATIO = 0.92
const HALF_RATIO = 0.54

const SPRING = { type: 'spring' as const, stiffness: 420, damping: 42, mass: 0.9 }

/**
 * 모바일 바텀 시트.
 *
 * - 지도 시야를 최대한 확보하기 위해 기본은 peek(요약 한 줄)이고, 위로 쓸어올리면 목록이 펼쳐진다.
 * - 드래그는 손잡이 영역에서만 시작된다(useDragControls). 본문은 평범하게 스크롤되므로
 *   "시트를 내리려다 목록이 튀는" 흔한 버그가 없다.
 * - 손잡이를 탭하면 peek ↔ full 로 토글 — 한 손 조작을 위한 지름길.
 */
export function BottomSheet({ snap, onSnapChange, header, subHeader, children, className }: Props) {
  const y = useMotionValue(0)
  const controls = useAnimationControls()
  const dragControls = useDragControls()
  const sheetRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const metrics = useMemo(() => {
    const vh = typeof window === 'undefined' ? 800 : window.innerHeight
    const height = Math.round(vh * FULL_RATIO)
    return {
      height,
      offsets: {
        full: 0,
        half: Math.max(0, height - Math.round(vh * HALF_RATIO)),
        peek: Math.max(0, height - PEEK_PX),
      } satisfies Record<Snap, number>,
    }
    // 회전/리사이즈 대응은 아래 resize 리스너가 담당한다.
  }, [])

  const animateTo = useCallback(
    (next: Snap) => {
      void controls.start({ y: metrics.offsets[next], transition: SPRING })
    },
    [controls, metrics],
  )

  useEffect(() => {
    animateTo(snap)
    if (snap === 'peek') scrollRef.current?.scrollTo({ top: 0 })
  }, [snap, animateTo])

  useEffect(() => {
    const onResize = () => animateTo(snap)
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [snap, animateTo])

  const settle = (velocity: number) => {
    // 관성을 반영한 '착지 예상 지점'으로 가장 가까운 스냅을 고른다.
    const projected = y.get() + velocity * 0.18
    const entries = Object.entries(metrics.offsets) as Array<[Snap, number]>
    let best: Snap = snap
    let bestDist = Number.POSITIVE_INFINITY
    for (const [key, offset] of entries) {
      const dist = Math.abs(projected - offset)
      if (dist < bestDist) {
        bestDist = dist
        best = key
      }
    }
    if (best === snap) animateTo(snap)
    else onSnapChange(best)
  }

  return (
    <motion.div
      ref={sheetRef}
      data-testid="bottom-sheet"
      data-snap={snap}
      style={{ y, height: metrics.height }}
      initial={{ y: metrics.offsets[snap] }}
      animate={controls}
      drag="y"
      dragListener={false}
      dragControls={dragControls}
      dragConstraints={{ top: metrics.offsets.full, bottom: metrics.offsets.peek }}
      dragElastic={{ top: 0.02, bottom: 0.06 }}
      onDragEnd={(_, info) => settle(info.velocity.y)}
      className={cn(
        'glass-strong glass-shine fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-3xl shadow-sheet',
        className,
      )}
      aria-label="주차장 목록"
    >
      {/* 손잡이 + 요약 — 여기서만 드래그가 시작된다 */}
      <div
        data-testid="sheet-handle"
        onPointerDown={(e) => dragControls.start(e)}
        onClick={() => onSnapChange(snap === 'full' ? 'peek' : 'full')}
        role="button"
        tabIndex={0}
        aria-label={snap === 'full' ? '목록 접기' : '목록 펼치기'}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSnapChange(snap === 'full' ? 'peek' : 'full')
          }
        }}
        className="shrink-0 cursor-grab touch-none select-none px-4 pb-2 pt-2.5 active:cursor-grabbing"
      >
        <span className="mx-auto block h-1.5 w-10 rounded-full bg-ink-mute/40" aria-hidden />
        <div className="mt-2.5">{header}</div>
      </div>

      {subHeader && <div className="shrink-0 px-4 pb-2.5">{subHeader}</div>}

      <div
        ref={scrollRef}
        data-testid="sheet-scroll"
        className={cn(
          'pz-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain safe-bottom',
          snap === 'peek' && 'pointer-events-none',
        )}
      >
        {children}
      </div>
    </motion.div>
  )
}
