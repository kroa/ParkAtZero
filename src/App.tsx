import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, RefreshCw, SlidersHorizontal, TriangleAlert } from 'lucide-react'
import { SearchBar, type SearchTarget } from '@/components/SearchBar'
import { VisitTimePicker } from '@/components/VisitTimePicker'
import { FilterBar } from '@/components/FilterBar'
import { ParkingList } from '@/components/ParkingList'
import { DetailPanel } from '@/components/DetailPanel'
import { MapView, type MapPadding } from '@/components/MapView'
import { BottomSheet, type Snap } from '@/components/BottomSheet'
import { ThemeToggle } from '@/components/ThemeToggle'
import { AdSlot } from '@/components/AdSlot'
import { BrandMark } from '@/components/BrandMark'
import { isMinorMarker, markerLabel, type MarkerModel } from '@/components/mapMarker'
import { SearchHereButton } from '@/components/SearchHereButton'
import { useTheme } from '@/hooks/useTheme'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { useDebounced } from '@/hooks/useDebounced'
import { useGeolocation } from '@/hooks/useGeolocation'
import { useParkingData } from '@/hooks/useParkingData'
import {
  buildResults,
  filterByStatus,
  summarize,
  type OwnershipFilter,
  type QueryState,
  type ResultItem,
  type SortKey,
  type StatusFilter,
  type VehicleFilter,
  ymd,
} from '@/lib/query'
import { haversineKm, SEOUL_CITY_HALL, type LatLng } from '@/lib/geo'
import { formatVisitLabel, snapToFiveMinutes } from '@/lib/format'
import { formatDurationShort } from '@/lib/timeRules'
import { CONFIG } from '@/lib/env'
import { cn } from '@/lib/cn'

/** 지도에 한 번에 올리는 마커 상한 — 그 이상은 시각적으로도 의미가 없고 프레임만 잡아먹는다. */
const MAX_MARKERS = 200
/* 그중 점(요금 미공개·운영 종료)에 남겨 두는 자리. 답이 아니어도 있다는 사실은 보여야 한다. */
const MAX_DOT_MARKERS = 60

/** 데스크톱 사이드바 / 상세 패널 폭 — 지도 여백 계산에 쓴다. */
const SIDEBAR_WIDTH = 428
const DETAIL_WIDTH = 392

