import { Fragment } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { MapPinOff, SearchX } from 'lucide-react'
import type { ResultItem } from '@/lib/query'
import { cn } from '@/lib/cn'
import { CONFIG } from '@/lib/env'
import { ParkingCard } from './ParkingCard'
import { SkeletonList } from './SkeletonCard'
import { AdSlot } from './AdSlot'

interface Props {
  items: ResultItem[]
  loading: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  onResetFilters: () => void
  className?: string
}

/** 광고를 목록 몇 번째 뒤에 끼울지. 첫 화면에서 바로 광고를 만나지 않도록 3번째 뒤에 둔다. */
const AD_AFTER_INDEX = 2

export function ParkingList({ items, loading, selectedId, onSelect, onResetFilters, className }: Props) {
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
      </div>
    )
  }

  return (
    <div className={cn('space-y-2.5 px-3 pb-6', className)} data-testid="parking-list">
      <AnimatePresence initial={false} mode="popLayout">
        {items.map((item, i) => (
          <Fragment key={item.parking.id}>
            <ParkingCard
              item={item}
              index={i}
              selected={selectedId === item.parking.id}
              onSelect={onSelect}
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

      <p className="flex items-center justify-center gap-1.5 pt-2 text-[11px] text-ink-mute">
        <MapPinOff className="h-3 w-3" strokeWidth={2.4} />
        요금·운영시간은 공공데이터 기준이며 현장과 다를 수 있어요
      </p>
    </div>
  )
}
