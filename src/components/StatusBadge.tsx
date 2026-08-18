import { CircleSlash2, Clock3, CircleDollarSign, HelpCircle, Sparkles } from 'lucide-react'
import type { ParkingStatus } from '@/types/parking'
import { cn } from '@/lib/cn'
import { statusStyle } from '@/lib/statusStyle'

const ICON: Record<ParkingStatus, typeof Sparkles> = {
  free: Sparkles,
  conditional: Clock3,
  paid: CircleDollarSign,
  closed: CircleSlash2,
  unknown: HelpCircle,
}

interface Props {
  status: ParkingStatus
  /** 뱃지에 표시할 문구. 없으면 상태 기본 라벨 */
  label?: string
  size?: 'sm' | 'md'
  className?: string
}

export function StatusBadge({ status, label, size = 'sm', className }: Props) {
  const style = statusStyle(status)
  const Icon = ICON[status]

  return (
    <span
      data-testid="status-badge"
      data-status={status}
      className={cn(
        'pz-chip',
        style.badge,
        size === 'md' && 'px-3 py-1.5 text-xs',
        className,
      )}
    >
      <Icon className={cn('shrink-0', size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3')} strokeWidth={2.4} />
      {label ?? style.label}
    </span>
  )
}