export default function App() {
  const { isDark, toggle } = useTheme()
  const isDesktop = useIsDesktop()
  const [origin, setOrigin] = useState<LatLng>(SEOUL_CITY_HALL)
  const [radiusKm, setRadiusKm] = useState(10)

  const [visitStart, setVisitStart] = useState(() => snapToFiveMinutes(new Date()))
  const [durationMin, setDurationMin] = useState(120)

  /*
   * 데이터는 기준점 주변 격자 칸만 받는다.
   * 전국 스냅샷을 통째로 읽으면 저사양 단말에서 파싱만 2초가 걸리고, 그동안 사용자는
   * 예시(가짜) 데이터를 보고 있어야 했다.
   *
   * 방문 날짜도 넘긴다 — 설·추석 연휴에만 여는 주차장은 그날에만 따로 받는다.
   */
  const [keyword, setKeyword] = useState('')
  const debouncedKeyword = useDebounced(keyword, 160)

  const { parkings, loading, refreshing, source, totalCount, referenceDate } = useParkingData(
    origin,
    radiusKm,
    ymd(visitStart),
    debouncedKeyword,
  )
  const isSample = source !== 'remote'
  const geo = useGeolocation()

  /**
   * origin  : 거리·반경의 기준점. 검색과 '내 위치'로만 움직인다.
   * mapView : 지도가 실제로 보고 있는 위치. 카드를 고르면 여기만 움직인다.
   *
   * 둘을 하나로 합치면 카드를 누를 때마다 기준점이 그 주차장으로 옮겨가
   * 모든 거리가 0m 이 되고 반경 안에 드는 목록까지 통째로 바뀐다.
   */
  const [mapView, setMapView] = useState({ center: SEOUL_CITY_HALL, zoom: 14, token: 0 })
  /** 사용자가 실제로 보고 있는 지도 중심. 팬·줌으로도 바뀌며 마커 선택 기준이 된다. */
  const [viewCenter, setViewCenter] = useState<LatLng>(SEOUL_CITY_HALL)

  const [status, setStatus] = useState<StatusFilter>('all')
  const [ownership, setOwnership] = useState<OwnershipFilter>('all')
  /* 기본은 승용차. 관광버스·거주자우선 같은 전용 구획은 그 차를 고를 때만 보인다. */
  const [vehicle, setVehicle] = useState<VehicleFilter>('car')
  const [sort, setSort] = useState<SortKey>('smart')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [snap, setSnap] = useState<Snap>('half')
  const [timeOpen, setTimeOpen] = useState(false)

  const listRef = useRef<HTMLDivElement>(null)

  const query: QueryState = useMemo(
    () => ({
      keyword: debouncedKeyword,
      visitStart,
      durationMin,
      center: origin,
      radiusKm,
      status,
      ownership,
      vehicle,
      sort,
    }),
    [debouncedKeyword, visitStart, durationMin, origin, radiusKm, status, ownership, vehicle, sort],
  )

  /*
   * 상태 필터는 마지막에 따로 적용한다.
   * 필터칩의 숫자("0원만 42")는 필터를 적용하기 전 결과로 세야 의미가 있다.
   * 걸러진 결과로 세면 '0원만'을 켠 순간 전체 개수까지 그 값으로 바뀌어,
   * 마치 그 지역에 주차장이 몇 곳뿐인 것처럼 보인다.
   */
  const scored = useMemo(() => buildResults(parkings, query), [parkings, query])
  const summary = useMemo(() => summarize(scored), [scored])
  const results = useMemo(() => filterByStatus(scored, status), [scored, status])

  /*
   * 마커는 '지금 보고 있는 화면' 기준으로 고른다.
   *
   * 결과 순서(무료 우선 → 원점에서 가까운 순)의 앞에서부터 잘라내면, 지도를 다른 동네로
   * 옮겼을 때 그 일대 마커가 통째로 없다. 목록에는 384곳이라 떠 있는데 지도는 텅 비어
   * 마치 그 지역에 주차장이 없는 것처럼 보인다.
   */
  const markers: MarkerModel[] = useMemo(() => {
    /*
     * 라벨 마커와 점에 각각 몫을 준다.
     *
     * 답이 되는 마커(무료·조건부·금액을 아는 유료)를 앞세우는 것까지는 맞았는데,
     * 그것만으로 상한을 채우면 점이 하나도 안 그려진다. 실제로 서대문 일대에서
     * 라벨 마커 298개가 200칸을 다 차지해, 요금 미공개뿐인 홍제·홍은동 8곳이
     * 지도에서 통째로 사라졌다 — 그 동네에 주차장이 없는 것처럼 보인다.
     *
     * 라벨은 넉넉히 주되 점 자리를 남겨 둔다. '여기 주차장이 있긴 하다' 는
     * 사실은 요금을 몰라도 지도에서 지워지면 안 된다.
     */
    const byView = (a: ResultItem, b: ResultItem) =>
      haversineKm(viewCenter, a.parking) - haversineKm(viewCenter, b.parking)

    const isMinor = (it: ResultItem) => isMinorMarker(it.evaluation.status, it.evaluation.cost)

    let nearView: ResultItem[]
    if (results.length <= MAX_MARKERS) {
      nearView = results
    } else {
      const labelled = results.filter((it) => !isMinor(it)).sort(byView)
      const dots = results.filter(isMinor).sort(byView)
      // 점이 적으면 남는 자리는 라벨이 가져간다.
      const dotShare = Math.min(dots.length, MAX_DOT_MARKERS)
      nearView = [...labelled.slice(0, MAX_MARKERS - dotShare), ...dots.slice(0, dotShare)]
    }

    return nearView.map((item) => ({
      id: item.parking.id,
      name: item.parking.name,
      status: item.evaluation.status,
      label: markerLabel(item.evaluation.status, item.evaluation.cost),
      minor: isMinor(item),
      lat: item.parking.lat,
      lng: item.parking.lng,
    }))
  }, [results, viewCenter])

  const selectedItem = useMemo(
    () => results.find((r) => r.parking.id === selectedId) ?? null,
    [results, selectedId],
  )

  /*
   * 지도를 얼마나 옮겼나.
   *
   * 결과는 기준점 반경 안에서만 고르므로, 다른 동네로 지도를 밀면 마커가 하나도 없다.
   * 그럴 때 '이 지역에서 다시 찾기' 를 띄워 기준점을 옮길 기회를 준다.
   * 카드를 골라 지도가 움직인 경우에는 띄우지 않는다 — 상세를 보는 중에 다시 찾기를
   * 권하는 건 방해다.
   */
  const driftKm = useMemo(() => haversineKm(origin, viewCenter), [origin, viewCenter])
  const canSearchHere = !selectedItem && driftKm > Math.max(1, radiusKm * 0.3)

  const searchHere = useCallback(() => {
    setOrigin(viewCenter)
  }, [viewCenter])

  // 필터가 바뀌어 선택한 주차장이 목록에서 빠지면 선택도 함께 해제한다.
  useEffect(() => {
    if (selectedId && !selectedItem) setSelectedId(null)
  }, [selectedId, selectedItem])

  /**
   * 지도 여백 — 사이드바/바텀 시트에 가려지는 영역을 지도에 알려 준다.
   * 이게 없으면 카드를 골랐을 때 정작 그 마커가 패널 뒤로 들어가 버린다.
   */
  const mapPadding: MapPadding = useMemo(() => {
    if (isDesktop) {
      return { left: selectedItem ? SIDEBAR_WIDTH + DETAIL_WIDTH : SIDEBAR_WIDTH, top: 24, bottom: 24 }
    }
    const vh = typeof window === 'undefined' ? 800 : window.innerHeight
    return { top: 150, bottom: snap === 'peek' ? 188 : Math.round(vh * 0.54) }
  }, [isDesktop, selectedItem, snap])

  const moveMap = useCallback((center: LatLng, zoom?: number) => {
    setMapView((prev) => ({ center, zoom: zoom ?? prev.zoom, token: prev.token + 1 }))
    setViewCenter(center)
  }, [])

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedId(id)
      const hit = parkings.find((p) => p.id === id)
      // 기준점(origin)은 그대로 두고 지도만 움직인다 → 거리·반경이 흔들리지 않는다.
      if (hit) moveMap({ lat: hit.lat, lng: hit.lng }, Math.max(mapView.zoom, 16))
      if (!isDesktop) setSnap('half')

      // 지도 마커로 고른 경우에도 목록에서 해당 카드가 보이게 스크롤을 맞춘다.
      window.requestAnimationFrame(() => {
        listRef.current
          ?.querySelector('[data-parking-id="' + CSS.escape(id) + '"]')
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      })
    },
    [parkings, moveMap, mapView.zoom, isDesktop],
  )

  const handlePick = useCallback(
    (target: SearchTarget) => {
      moveMap(target.center, target.zoom)
      if (target.parkingId) {
        // 개별 주차장을 고른 것 — 기준점은 유지한다.
        setSelectedId(target.parkingId)
      } else {
        // 지역을 고른 것 — 여기서부터 거리를 다시 잰다.
        setOrigin(target.center)
        setSelectedId(null)
        /*
         * 검색어를 비운다. 지역 이동은 '거기로 가 보자'는 뜻이지 '이름에 그 글자가 든 곳만
         * 보자'는 뜻이 아니다. 남겨 두면 "연신내"를 눌렀을 때 이름에 연신내가 든 주차장만
         * 남아 그 동네에 주차장이 없는 것처럼 보인다.
         */
        setKeyword('')
      }
      if (!isDesktop) setSnap('half')
    },
    [moveMap, isDesktop],
  )

  const handleLocate = useCallback(async () => {
    const pos = await geo.locate()
    if (!pos) return
    setOrigin(pos)
    moveMap(pos, 15)
    setSelectedId(null)
  }, [geo, moveMap])

  const resetFilters = useCallback(() => {
    setStatus('all')
    setOwnership('all')
    setRadiusKm(20)
    setKeyword('')
  }, [])

  // Playwright 가 순수 판정 로직을 직접 검증할 수 있도록 훅을 노출한다(개발/E2E 빌드 전용).
  useEffect(() => {
    if (!import.meta.env.DEV && !CONFIG.e2e) return
    void import('@/lib/testBridge').then((m) => m.installTestBridge())
  }, [])

  const summaryLine = (
    <ResultSummaryLine
      total={summary.total}
      free={summary.free}
      conditional={summary.conditional}
      visitStart={visitStart}
      durationMin={durationMin}
      refreshing={refreshing}
    />
  )

  const filterBar = (
    <FilterBar
      status={status}
      onStatusChange={setStatus}
      radiusKm={radiusKm}
      onRadiusChange={setRadiusKm}
      ownership={ownership}
      onOwnershipChange={setOwnership}
      vehicle={vehicle}
      onVehicleChange={setVehicle}
      sort={sort}
      onSortChange={setSort}
      summary={summary}
    />
  )

  const sampleNotice = isSample ? (
    <div
      data-testid="sample-notice"
      className="flex items-start gap-2 rounded-xl bg-conditional-500/10 px-3 py-2 text-[11.5px] font-semibold leading-snug text-conditional-700 dark:text-conditional-300"
    >
      <TriangleAlert className="mt-[1px] h-3.5 w-3.5 shrink-0" strokeWidth={2.4} />
      <span>
        예시 데이터 {parkings.length}건으로 동작 중입니다 — 실제 공공데이터가 아닙니다.
      </span>
    </div>
  ) : null

  const list = (
    <div ref={listRef}>
      <ParkingList
        items={results}
        isSample={isSample}
        statusFilter={status}
        hasOtherStatuses={summary.total > results.length}
        onRelaxStatus={() => setStatus('all')}
        totalCount={totalCount}
        referenceDate={referenceDate}
        loading={loading}
        selectedId={selectedId}
        onSelect={handleSelect}
        onResetFilters={resetFilters}
      />
    </div>
  )

  return (
    <div className="relative h-full w-full overflow-hidden bg-[rgb(var(--pz-page))]">
      <MapView
        markers={markers}
        selectedId={selectedId}
        onSelect={handleSelect}
        onBackgroundClick={() => setSelectedId(null)}
        onViewChange={setViewCenter}
        center={mapView.center}
        zoom={mapView.zoom}
        flyToken={mapView.token}
        padding={mapPadding}
        isDark={isDark}
        userPosition={geo.position}
        className="absolute inset-0"
      />

      {/* 지도를 옮긴 만큼만 나타난다. 사이드바/시트에 가리지 않게 지도 영역 안에서 가운데. */}
      <div
        className="pointer-events-none absolute z-30 flex justify-center"
        style={{
          left: isDesktop ? SIDEBAR_WIDTH + 16 : 12,
          right: 12,
          top: isDesktop ? 24 : 150,
        }}
      >
        <SearchHereButton visible={canSearchHere} onClick={searchHere} />
      </div>

      {/* ── 데스크톱: 좌측 글래스 사이드바 ───────────────── */}
      {isDesktop ? (
        <>
          <aside
            data-testid="sidebar"
            className="glass glass-shine absolute inset-y-4 left-4 z-20 flex w-[404px] flex-col overflow-hidden rounded-3xl"
          >
            <header className="flex items-center justify-between gap-2 px-4 pt-4">
              <BrandMark />
              <ThemeToggle isDark={isDark} onToggle={toggle} />
            </header>

            <div className="space-y-2.5 px-4 pt-3">
              <SearchBar
                value={keyword}
                onChange={setKeyword}
                onPick={handlePick}
                onLocate={handleLocate}
                geoStatus={geo.status}
                parkings={parkings}
              />
              <VisitTimePicker
                visitStart={visitStart}
                durationMin={durationMin}
                onVisitChange={setVisitStart}
                onDurationChange={setDurationMin}
              />
            </div>

            <div className="px-4 pb-2 pt-3">{filterBar}</div>
            <div className="px-4 pb-2">{summaryLine}</div>
            {sampleNotice && <div className="px-4 pb-2">{sampleNotice}</div>}

            <div className="pz-scroll min-h-0 flex-1 overflow-y-auto">{list}</div>

            <div className="border-t border-hairline/60 px-3 py-3">
              <AdSlot placeholderId={CONFIG.ezoicIds.bottom} minHeight={90} />
            </div>
          </aside>

          <AnimatePresence>
            {selectedItem && (
              <motion.div
                key={selectedItem.parking.id}
                initial={{ opacity: 0, x: -24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ type: 'spring', stiffness: 340, damping: 34 }}
                className="pz-scroll absolute inset-y-4 left-[428px] z-20 w-[380px] overflow-y-auto"
              >
                <DetailPanel item={selectedItem} isSample={isSample} onClose={() => setSelectedId(null)} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* 지도 우하단 줌 컨트롤·저작권 표기 위로 띄운다 */}
          <Legend className="absolute bottom-28 right-4 z-10" referenceDate={referenceDate} />
        </>
      ) : (
        /* ── 모바일: 상단 플로팅 컨트롤 + 바텀 시트 ────── */
        <>
          <div className="safe-top pointer-events-none absolute inset-x-0 top-0 z-20 px-3 pt-3">
            <div className="pointer-events-auto flex items-center gap-2">
              <SearchBar
                value={keyword}
                onChange={setKeyword}
                onPick={handlePick}
                onLocate={handleLocate}
                geoStatus={geo.status}
                parkings={parkings}
                className="min-w-0 flex-1"
              />
              <ThemeToggle isDark={isDark} onToggle={toggle} />
            </div>

            <div className="pointer-events-auto mt-2">
              <button
                type="button"
                data-testid="time-toggle"
                onClick={() => setTimeOpen((v) => !v)}
                aria-expanded={timeOpen}
                className="glass glass-shine tap flex w-full items-center gap-2 rounded-2xl px-3.5 py-2.5 text-left"
              >
                <SlidersHorizontal className="h-4 w-4 shrink-0 text-brand-500" strokeWidth={2.4} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">
                  {formatVisitLabel(visitStart)}
                  <span className="ml-1.5 font-semibold text-ink-mute">· {formatDurationShort(durationMin)}</span>
                </span>
                <ChevronDown
                  className={cn('h-4 w-4 shrink-0 text-ink-mute transition-transform', timeOpen && 'rotate-180')}
                  strokeWidth={2.4}
                />
              </button>

              <AnimatePresence initial={false}>
                {timeOpen && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, marginTop: 0 }}
                    animate={{ opacity: 1, height: 'auto', marginTop: 8 }}
                    exit={{ opacity: 0, height: 0, marginTop: 0 }}
                    transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <VisitTimePicker
                      visitStart={visitStart}
                      durationMin={durationMin}
                      onVisitChange={setVisitStart}
                      onDurationChange={setDurationMin}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <BottomSheet snap={snap} onSnapChange={setSnap} header={summaryLine} subHeader={filterBar}>
            {sampleNotice && <div className="px-3 pb-2">{sampleNotice}</div>}
            {list}
            <div className="px-3 pb-4">
              <AdSlot placeholderId={CONFIG.ezoicIds.bottom} minHeight={100} />
            </div>
          </BottomSheet>

          <AnimatePresence>
            {selectedItem && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setSelectedId(null)}
                  className="absolute inset-0 z-40 bg-[rgb(var(--pz-ink))]/25 backdrop-blur-[2px]"
                  aria-hidden
                />
                <motion.div
                  key={selectedItem.parking.id}
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '100%' }}
                  transition={{ type: 'spring', stiffness: 360, damping: 38 }}
                  drag="y"
                  dragConstraints={{ top: 0, bottom: 0 }}
                  dragElastic={{ top: 0, bottom: 0.4 }}
                  onDragEnd={(_, info) => {
                    if (info.offset.y > 120 || info.velocity.y > 600) setSelectedId(null)
                  }}
                  className="pz-scroll safe-bottom absolute inset-x-0 bottom-0 z-40 max-h-[88%] overflow-y-auto px-2 pb-2"
                >
                  <DetailPanel item={selectedItem} isSample={isSample} onClose={() => setSelectedId(null)} />
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  )
}

