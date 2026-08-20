import { useEffect, useRef, useState } from 'react'
import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl'
import { cn } from '@/lib/cn'
import { CONFIG } from '@/lib/env'
import { whenIdle } from '@/lib/idle'
import type { LatLng } from '@/lib/geo'
import { MapFallback } from './MapFallback'
import { createMarkerElement, updateMarkerElement, type MarkerModel } from './mapMarker'

/** 사이드바·바텀 시트에 가려지는 영역(px). 지도가 '보이는 영역'의 한가운데를 잡도록 해 준다. */
export interface MapPadding {
  top?: number
  bottom?: number
  left?: number
  right?: number
}

interface Props {
  markers: MarkerModel[]
  selectedId: string | null
  onSelect: (id: string) => void
  onBackgroundClick?: () => void
  /** 사용자가 지도를 움직였을 때 현재 중심을 알린다(마커를 화면 기준으로 고르기 위함). */
  onViewChange?: (center: LatLng) => void
  /** 지도 엔진이 실제 지도든 간이 지도든 자리를 잡았을 때 한 번 알린다. */
  onSettled?: () => void
  center: LatLng
  zoom: number
  /** 값이 바뀔 때마다 center/zoom 으로 부드럽게 이동한다(같은 좌표 재선택도 동작하게 하는 토큰) */
  flyToken: number
  padding?: MapPadding
  isDark: boolean
  userPosition: LatLng | null
  className?: string
}

