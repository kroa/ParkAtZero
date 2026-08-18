export interface LatLng {
  lat: number
  lng: number
}

const EARTH_RADIUS_KM = 6371

/** 두 좌표 사이 대권 거리(㎞). 반경 필터·정렬에 쓰는 정도라 하버사인으로 충분하다. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

export function formatDistance(km: number): string {
  if (!Number.isFinite(km)) return ''
  if (km < 1) return Math.round(km * 1000) + 'm'
  if (km < 10) return km.toFixed(1) + 'km'
  return Math.round(km) + 'km'
}

/** 위도에 따른 경도 1도의 실제 거리 보정. 화면 bbox 계산용. */
export function kmToLngDegrees(km: number, atLat: number): number {
  return km / (111.32 * Math.cos(toRad(atLat)) || 1)
}

export function kmToLatDegrees(km: number): number {
  return km / 110.574
}

/** Web Mercator 투영 — 지도 폴백 렌더러에서 마커 위치를 계산할 때 쓴다. */
export function project(lngLat: LatLng): { x: number; y: number } {
  const x = (lngLat.lng + 180) / 360
  const sinLat = Math.sin(toRad(lngLat.lat))
  const y = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)
  return { x, y }
}

export function unproject(point: { x: number; y: number }): LatLng {
  const lng = point.x * 360 - 180
  const n = Math.PI * (1 - 2 * point.y)
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
  return { lat, lng }
}

export const SEOUL_CITY_HALL: LatLng = { lat: 37.5663, lng: 126.9779 }