interface SummaryProps {
  total: number
  free: number
  conditional: number
  visitStart: Date
  durationMin: number
  refreshing: boolean
}

function ResultSummaryLine({ total, free, conditional, visitStart, durationMin, refreshing }: SummaryProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p data-testid="result-count" className="min-w-0 truncate text-[13px] font-bold text-ink">
        <span className="tnum text-free-600 dark:text-free-400">{free}</span>
        <span className="text-ink-soft">곳 무료</span>
        {conditional > 0 && (
          <>
            <span className="mx-1 text-ink-mute">·</span>
            <span className="tnum text-conditional-600 dark:text-conditional-400">{conditional}</span>
            <span className="text-ink-soft">곳 조건부</span>
          </>
        )}
        <span className="mx-1 text-ink-mute">/</span>
        <span className="tnum text-ink-soft">{total}</span>
        <span className="text-ink-mute">곳</span>
      </p>
      <p className="tnum flex shrink-0 items-center gap-1 text-[11px] font-semibold text-ink-mute">
        {refreshing && <RefreshCw className="h-3 w-3 animate-spin" strokeWidth={2.4} />}
        {formatVisitLabel(visitStart)} · {formatDurationShort(durationMin)}
      </p>
    </div>
  )
}

function Legend({ className, referenceDate }: { className?: string; referenceDate?: string }) {
  const items = [
    { color: 'bg-free-500', label: '완전 무료' },
    { color: 'bg-conditional-500', label: '조건부 무료' },
    { color: 'bg-paid-500', label: '유료 · 운영 외' },
  ]
  return (
    <div className={cn('glass glass-shine rounded-2xl px-3.5 py-2.5', className)} data-testid="legend">
      <ul className="space-y-1.5">
        {items.map((it) => (
          <li key={it.label} className="flex items-center gap-2 text-[11.5px] font-semibold text-ink-soft">
            <span className={cn('h-2.5 w-2.5 rounded-full', it.color)} />
            {it.label}
          </li>
        ))}
      </ul>
      {referenceDate && (
        <p className="tnum mt-2 border-t border-hairline/60 pt-1.5 text-[10px] text-ink-mute">
          데이터 기준 {referenceDate}
        </p>
      )}
    </div>
  )
}
