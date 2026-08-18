import { cn } from '@/lib/cn'

/** 좌상단 브랜드 마크. 로고는 인라인 SVG 라 네트워크 요청이 없다. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-free-400 to-free-600 shadow-[0_6px_16px_-6px_rgba(5,150,105,0.9)]">
        <svg viewBox="0 0 64 64" className="h-6 w-6" aria-hidden>
          <path
            d="M23 46V18h11.4c6.6 0 10.6 3.6 10.6 9.6 0 6-4 9.7-10.7 9.7H30V46h-7Zm7-14.3h3.6c2.8 0 4.4-1.5 4.4-4.1 0-2.6-1.6-4-4.4-4H30v8.1Z"
            fill="#fff"
          />
        </svg>
      </span>
      <span className="leading-none">
        <span className="block text-[15px] font-extrabold tracking-[-0.02em] text-ink">ParkAtZero</span>
        <span className="mt-0.5 block text-[11px] font-semibold text-ink-mute">0원 주차 찾기</span>
      </span>
    </div>
  )
}
