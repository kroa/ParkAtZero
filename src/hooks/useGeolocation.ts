import { useCallback, useState } from 'react'
import type { LatLng } from '@/lib/geo'

export type GeoStatus = 'idle' | 'locating' | 'granted' | 'denied' | 'unavailable'

export interface GeoState {
  status: GeoStatus
  position: LatLng | null
  accuracy: number | null
  error: string | null
}

const INITIAL: GeoState = { status: 'idle', position: null, accuracy: null, error: null }

/**
 * '내 위치' 버튼용 GPS 훅.
 * 권한을 미리 묻지 않고 사용자가 버튼을 누른 순간에만 요청한다(무설치·무가입 원칙).
 */
export function useGeolocation() {
  const [state, setState] = useState<GeoState>(INITIAL)

  const locate = useCallback((): Promise<LatLng | null> => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState({ ...INITIAL, status: 'unavailable', error: '이 브라우저는 위치 기능을 지원하지 않아요.' })
      return Promise.resolve(null)
    }

    setState((prev) => ({ ...prev, status: 'locating', error: null }))

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const next: LatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude }
          setState({ status: 'granted', position: next, accuracy: pos.coords.accuracy, error: null })
          resolve(next)
        },
        (err) => {
          const denied = err.code === err.PERMISSION_DENIED
          setState({
            status: denied ? 'denied' : 'unavailable',
            position: null,
            accuracy: null,
            error: denied
              ? '위치 권한이 꺼져 있어요. 주소창 옆 자물쇠에서 허용해 주세요.'
              : '현재 위치를 가져오지 못했어요.',
          })
          resolve(null)
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
      )
    })
  }, [])

  return { ...state, locate }
}
