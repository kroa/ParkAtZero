import { memo } from 'react'
import { motion } from 'framer-motion'
import { CircleParking, Footprints, TriangleAlert } from 'lucide-react'
import type { ResultItem } from '@/lib/query'
import { cn } from '@/lib/cn'
import { formatDistance } from '@/lib/geo'
import { formatMoney } from '@/lib/freeCalc'
import { statusStyle } from '@/lib/statusStyle'
import { StatusBadge } from './StatusBadge'
import { NaviQuickButton } from './NaviButtons'

interface Props {
  item: ResultItem
  selected: boolean
  onSelect: (id: string) => void
  index: number
}

/**
 * 목록의 기본 단위.
 * 좌측 컬러 바 → 뱃지 → 요금 한 줄 순으로 시선이 흐르도록 배치했다.
 * 스크롤 성능을 위해 memo 로 감싸고, 리스트가 길어져도 프레임이 흔들리지 않게 애니메이션은 진입 1회만 준다.
 */
export const ParkingCard = memo(function ParkingCard({ item, selected, onSelect, index }: Props) {
  const { parking, evaluation, distanceKm } = item
  const style = statusStyle(evaluation.status)

  const costLabel =
    evaluation.cost === null
      ? '요금 미상'
      : evaluation.cost === 0
        ? '0원'
        : formatMoney(evaluation.cost)

  return (
    <motion.article
      data-testid="parking-card"
      data-parking-id={parking.id}
      data-status={evaluation.status}
      data-selected={selected ? 'true' : 'false'}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index, 8) * 0.022, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => onSelect(parking.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(parking.id)
        }
      }}
      aria-pressed={selected}
      className={cn(
        'group relative cursor-pointer overflow-hidden rounded-2xl border bg-surface-raised/70 pl-4 pr-3 py-3.5 transition-all duration-200',
        'hover:-translate-y-0.5 hover:shadow-glass dark:hover:shadow-glass-dark',
        selected
          ? 'border-brand-400/70 bg-brand-500/[0.06] shadow-glass dark:shadow-glass-dark'
          : 'border-hairline/70',
      )}
    >
      {/* 상태 컬러 바 — 목록을 훑을 때 색만으로 판단되게 하는 장치 */}
      <span className={cn('absolute inset-y-0 left-0 w-1', style.accent)} aria-hidden />

      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={evaluation.status} label={evaluation.badge} />
            {evaluation.estimated && (
              <span className="pz-chip bg-ink/[0.06] text-ink-mute" title="원본 데이터가 불완전해 일부 값을 추정했습니다">
                <TriangleAlert className="h-3 w-3" strokeWidth={2.4} />
                추정
              </span>
            )}
          </div>

          <h3
            data-testid="card-name"
            className="mt-2 truncate text-[15px] font-bold leading-tight tracking-[-0.01em] text-ink"
          >
            {parking.name}
          </h3>

          <p data-testid="card-headline" className="mt-1 truncate text-[13px] font-medium text-ink-soft">
            {evaluation.headline}
          </p>

          <div className="mt-2 flex items-center gap-2.5 text-[11.5px] font-semibold text-ink-mute">
            <span className="flex items-center gap-1 tnum">
              <Footprints className="h-3.5 w-3.5" strokeWidth={2.4} />
              {formatDistance(distanceKm)}
            </span>
            {parking.capacity > 0 && (
              <span className="flex items-center gap-1 tnum">
                <CircleParking className="h-3.5 w-3.5" strokeWidth={2.4} />
                {parking.capacity}면
              </span>
            )}
            <span className="truncate">{parking.ownership} · {parking.type}</span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <span
            data-testid="card-cost"
            className={cn(
              'tnum text-[15px] font-extrabold tracking-[-0.02em]',
              evaluation.cost === 0 ? 'text-free-600 dark:text-free-400' : 'text-ink',
            )}
          >
            {costLabel}
          </span>
          <NaviQuickButton target={{ name: parking.name, lat: parking.lat, lng: parking.lng }} />
        </div>
      </div>
    </motion.article>
  )
})
