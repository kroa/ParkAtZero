import { useEffect, useRef, useState } from 'react'
import type { Parking } from '@/types/parking'
import type { LatLng } from '@/lib/geo'
import { cellKeysFor, loadCellIndex, loadCells, loadSample, type CellIndex, type DataSource } from '@/lib/dataSource'

export interface ParkingDataState {
  /** 지금까지 받아 둔 격자 칸들의 주차장 (누적) */
  parkings: Parking[]
  /** 첫 데이터가 도착하기 전에만 true — 스켈레톤 UI 노출 조건 */
  loading: boolean
  /** 다른 지역으로 옮겨 새 칸을 받는 중 */
  refreshing: boolean
  source: DataSource
  /** 스냅샷 전체 건수 (지금 받아 둔 것이 아니라 전국 기준) */
  totalCount: number
  referenceDate?: string
  error: string | null
}

const INITIAL: ParkingDataState = {
  parkings: [],
  loading: true,
  refreshing: false,
  source: 'sample',
  totalCount: 0,
  error: null,
}

/**
 * 보고 있는 곳 주변의 주차장만 격자 단위로 받아 온다.
 *
 * 전국 스냅샷을 통째로 읽던 시절에는 저사양 단말에서 파싱만 2초가 걸렸고, 그동안
 * 사용자는 예시(가짜) 데이터를 보고 있어야 했다. 지금은 3KB 색인을 먼저 받고
 * 필요한 칸만 골라 받으므로 첫 화면부터 실제 데이터를 보여줄 수 있다.
 *
 * 받아 둔 칸은 버리지 않고 쌓는다. 지도를 옮겼다가 돌아와도 다시 받지 않는다.
 */
export function useParkingData(origin: LatLng, radiusKm: number): ParkingDataState {
  const [state, setState] = useState<ParkingDataState>(INITIAL)
  const indexRef = useRef<CellIndex | null>(null)
  const loadedRef = useRef(new Set<string>())
  const byIdRef = useRef(new Map<string, Parking>())

  // 색인이 없으면(격자를 아직 만들지 않은 환경) 예시 데이터로 내려간다.
  const [indexReady, setIndexReady] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const index = await loadCellIndex(controller.signal)
      if (controller.signal.aborted) return

      if (index) {
        indexRef.current = index
        setState((prev) => ({
          ...prev,
          source: 'remote',
          totalCount: index.totalCount,
          referenceDate: index.referenceDate,
        }))
        setIndexReady(true)
        return
      }

      const sample = await loadSample(controller.signal)
      if (controller.signal.aborted) return
      setState({
        parkings: sample,
        loading: false,
        refreshing: false,
        source: 'sample',
        totalCount: sample.length,
        error: sample.length === 0 ? '주차장 데이터를 불러오지 못했어요. 새로고침해 주세요.' : null,
      })
    })()

    return () => controller.abort()
  }, [])

  // 기준점이나 반경이 바뀌면 부족한 칸을 채운다.
  useEffect(() => {
    if (!indexReady) return
    const index = indexRef.current
    if (!index) return

    const needed = cellKeysFor(origin, radiusKm, index).filter((k) => !loadedRef.current.has(k))
    if (needed.length === 0) {
      setState((prev) => (prev.loading ? { ...prev, loading: false } : prev))
      return
    }

    const controller = new AbortController()
    setState((prev) => ({ ...prev, refreshing: true }))

    void (async () => {
      const rows = await loadCells(needed, index, controller.signal)
      if (controller.signal.aborted) return

      for (const key of needed) loadedRef.current.add(key)
      // 칸 경계에 걸친 주차장이 중복되지 않도록 id 로 합친다.
      for (const p of rows) byIdRef.current.set(p.id, p)

      setState((prev) => ({
        ...prev,
        parkings: [...byIdRef.current.values()],
        loading: false,
        refreshing: false,
      }))
    })()

    return () => controller.abort()
    // origin 은 객체라 매 렌더 새로 만들어진다. 원시값으로 의존성을 잡아야 무한 루프가 없다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexReady, origin.lat, origin.lng, radiusKm])

  return state
}
