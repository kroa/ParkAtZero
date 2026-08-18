import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Layers } from 'lucide-react'
import { cn } from '@/lib/cn'
import { project, type LatLng } from '@/lib/geo'
import { markerInnerHtml, type MarkerModel } from './mapMarker'
import type { MapPadding } from './MapView'

interface Props {
  markers: MarkerModel[]
  selectedId: string | null
  onSelect: (id: string) => void
  center: LatLng
  zoom: number
  padding?: MapPadding
  userPosition: LatLng | null
  className?: string
}

const TILE_SIZE = 256

/**
 * WebGL 을 못 쓰는 환경(구형 브라우저, GPU 비활성 CI 러너, 기업 정책)에서 쓰는 간이 지도.
 *
 * 배경 타일은 없지만 Web Mercator 투영으로 마커의 상대 위치를 정확히 그리므로
 * "어디가 가깝고 어디가 먼지"는 그대로 읽힌다. 마커 마크업/셀렉터는 실제 지도와 100% 동일하다.
 */
export function MapFallback({
  markers,
  selectedId,
  onSelect,
  center,
  zoom,
  padding,
  userPosition,
  className,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const toPixel = useMemo(() => {
    const worldSize = TILE_SIZE * Math.pow(2, zoom)
    const centerPx = project(center)
    // 가려진 영역만큼 중심을 밀어, 실제 보이는 영역의 한가운데에 center 가 오게 한다.
    const anchorX = (size.width + (padding?.left ?? 0) - (padding?.right ?? 0)) / 2
    const anchorY = (size.height + (padding?.top ?? 0) - (padding?.bottom ?? 0)) / 2
    return (p: LatLng) => {
      const point = project(p)
      return {
        x: (point.x - centerPx.x) * worldSize + anchorX,
        y: (point.y - centerPx.y) * worldSize + anchorY,
      }
    }
  }, [center, zoom, size.width, size.height, padding])

  return (
    <div
      ref={ref}
      data-testid="map"
      data-map-mode="fallback"
      className={cn('relative h-full w-full overflow-hidden bg-[rgb(var(--pz-surface-sunken))]', className)}
    >
      {/* 격자 + 은은한 비네팅 — 빈 회색판처럼 보이지 않도록 */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.55] dark:opacity-40"
        style={{
          backgroundImage:
            'linear-gradient(rgb(var(--pz-hairline)) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--pz-hairline)) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 40%, transparent 40%, rgb(var(--pz-page) / 0.55) 100%)',
        }}
      />

      {size.width > 0 &&
        markers.map((m) => {
          const pos = toPixel(m)
          if (pos.x < -80 || pos.y < -80 || pos.x > size.width + 80 || pos.y > size.height + 80) return null
          const selected = selectedId === m.id
          return (
            <motion.button
              key={m.id}
              type="button"
              data-testid="map-marker"
              data-parking-id={m.id}
              data-status={m.status}
              data-selected={selected ? 'true' : 'false'}
              aria-label={m.name + ' — ' + m.label}
              onClick={() => onSelect(m.id)}
              initial={false}
              animate={{ x: pos.x, y: pos.y }}
              transition={{ type: 'spring', stiffness: 260, damping: 30 }}
              className="pz-marker absolute left-0 top-0"
              style={{ translateX: '-50%', translateY: '-100%', zIndex: selected ? 20 : 1 }}
              dangerouslySetInnerHTML={{ __html: markerInnerHtml(m, selected) }}
            />
          )
        })}

      {userPosition && size.width > 0 && (
        <span
          data-testid="user-dot"
          className="absolute z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-brand-500 shadow-[0_0_0_6px_rgba(50,139,255,0.22)]"
          style={{ left: toPixel(userPosition).x, top: toPixel(userPosition).y }}
        />
      )}

      <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-surface/70 px-2.5 py-1 text-[10px] font-semibold text-ink-mute backdrop-blur">
        <Layers className="h-3 w-3" strokeWidth={2.4} />
        간이 지도 모드
      </div>
    </div>
  )
}