/** WebGL 가용성 확인 — 없으면 maplibre 를 아예 로드하지 않는다(번들 낭비 방지). */
function hasWebGL(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

function clampPadding(padding: MapPadding | undefined, container: HTMLElement) {
  const maxX = Math.max(0, container.clientWidth / 2 - 40)
  const maxY = Math.max(0, container.clientHeight / 2 - 40)
  return {
    top: Math.min(padding?.top ?? 0, maxY),
    bottom: Math.min(padding?.bottom ?? 0, maxY),
    left: Math.min(padding?.left ?? 0, maxX),
    right: Math.min(padding?.right ?? 0, maxX),
  }
}

/** 래스터 한 겹만 쓰는 최소 스타일. style.json 을 원격에서 받지 않아 초기 로딩이 빠르고 테스트도 안정적이다. */
function buildStyle(isDark: boolean) {
  return {
    version: 8 as const,
    sources: {
      base: {
        type: 'raster' as const,
        tiles: [isDark ? CONFIG.tileDark : CONFIG.tileLight],
        tileSize: 256,
        attribution: CONFIG.tileAttribution,
      },
    },
    layers: [
      {
        id: 'bg',
        type: 'background' as const,
        paint: { 'background-color': isDark ? '#0b0f14' : '#eef1f5' },
      },
      {
        id: 'base',
        type: 'raster' as const,
        source: 'base',
        paint: { 'raster-fade-duration': 220 },
      },
    ],
  }
}

export function MapView({
  markers,
  selectedId,
  onSelect,
  onBackgroundClick,
  onViewChange,
  onSettled,
  center,
  zoom,
  flyToken,
  padding,
  isDark,
  userPosition,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markerRefs = useRef(new Map<string, { marker: MapLibreMarker; el: HTMLElement }>())
  const markerCtorRef = useRef<typeof MapLibreMarker | null>(null)
  const userMarkerRef = useRef<MapLibreMarker | null>(null)
  const selectRef = useRef(onSelect)
  const viewChangeRef = useRef(onViewChange)
  const [mode, setMode] = useState<'probing' | 'gl' | 'fallback'>('probing')
  const settledRef = useRef(onSettled)
  settledRef.current = onSettled

  // 지도가 자리를 잡은 뒤에야 무거운 스냅샷을 읽어도 안전하다.
  useEffect(() => {
    if (mode !== 'probing') settledRef.current?.()
  }, [mode])

  selectRef.current = onSelect
  viewChangeRef.current = onViewChange

  // ── 지도 초기화 (한 번만) ─────────────────────────────
  useEffect(() => {
    if (!hasWebGL()) {
      setMode('fallback')
      return
    }

    let disposed = false
    // cleanup 시점에 ref 접근을 피하기 위해 지금 실체를 잡아둔다(exhaustive-deps 권고).
    const liveMarkers = markerRefs.current

    void (async () => {
      try {
        /*
         * 지도 엔진은 목록이 그려진 뒤에 올린다.
         *
         * maplibre 청크는 213KB 이고, 저사양 단말에서 이걸 파싱하고 WebGL 컨텍스트를
         * 만드는 데만 1초 넘게 메인 스레드를 잡는다(실측: 첫 카드 2.8초 → 차단 시 1.8초).
         * 지도는 목록보다 조금 늦게 떠도 되지만, 목록이 1초 늦게 뜨는 건 체감이 다르다.
         */
        await whenIdle(1500)
        if (disposed) return

        const [{ Map, Marker, NavigationControl }] = await Promise.all([
          import('maplibre-gl'),
          import('maplibre-gl/dist/maplibre-gl.css'),
        ])
        if (disposed || !containerRef.current) return

        const map = new Map({
          container: containerRef.current,
          style: buildStyle(isDark),
          center: [center.lng, center.lat],
          zoom,
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
          maxZoom: 19,
          minZoom: 5,
        })

        map.touchZoomRotate.disableRotation()
        map.addControl(new NavigationControl({ showCompass: false, visualizePitch: false }), 'bottom-right')
        map.on('click', () => onBackgroundClick?.())
        // 팬·줌이 끝날 때만 알린다. 이동 중 매 프레임 알리면 목록까지 다시 계산된다.
        map.on('moveend', () => {
          const c = map.getCenter()
          viewChangeRef.current?.({ lat: c.lat, lng: c.lng })
        })

        mapRef.current = map
        markerCtorRef.current = Marker

        /*
         * Map 생성이 성공한 시점에 이미 지도를 쓸 수 있다 — 마커는 DOM 오버레이라
         * 타일과 무관하고, flyTo 도 동작한다.
         *
         * 여기서 load 이벤트를 기다리면 안 된다. MapLibre 의 load 는 첫 타일이 그려질
         * 때까지 발생하지 않아서, 오프라인이거나 타일 도메인이 막힌 환경에서는 영영 오지
         * 않는다. 그러면 멀쩡한 지도를 두고 몇십 초 뒤 간이 지도로 내려앉는다.
         */
        if (!disposed) setMode('gl')

        // WebGL 컨텍스트를 잃으면 지도는 되살아나지 못한다. 그때만 간이 지도로 내려간다.
        map.on('webglcontextlost', () => {
          if (disposed) return
          console.warn('[ParkAtZero] WebGL 컨텍스트를 잃어 간이 지도로 전환합니다.')
          markerCtorRef.current = null
          mapRef.current = null
          setMode('fallback')
        })
      } catch (err) {
        console.warn('[ParkAtZero] 지도 엔진 로드 실패 — 간이 지도로 전환합니다.', err)
        if (!disposed) setMode('fallback')
      }
    })()

    return () => {
      disposed = true
      liveMarkers.forEach(({ marker }) => marker.remove())
      liveMarkers.clear()
      userMarkerRef.current?.remove()
      userMarkerRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
    }
    // 최초 1회만 실행 — center/zoom 변화는 아래 flyTo 이펙트가 담당한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 테마 변경 시 타일 교체 ────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || mode !== 'gl') return
    map.setStyle(buildStyle(isDark))
  }, [isDark, mode])

  // ── 마커 동기화 ───────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || mode !== 'gl') return

    const MarkerCtor = markerCtorRef.current
    if (!MarkerCtor) return

    const next = new Set(markers.map((m) => m.id))

    // 사라진 마커 제거
    markerRefs.current.forEach((entry, id) => {
      if (next.has(id)) return
      entry.marker.remove()
      markerRefs.current.delete(id)
    })

    for (const model of markers) {
      const selected = model.id === selectedId
      const existing = markerRefs.current.get(model.id)

      if (existing) {
        existing.marker.setLngLat([model.lng, model.lat])
        updateMarkerElement(existing.el, model, selected)
        continue
      }

      const el = createMarkerElement(model, selected, (id) => selectRef.current(id))
      const marker = new MarkerCtor({ element: el, anchor: 'bottom' })
        .setLngLat([model.lng, model.lat])
        .addTo(map)
      markerRefs.current.set(model.id, { marker, el })
    }
  }, [markers, selectedId, mode])

  // ── 내 위치 표시 ──────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || mode !== 'gl') return
    const MarkerCtor = markerCtorRef.current
    if (!MarkerCtor) return

    userMarkerRef.current?.remove()
    userMarkerRef.current = null
    if (!userPosition) return

    const el = document.createElement('div')
    el.setAttribute('data-testid', 'user-dot')
    el.className =
      'h-4 w-4 rounded-full border-[3px] border-white bg-brand-500 shadow-[0_0_0_6px_rgba(50,139,255,0.22)]'
    userMarkerRef.current = new MarkerCtor({ element: el }).setLngLat([userPosition.lng, userPosition.lat]).addTo(map)
  }, [userPosition, mode])

  // ── 카드 선택 / 검색 시 부드러운 이동 ─────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || mode !== 'gl') return
    map.flyTo({
      center: [center.lng, center.lat],
      zoom,
      // 여백이 컨테이너보다 크면 maplibre 가 계산을 포기하므로 안전하게 잘라 넘긴다.
      padding: clampPadding(padding, map.getContainer()),
      duration: CONFIG.e2e ? 0 : 900,
      essential: true,
      curve: 1.4,
    })
  }, [flyToken, center.lat, center.lng, zoom, padding, mode])

  if (mode === 'fallback') {
    return (
      <MapFallback
        markers={markers}
        selectedId={selectedId}
        onSelect={onSelect}
        center={center}
        zoom={zoom}
        padding={padding}
        userPosition={userPosition}
        className={className}
      />
    )
  }

  return (
    <div
      ref={containerRef}
      data-testid="map"
      data-map-mode={mode}
      // maplibre-gl.css 가 나중에 로드되며 .maplibregl-map { position: relative } 로 Tailwind 의
      // absolute 를 덮는다. 그 경우에도 높이가 0 이 되지 않도록 크기를 명시해 둔다.
      className={cn('relative h-full w-full bg-[rgb(var(--pz-surface-sunken))]', className)}
      aria-label="주차장 지도"
    />
  )
}
