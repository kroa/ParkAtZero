import { motion } from 'framer-motion'
import {
  CalendarClock,
  CircleParking,
  Info,
  MapPin,
  Phone,
  Receipt,
  TriangleAlert,
  Wallet,
  X,
} from 'lucide-react'
import type { OperRange } from '@/types/parking'
import type { ResultItem } from '@/lib/query'
import { cn } from '@/lib/cn'
import { formatDistance } from '@/lib/geo'
import { describeFee, formatMoney, DAY_TYPE_LABEL } from '@/lib/freeCalc'
import { formatMinuteOfDay, formatDurationShort } from '@/lib/timeRules'
import { statusStyle } from '@/lib/statusStyle'
import { StatusBadge } from './StatusBadge'
import { NaviButtons } from './NaviButtons'

interface Props {
  item: ResultItem
  /** 예시 데이터로 동작 중인지 — 출처 표기를 가르는 값 */
  isSample: boolean
  onClose: () => void
  className?: string
}

function rangeLabel(range: OperRange | null): string {
  if (!range) return '미운영'
  if (range.allDay) return '24시간'
  return formatMinuteOfDay(range.open) + ' ~ ' + formatMinuteOfDay(range.close)
}

export function DetailPanel({ item, isSample, onClose, className }: Props) {
  const { parking, evaluation, distanceKm } = item
  const style = statusStyle(evaluation.status)

  const costLabel =
    evaluation.cost === null ? '계산 불가' : evaluation.cost === 0 ? '0원' : formatMoney(evaluation.cost)

  return (
    <motion.section
      data-testid="detail-panel"
      data-parking-id={parking.id}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      className={cn('glass-strong glass-shine relative overflow-hidden rounded-3xl', className)}
      aria-label={parking.name + ' 상세 정보'}
    >
      <span className={cn('absolute inset-x-0 top-0 h-1', style.accent)} aria-hidden />

      <div className="flex items-start gap-3 px-5 pt-5">
        <div className="min-w-0 flex-1">
          <StatusBadge status={evaluation.status} size="md" />
          <h2 className="mt-2.5 text-[19px] font-extrabold leading-tight tracking-[-0.02em] text-ink">
            {parking.name}
          </h2>
          <p className="mt-1.5 flex items-start gap-1.5 text-[13px] leading-snug text-ink-soft">
            <MapPin className="mt-[2px] h-3.5 w-3.5 shrink-0 text-ink-mute" strokeWidth={2.4} />
            <span className="min-w-0">{parking.address}</span>
          </p>
        </div>

        <button
          type="button"
          data-testid="detail-close"
          onClick={onClose}
          aria-label="상세 닫기"
          className="tap flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-ink-soft transition-colors hover:bg-ink/[0.12] hover:text-ink"
        >
          <X className="h-4 w-4" strokeWidth={2.6} />
        </button>
      </div>

      {/* 핵심 결론 — 선택한 시간에 얼마인지 */}
      <div className="mx-5 mt-4 rounded-2xl bg-ink/[0.04] p-4 dark:bg-white/[0.04]">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11.5px] font-bold uppercase tracking-wider text-ink-mute">선택한 시간 예상 요금</p>
            <p
              data-testid="detail-cost"
              className={cn(
                'tnum mt-1 text-[30px] font-extrabold leading-none tracking-[-0.03em]',
                evaluation.cost === 0 ? 'text-free-600 dark:text-free-400' : 'text-ink',
              )}
            >
              {costLabel}
            </p>
          </div>
          <p className="shrink-0 text-right text-[12px] font-semibold text-ink-soft">
            {formatDurationShort(evaluation.totalMinutes)} 주차
            {evaluation.freeMinutes > 0 && (
              <span className="mt-0.5 block text-free-600 dark:text-free-400">
                무료 {formatDurationShort(evaluation.freeMinutes)}
              </span>
            )}
          </p>
        </div>

        {evaluation.reasons.length > 0 && (
          <ul data-testid="detail-reasons" className="mt-3 space-y-1.5 border-t border-hairline/70 pt-3">
            {evaluation.reasons.map((reason) => (
              <li key={reason} className="flex items-start gap-1.5 text-[12.5px] leading-snug text-ink-soft">
                <Info className="mt-[2px] h-3.5 w-3.5 shrink-0 text-ink-mute" strokeWidth={2.4} />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 1-Tap 길안내 */}
      <div className="px-5 pt-4">
        <p className="mb-2 text-[11.5px] font-bold uppercase tracking-wider text-ink-mute">길안내</p>
        <NaviButtons target={{ name: parking.name, lat: parking.lat, lng: parking.lng }} />
      </div>

      <div className="space-y-3 px-5 pb-5 pt-4">
        <InfoRow
          icon={<CalendarClock className="h-4 w-4" strokeWidth={2.4} />}
          label="운영시간"
          value={
            <span className="tnum grid gap-0.5">
              {(['weekday', 'saturday', 'holiday'] as const).map((k) => (
                <span key={k} className="flex gap-2">
                  <span className="w-10 shrink-0 text-ink-mute">{DAY_TYPE_LABEL[k]}</span>
                  <span className={cn(evaluation.dayType === k && 'font-bold text-ink')}>
                    {rangeLabel(parking.hours[k])}
                  </span>
                </span>
              ))}
            </span>
          }
        />

        <InfoRow
          icon={<Receipt className="h-4 w-4" strokeWidth={2.4} />}
          label="요금 체계"
          value={<span className="tnum">{describeFee(parking)}</span>}
        />

        <InfoRow
          icon={<CircleParking className="h-4 w-4" strokeWidth={2.4} />}
          label="규모 · 거리"
          value={
            <span className="tnum">
              {parking.capacity > 0 ? parking.capacity + '면' : '규모 미상'} · {formatDistance(distanceKm)}
              {parking.managedBy ? ' · ' + parking.managedBy : ''}
            </span>
          }
        />

        {parking.payment && (
          <InfoRow
            icon={<Wallet className="h-4 w-4" strokeWidth={2.4} />}
            label="결제수단"
            value={parking.payment}
          />
        )}

        {parking.tel && (
          <InfoRow
            icon={<Phone className="h-4 w-4" strokeWidth={2.4} />}
            label="전화"
            value={
              <a href={'tel:' + parking.tel} className="tnum font-semibold text-brand-600 dark:text-brand-300">
                {parking.tel}
              </a>
            }
          />
        )}

        {parking.note && (
          <InfoRow
            icon={<Info className="h-4 w-4" strokeWidth={2.4} />}
            label="특기사항"
            value={<span className="leading-relaxed">{parking.note}</span>}
          />
        )}

        {isSample ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-conditional-500/10 px-2.5 py-2 text-[11.5px] leading-snug text-conditional-700 dark:text-conditional-300">
            <TriangleAlert className="mt-[1px] h-3.5 w-3.5 shrink-0" strokeWidth={2.4} />
            <span>
              <b>예시 데이터입니다.</b> 요금·운영시간은 기능 시연용으로 가공한 값이며 실제와 다릅니다.
              공공데이터포털 인증키를 연결하면 실제 데이터로 바뀝니다.
            </span>
          </p>
        ) : (
          <p className="pt-1 text-[11px] leading-relaxed text-ink-mute">
            {parking.updatedAt ? '데이터 기준일 ' + parking.updatedAt + ' · ' : ''}
            출처: 행정안전부 전국주차장정보표준데이터 (공공누리 제1유형)
          </p>
        )}
      </div>
    </motion.section>
  )
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-[1px] flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink/[0.05] text-ink-mute">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] font-bold text-ink-mute">{label}</p>
        <div className="mt-0.5 text-[13px] font-medium text-ink-soft">{value}</div>
      </div>
    </div>
  )
}
