import { cn } from '@/lib/cn'

interface Props {
  className?: string
}

/** 첫 로딩 동안 카드 리스트의 골격을 미리 잡아 레이아웃 점프를 없앤다. */
export function SkeletonCard({ className }: Props) {
  return (
    <div
      data-testid="skeleton-card"
      className={cn(
        'relative overflow-hidden rounded-2xl border border-hairline/60 bg-surface-raised/70 p-4',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="pz-skeleton h-10 w-10 shrink-0 rounded-xl" />
        <div className="flex-1 space-y-2.5">
          <div className="pz-skeleton h-3.5 w-2/5" />
          <div className="pz-skeleton h-3 w-4/5" />
          <div className="flex gap-2 pt-1">
            <div className="pz-skeleton h-5 w-16 rounded-full" />
            <div className="pz-skeleton h-5 w-12 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2.5" aria-busy="true" aria-live="polite">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
      <span className="sr-only">주차장 정보를 불러오는 중입니다</span>
    </div>
  )
}
