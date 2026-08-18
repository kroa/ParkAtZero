import { useEffect, useState } from 'react'
import type { Parking } from '@/types/parking'
import { loadParkings, type DataSource, type LoadStage } from '@/lib/dataSource'

export interface ParkingDataState {
  parkings: Parking[]
  /** 첫 데이터가 도착하기 전에만 true — 스켈레톤 UI 노출 조건 */
  loading: boolean
  /** 백그라운드로 원격 갱신 중 */
  refreshing: boolean
  stage: LoadStage | null
  /** 지금 보고 있는 데이터가 예시인지 실제 공공데이터인지 */
  source: DataSource
  updatedAt: number | null
  error: string | null
}

const INITIAL: ParkingDataState = {
  parkings: [],
  loading: true,
  refreshing: false,
  stage: null,
  source: 'sample',
  updatedAt: null,
  error: null,
}

/**
 * 캐시 → 시드 → 원격 순으로 데이터가 흘러 들어오는 Local-First 로더.
 * 첫 이벤트가 오는 순간 loading 이 꺼지므로 사용자는 네트워크를 기다리지 않는다.
 *
 * StrictMode 주의: 개발 모드에서 React 는 이펙트를 마운트 → 정리 → 재마운트한다.
 * 여기서 "이미 시작했으면 건너뛴다" 식의 ref 가드를 두면, 정리 단계의 abort() 로 첫 요청이
 * 취소된 뒤 두 번째 마운트가 아무것도 하지 않아 목록이 영영 비어 버린다.
 * 대신 가드 없이 매번 새로 시작하고, 취소된 실행은 상태를 건드리지 못하게 막는다.
 */
export function useParkingData(): ParkingDataState {
  const [state, setState] = useState<ParkingDataState>(INITIAL)

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller

    setState((prev) => ({ ...prev, refreshing: true }))

    loadParkings((event) => {
      if (signal.aborted) return
      setState((prev) => ({
        parkings: event.parkings.length > 0 ? event.parkings : prev.parkings,
        loading: false,
        refreshing: event.stage !== 'remote',
        stage: event.stage,
        source: event.source,
        updatedAt: event.savedAt ?? prev.updatedAt,
        error:
          event.parkings.length === 0 && event.stage === 'seed'
            ? '주차장 데이터를 불러오지 못했어요. 새로고침해 주세요.'
            : null,
      }))
    }, signal)
      .catch((err: unknown) => {
        if (signal.aborted) return
        setState((prev) => ({
          ...prev,
          loading: false,
          refreshing: false,
          error: (err as Error).message ?? '데이터 로딩 실패',
        }))
      })
      .finally(() => {
        if (signal.aborted) return
        setState((prev) => ({ ...prev, loading: false, refreshing: false }))
      })

    return () => controller.abort()
  }, [])

  return state
}
