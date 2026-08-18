export type NaviApp = 'kakao' | 'naver' | 'tmap' | 'google'

export interface NaviTarget {
  name: string
  lat: number
  lng: number
}

export interface NaviLink {
  id: NaviApp
  label: string
  /** 모바일에서 먼저 시도할 앱 스킴. 없으면 web 만 연다. */
  scheme?: string
  /** 데스크톱/폴백용 웹 URL */
  web: string
  /** 브랜드 컬러 — 아이콘 배경 */
  color: string
}

const APP_NAME = 'parkatzero.pages.dev'

export function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent)
}

/**
 * 1-Tap 길안내 링크 4종.
 *
 * 카카오는 map.kakao.com/link 가 모바일에서 자동으로 앱을 띄우므로 웹 URL 하나로 충분하고,
 * 네이버/T맵은 앱 스킴이 훨씬 정확해서 스킴 우선 + 웹 폴백 구조로 만든다.
 */
export function buildNaviLinks(target: NaviTarget): NaviLink[] {
  const name = encodeURIComponent(target.name)
  const { lat, lng } = target

  return [
    {
      id: 'kakao',
      label: '카카오맵',
      web: 'https://map.kakao.com/link/to/' + name + ',' + lat + ',' + lng,
      color: '#FEE500',
    },
    {
      id: 'naver',
      label: '네이버지도',
      scheme:
        'nmap://route/car?dlat=' +
        lat +
        '&dlng=' +
        lng +
        '&dname=' +
        name +
        '&appname=' +
        APP_NAME,
      web: 'https://map.naver.com/p/directions/-/' + lng + ',' + lat + ',' + name + '/-/car',
      color: '#03C75A',
    },
    {
      id: 'tmap',
      label: 'T맵',
      scheme: 'tmap://route?goalname=' + name + '&goalx=' + lng + '&goaly=' + lat,
      web: 'https://tmap.life/route?goalname=' + name + '&goalx=' + lng + '&goaly=' + lat,
      color: '#EC0C6E',
    },
    {
      id: 'google',
      label: '구글맵',
      web:
        'https://www.google.com/maps/dir/?api=1&destination=' +
        lat +
        ',' +
        lng +
        '&travelmode=driving',
      color: '#4285F4',
    },
  ]
}

/**
 * 앱 스킴을 먼저 시도하고, 일정 시간 안에 페이지가 백그라운드로 넘어가지 않으면
 * (= 앱이 없다는 뜻) 웹 URL 로 폴백한다. 데스크톱에서는 곧장 웹으로 연다.
 */
export function openNavi(link: NaviLink): void {
  if (typeof window === 'undefined') return

  if (!link.scheme || !isMobile()) {
    window.open(link.web, '_blank', 'noopener,noreferrer')
    return
  }

  let settled = false
  const onHide = () => {
    if (document.visibilityState === 'hidden') settled = true
  }
  document.addEventListener('visibilitychange', onHide)

  window.location.href = link.scheme

  window.setTimeout(() => {
    document.removeEventListener('visibilitychange', onHide)
    if (!settled) window.location.href = link.web
  }, 1200)
}
