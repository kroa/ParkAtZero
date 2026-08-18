import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { CONFIG } from '@/lib/env'

interface Props {
  /** Ezoic 대시보드에서 발급받은 placeholder id */
  placeholderId: number
  /** 광고가 들어갈 자리의 예약 높이(px). CLS 방지의 핵심. */
  minHeight?: number
  label?: string
  className?: string
}

declare global {
  interface Window {
    ezstandalone?: {
      cmd: Array<() => void>
      showAds: (...ids: number[]) => void
    }
  }
}

/**
 * Ezoic 광고 슬롯.
 *
 * 설계 원칙
 *  1. 항상 자리를 먼저 잡는다 — 광고가 늦게 로드돼도 목록이 밀리지 않는다(CLS = 0).
 *  2. 로드 전에는 스켈레톤을 보여줘 '빈 회색 박스'가 UI 를 해치지 않게 한다.
 *  3. VITE_ADS_ENABLED 가 false 거나 E2E 실행 중이면 스크립트를 아예 붙이지 않는다.
 *     → Playwright 는 외부 네트워크 없이도 항상 같은 레이아웃을 본다.
 */
export function AdSlot({ placeholderId, minHeight = 100, label = 'AD', className }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [filled, setFilled] = useState(false)
  const active = CONFIG.adsEnabled && !CONFIG.e2e

  useEffect(() => {
    if (!active || !ref.current) return

    const el = ref.current
    // 광고는 화면에 들어올 때 요청한다 — 초기 로딩 1초 예산을 지키기 위해.
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        observer.disconnect()
        window.ezstandalone = window.ezstandalone || { cmd: [], showAds: () => {} }
        window.ezstandalone.cmd.push(() => {
          window.ezstandalone?.showAds(placeholderId)
          setFilled(true)
        })
      },
      { rootMargin: '200px' },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [active, placeholderId])

  return (
    <div
      data-testid="ad-slot"
      data-ad-active={active ? 'true' : 'false'}
      className={cn('relative w-full overflow-hidden rounded-2xl', className)}
      style={{ minHeight }}
      aria-label="광고 영역"
    >
      {/* 실제 Ezoic 주입 지점 */}
      <div id={'ezoic-pub-ad-placeholder-' + placeholderId} ref={ref} className="h-full w-full" />

      {(!active || !filled) && (
        <div
          data-testid="ad-skeleton"
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-hairline/70 bg-surface-sunken/40"
        >
          <div className="pz-skeleton h-2.5 w-24" />
          <div className="pz-skeleton h-2.5 w-16" />
          <span className="text-[10px] font-semibold tracking-[0.2em] text-ink-mute/70">{label}</span>
        </div>
      )}
    </div>
  )
}
