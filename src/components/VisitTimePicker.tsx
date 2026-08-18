import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { CalendarDays, Clock, Timer } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  addMinutes,
  fromInputs,
  relativeDayLabel,
  snapToFiveMinutes,
  toDateInputValue,
  toTimeInputValue,
} from '@/lib/format'
import { DAY_TYPE_LABEL } from '@/lib/freeCalc'
import { getDayType } from '@/lib/timeRules'

export const DURATION_OPTIONS = [
  { minutes: 30, label: '30분' },
  { minutes: 60, label: '1시간' },
  { minutes: 120, label: '2시간' },
  { minutes: 180, label: '3시간' },
  { minutes: 360, label: '6시간' },
  { minutes: 720, label: '종일' },
] as const

interface Props {
  visitStart: Date
  durationMin: number
  onVisitChange: (next: Date) => void
  onDurationChange: (minutes: number) => void
  className?: string
}

interface QuickChip {
  label: string
  compute: (now: Date) => Date
}

const QUICK_CHIPS: QuickChip[] = [
  { label: '지금', compute: (now) => snapToFiveMinutes(now) },
  { label: '1시간 뒤', compute: (now) => snapToFiveMinutes(addMinutes(now, 60)) },
  {
    label: '오늘 저녁 7시',
    compute: (now) => {
      const d = new Date(now)
      d.setHours(19, 0, 0, 0)
      return d
    },
  },
  {
    label: '내일 오전 9시',
    compute: (now) => {
      const d = new Date(now)
      d.setDate(d.getDate() + 1)
      d.setHours(9, 0, 0, 0)
      return d
    },
  },
]

/**
 * 방문 시각 + 예상 주차 시간 선택기.
 *
 * 이 앱의 판정은 '언제, 얼마나' 두 값에 전적으로 달려 있어서 두 컨트롤을 한 판 안에 붙여 놓았다.
 * 날짜/시간은 네이티브 input 을 쓴다 — 모바일에서 OS 기본 피커가 뜨는 게 커스텀 휠보다 훨씬 빠르고 정확하다.
 */
export function VisitTimePicker({ visitStart, durationMin, onVisitChange, onDurationChange, className }: Props) {
  const dateValue = toDateInputValue(visitStart)
  const timeValue = toTimeInputValue(visitStart)

  const dayBadge = useMemo(() => {
    const rel = relativeDayLabel(visitStart)
    const dayType = DAY_TYPE_LABEL[getDayType(visitStart)]
    return rel ? rel + ' · ' + dayType : dayType
  }, [visitStart])

  return (
    <section className={cn('glass glass-shine relative rounded-2xl p-3', className)} aria-label="방문 시간 선택">
      <div className="flex items-center gap-2">
        <label className="group flex h-11 flex-1 items-center gap-2 rounded-xl bg-ink/[0.04] px-3 transition-colors focus-within:bg-brand-500/10 dark:bg-white/[0.05]">
          <CalendarDays className="h-4 w-4 shrink-0 text-ink-mute group-focus-within:text-brand-500" strokeWidth={2.4} />
          <span className="sr-only">방문 날짜</span>
          <input
            data-testid="date-input"
            type="date"
            value={dateValue}
            onChange={(e) => onVisitChange(fromInputs(e.target.value, timeValue, visitStart))}
            className="tnum w-full min-w-0 bg-transparent text-[14px] font-semibold text-ink focus:outline-none"
          />
        </label>

        <label className="group flex h-11 w-[152px] items-center gap-2 rounded-xl bg-ink/[0.04] px-3 transition-colors focus-within:bg-brand-500/10 dark:bg-white/[0.05]">
          <Clock className="h-4 w-4 shrink-0 text-ink-mute group-focus-within:text-brand-500" strokeWidth={2.4} />
          <span className="sr-only">방문 시각</span>
          <input
            data-testid="time-input"
            type="time"
            step={300}
            value={timeValue}
            onChange={(e) => onVisitChange(fromInputs(dateValue, e.target.value, visitStart))}
            className="tnum w-full min-w-0 bg-transparent text-[14px] font-semibold text-ink focus:outline-none"
          />
        </label>
      </div>

      <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        <span
          data-testid="daytype-badge"
          className="pz-chip shrink-0 bg-brand-500/12 text-brand-600 dark:text-brand-300"
        >
          {dayBadge}
        </span>
        {QUICK_CHIPS.map((chip) => (
          <button
            key={chip.label}
            type="button"
            data-testid={'quick-' + chip.label}
            onClick={() => onVisitChange(chip.compute(new Date()))}
            className="tap shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold text-ink-soft transition-colors hover:bg-ink/[0.06] hover:text-ink"
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="mt-3 border-t border-hairline/60 pt-3">
        <div className="mb-2 flex items-center gap-1.5">
          <Timer className="h-3.5 w-3.5 text-ink-mute" strokeWidth={2.4} />
          <span className="text-[12px] font-semibold text-ink-soft">얼마나 주차하세요?</span>
        </div>

        <div
          role="radiogroup"
          aria-label="예상 주차 시간"
          className="relative grid grid-cols-6 gap-1 rounded-xl bg-ink/[0.04] p-1 dark:bg-white/[0.05]"
        >
          {DURATION_OPTIONS.map((opt) => {
            const selected = opt.minutes === durationMin
            return (
              <button
                key={opt.minutes}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={'duration-' + opt.minutes}
                onClick={() => onDurationChange(opt.minutes)}
                className={cn(
                  'relative rounded-lg py-1.5 text-[12px] font-semibold transition-colors',
                  selected ? 'text-white' : 'text-ink-soft hover:text-ink',
                )}
              >
                {selected && (
                  <motion.span
                    layoutId="duration-pill"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    className="absolute inset-0 -z-10 rounded-lg bg-brand-500 shadow-[0_4px_12px_-4px_rgba(50,139,255,0.9)]"
                  />
                )}
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
