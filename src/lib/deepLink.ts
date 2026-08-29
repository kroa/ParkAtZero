import { SEOUL_CITY_HALL, type LatLng } from './geo'

/**
 * 주소창의 ?lat=&lng=&z= 로 앱을 특정 위치에서 열 수 있게 한다.
 *
 * 지역 랜딩 페이지(/지역/서울특별시/종로구/)에서 '지도에서 보기'를 누르면 그 지역이
 * 열려야 한다. 이게 없으면 어디서 들어오든 서울시청이 뜨고, 포항 페이지를 보고 온
 * 사람은 엉뚱한 목록을 마주한다.
 *
 * 값은 반드시 검사한다. 주소창은 누구나 고칠 수 있고, 이상한 좌표가 들어오면
 * 격자 칸을 못 찾아 빈 화면이 된다. 한반도 밖이면 무시하고 기본값으로 돌아간다.
 */
export interface DeepLink {
  center: LatLng
  zoom: number
}

/** 앱이 데이터를 가진 범위. normalize 의 좌표 검사와 같은 뜻이다. */
function inRange(lat: number, lng: number): boolean {
  return lat >= 32 && lat <= 39.5 && lng >= 124 && lng <= 132.5
}

export function parseDeepLink(search: string): DeepLink | null {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(search)
  } catch {
    return null
  }

  const lat = Number(params.get('lat'))
  const lng = Number(params.get('lng'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inRange(lat, lng)) return null

  /*
   * z 가 없으면 기본 14. Number(null) 은 NaN 이 아니라 0 이라 그냥 Number 로 감싸면
   * 0 이 유효한 값으로 통과해 배율 10 으로 잘린다 — 화면이 필요 이상으로 넓어지고
   * 격자 칸도 잔뜩 받게 된다.
   */
  const rawZoom = params.get('z')
  const zoomNum = rawZoom === null ? Number.NaN : Number(rawZoom)
  // 너무 멀리 잡으면 격자 칸을 잔뜩 받게 되고, 너무 당기면 주변이 안 보인다.
  const zoom = Number.isFinite(zoomNum) ? Math.min(18, Math.max(10, zoomNum)) : 14

  return { center: { lat, lng }, zoom }
}

/** 브라우저에서 한 번만 읽는다. 서버·테스트에서는 null. */
export function readDeepLink(): DeepLink | null {
  if (typeof window === 'undefined') return null
  return parseDeepLink(window.location.search)
}

/** 지역 페이지가 만들 링크. 스크립트와 앱이 같은 규칙을 쓰도록 여기에 둔다. */
export function buildDeepLink(center: LatLng = SEOUL_CITY_HALL, zoom = 14): string {
  return `/?lat=${center.lat.toFixed(5)}&lng=${center.lng.toFixed(5)}&z=${zoom}`
}
