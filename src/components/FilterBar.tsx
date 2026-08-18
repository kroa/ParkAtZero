import { ArrowUpDown, Building2, Ruler } from 'lucide-react'
import { cn } from '@/lib/cn'
import { statusStyle } from '@/lib/statusStyle'
import type { OwnershipFilter, ResultSummary, SortKey, StatusFilter } from '@/lib/query'

interface Props {
  status: StatusFilter
  onStatusChange: (next: StatusFilter) => void
  radiusKm: number
  onRadiusChange: (next: number) => void
  ownership: OwnershipFilter
  onOwnershipChange: (next: OwnershipFilter) => void
  sort: SortKey
  onSortChange: (next: SortKey) => void
  summary: ResultSummary
  className?: string
}

const RADIUS_OPTIONS = [1, 3, 5, 10, 20]

const SORT_LABEL: Record<SortKey, string> = {
  smart: '추천순',
  distance: '거리순',
  cost: '요금순',
}

const OWNERSHIP_LABEL: Record<OwnershipFilter, string> = {
  all: '전체',
  공영: '공영',
  민영: '민영',
}

/** 상태 필터는 색으로 의미를 전달하므로 선택 시 해당 상태 컬러를 그대로 입는다. */
export function FilterBar({
  status,
  onStatusChange,
  radiusKm,
  onRadiusChange,
  ownership,
  onOwnershipChange,
  sort,
  onSortChange,
  summary,
  className,
}: Props) {
  const free = statusStyle('free')
  const conditional = statusStyle('conditional')

  return (
    <div className={cn('flex items-center gap-1.5 overflow-x-auto no-scrollbar', className)} role="toolbar" aria-label="결과 필터">
      <button
        type="button"
        data-testid="filter-all"
        aria-pressed={status === 'all'}
        onClick={() => onStatusChange('all')}
        className={cn(
          'tap shrink-0 rounded-full px-3 py-1.5 text-[12px] font-bold transition-all',
          status === 'all'
            ? 'bg-ink text-[rgb(var(--pz-surface))] shadow-[0_6px_16px_-8px_rgba(15,23,42,0.9)]'
            : 'bg-ink/[0.05] text-ink-soft hover:bg-ink/[0.09]',
        )}
      >
        전체 <span className="tnum ml-0.5 opacity-70">{summary.total}</span>
      </button>

      <button
        type="button"
        data-testid="filter-free"
        aria-pressed={status === 'free'}
        onClick={() => onStatusChange(status === 'free' ? 'all' : 'free')}
        className={cn(
          'tap flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold transition-all',
          status === 'free' ? free.chipActive : 'bg-free-500/10 text-free-700 hover:bg-free-500/16 dark:text-free-300',
        )}
      >
        <span className={cn('h-1.5 w-1.5 rounded-full', status === 'free' ? 'bg-white' : 'bg-free-500')} />
        0원만 <span className="tnum opacity-80">{summary.free}</span>
      </button>

      <button
        type="button"
        data-testid="filter-conditional"
        aria-pressed={status === 'freeish'}
        onClick={() => onStatusChange(status === 'freeish' ? 'all' : 'freeish')}
        className={cn(
          'tap flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold transition-all',
          status === 'freeish'
            ? conditional.chipActive
            : 'bg-conditional-500/10 text-conditional-700 hover:bg-conditional-500/16 dark:text-conditional-300',
        )}
      >
        <span className={cn('h-1.5 w-1.5 rounded-full', status === 'freeish' ? 'bg-white' : 'bg-conditional-500')} />
        조건부 포함 <span className="tnum opacity-80">{summary.free + summary.conditional}</span>
      </button>

      <span className="mx-0.5 h-5 w-px shrink-0 bg-hairline" aria-hidden />

      <SelectChip
        testId="filter-radius"
        icon={<Ruler className="h-3.5 w-3.5" strokeWidth={2.4} />}
        value={String(radiusKm)}
        onChange={(v) => onRadiusChange(Number(v))}
        options={RADIUS_OPTIONS.map((km) => ({ value: String(km), label: km + 'km' }))}
        label="반경"
      />

      <SelectChip
        testId="filter-ownership"
        icon={<Building2 className="h-3.5 w-3.5" strokeWidth={2.4} />}
        value={ownership}
        onChange={(v) => onOwnershipChange(v as OwnershipFilter)}
        options={(Object.keys(OWNERSHIP_LABEL) as OwnershipFilter[]).map((k) => ({
          value: k,
          label: OWNERSHIP_LABEL[k],
        }))}
        label="운영주체"
      />

      <SelectChip
        testId="filter-sort"
        icon={<ArrowUpDown className="h-3.5 w-3.5" strokeWidth={2.4} />}
        value={sort}
        onChange={(v) => onSortChange(v as SortKey)}
        options={(Object.keys(SORT_LABEL) as SortKey[]).map((k) => ({ value: k, label: SORT_LABEL[k] }))}
        label="정렬"
      />
    </div>
  )
}

interface SelectChipProps {
  testId: string
  icon: React.ReactNode
  value: string
  label: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}

/** 네이티브 select 를 칩 모양으로 감싼 것 — 모바일에서 OS 피커가 뜨고, 접근성도 공짜로 얻는다. */
function SelectChip({ testId, icon, value, label, options, onChange }: SelectChipProps) {
  return (
    <label className="tap relative flex shrink-0 items-center gap-1.5 rounded-full bg-ink/[0.05] py-1.5 pl-2.5 pr-2 text-[12px] font-bold text-ink-soft transition-colors hover:bg-ink/[0.09]">
      <span className="text-ink-mute">{icon}</span>
      <span className="sr-only">{label}</span>
      <select
        data-testid={testId}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer appearance-none bg-transparent pr-1 font-bold text-ink-soft focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
