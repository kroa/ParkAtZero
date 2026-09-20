import { Fragment, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { SearchX } from 'lucide-react'
import type { ResultItem, StatusFilter } from '@/lib/query'
import { cn } from '@/lib/cn'
import { CONFIG } from '@/lib/env'
import { ParkingCard } from './ParkingCard'
import type { LiveOccupancy } from '@/lib/liveOccupancy'
import { SkeletonList } from './SkeletonCard'
import { AdSlot } from './AdSlot'
import { AttributionNotice } from './AttributionNotice'

interface Props {
  items: ResultItem[]
  isSample: boolean
  /** 지금 켜져 있는 상태 필터 */
  statusFilter: StatusFilter
  /** 필터를 풀면 더 볼 것이 있는지 */
  hasOtherStatuses: boolean
  onRelaxStatus: () => void
  /** 스냅샷 전체 건수 (반경 필터 적용 전) */
  totalCount: number
  /** 원본 데이터 기준일 */
  referenceDate?: string
  loading: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  onResetFilters: () => void
  /** 주차장 id -> 지금 비어 있는 면수 */
  live?: Map<string, LiveOccupancy>
  className?: string
}

/** 광고를 목록 몇 번째 뒤에 끼울지. 첫 화면에서 바로 광고를 만나지 않도록 3번째 뒤에 둔다. */
const AD_AFTER_INDEX = 2

/**
 * 한 번에 그리는 카드 수.
 *
 * 전국 데이터가 들어오면 반경 10km 안에도 수백 곳이 잡힌다. 그걸 전부 DOM 에 올리면
 * 저사양 단말에서 첫 화면이 십수 초까지 밀린다(실측). 사용자는 어차피 상위 몇 개만 보므로
 * 처음엔 조금만 그리고 스크롤이 바닥에 닿을 때 이어서 늘린다.
 */
const INITIAL_VISIBLE = 20
const VISIBLE_STEP = 20

export function ParkingList({
  live,
  items,
  isSample,
  statusFilter,
  hasOtherStatuses,
  onRelaxStatus,
  totalCount,
  referenceDate,
  loading,
  selectedId,
  onSelect,
  onResetFilters,
  className,
}: Props) {
  const [visible, setVisible] = useState(INITIAL_VISIBLE)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // 필터·시간이 바뀌어 목록이 갈리면 다시 위에서부터 조금만 그린다.
  useEffect(() => setVisible(INITIAL_VISIBLE), [items])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible((v) => v + VISIBLE_STEP)
      },
      { rootMargin: '400px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [items, visible])

  if (loading) {
    return (
      <div className={cn('px-3 pb-4', className)}>
        <SkeletonList count={6} />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div data-testid="empty-state" className={cn('px-6 py-14 text-center', className)}>
        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-ink/[0.05] text-ink-mute"
        >
          <SearchX className="h-6 w-6" strokeWidth={2.2} />
        </motion.div>
        {statusFilter !== 'all' && hasOtherStatuses ? (
          <>
            <h3 className="mt-4 text-[15px] font-bold text-ink">
              이 조건에 맞는 곳은 없지만 다른 주차장은 있어요
            </h3>
            <p className="mx-auto mt-1.5 max-w-[300px] text-[13px] leading-relaxed text-ink-soft">
              도심에는 승용차가 댈 수 있는 무료 주차장이 드뭅니다.
              조건부 무료나 유료까지 함께 보시겠어요?
            </p>
            <button
              type="button"
              data-testid="relax-status"
              onClick={onRelaxStatus}
              className="tap mt-4 rounded-full bg-brand-500 px-4 py-2 text-[13px] font-bold text-white shadow-[0_8px_20px_-8px_rgba(50,139,255,0.9)] transition-transform active:scale-95"
            >
              전체 보기
            </button>
          </>
        ) : (
          <>
            <h3 className="mt-4 text-[15px] font-bold text-ink">조건에 맞는 주차장이 없어요</h3>
            <p className="mx-auto mt-1.5 max-w-[280px] text-[13px] leading-relaxed text-ink-soft">
              반경을 넓히거나 방문 시간을 바꿔 보세요. 저녁·주말에는 무료로 풀리는 곳이 많아요.
            </p>
            <button
              type="button"
              data-testid="reset-filters"
              onClick={onResetFilters}
              className="tap mt-4 rounded-full bg-brand-500 px-4 py-2 text-[13px] font-bold text-white shadow-[0_8px_20px_-8px_rgba(50,139,255,0.9)] transition-transform active:scale-95"
            >
              필터 초기화
            </button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className={cn('space-y-2.5 px-3 pb-6', className)} data-testid="parking-list">
      <AnimatePresence initial={false} mode="popLayout">
        {items.slice(0, visible).map((item, i) => (
          <Fragment key={item.parking.id}>
            <ParkingCard
              item={item}
              index={i}
              selected={selectedId === item.parking.id}
              onSelect={onSelect}
              live={live?.get(item.parking.id)}
            />
            {i === AD_AFTER_INDEX && items.length > AD_AFTER_INDEX + 1 && (
              // 광고는 카드 사이에 '한 칸 쉼표'처럼 들어간다. 위아래 여백을 카드 간격보다 살짝 크게 줘서
              // 콘텐츠와 광고의 경계를 시각적으로 분리한다.
              <div className="py-1.5">
                <AdSlot
                  placeholderId={CONFIG.ezoicIds.listInline}
                  minHeight={110}
                  label="SPONSORED"
                  className="border border-hairline/50"
                />
              </div>
            )}
          </Fragment>
        ))}
      </AnimatePresence>

      {/* 스크롤이 여기 닿으면 다음 묶음을 그린다 */}
      <div ref={sentinelRef} aria-hidden className="h-px" />

      {visible < items.length && (
        <p data-testid="list-more" className="tnum py-2 text-center text-[11.5px] font-semibold text-ink-mute">
          {items.length - visible}곳 더 있음 · 스크롤하면 이어집니다
        </p>
      )}

      <AttributionNotice
        isSample={isSample}
        count={totalCount}
        referenceDate={referenceDate}
        className="mt-2"
      />
    </div>
  )
}
