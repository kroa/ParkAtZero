import type { ParkingStatus } from '@/types/parking'
import { statusStyle } from '@/lib/statusStyle'

export interface MarkerModel {
  id: string
  name: string
  status: ParkingStatus
  /** 마커에 찍히는 짧은 라벨 — 보통 요금 */
  label: string
  /** 라벨 없이 작은 점으로만 찍는다 — 요금 미공개·운영 종료 */
  minor?: boolean
  lat: number
  lng: number
}

/**
 * 지도 마커 DOM 을 만든다.
 *
 * MapLibre 는 React 트리 밖에서 DOM 을 관리하므로 마커도 순수 DOM 으로 만들고,
 * 폴백 지도(React)에서도 같은 마크업을 쓰도록 문자열 템플릿을 공유한다.
 * → 실제 지도든 폴백이든 Playwright 는 완전히 동일한 셀렉터로 접근할 수 있다.
 */
export function markerInnerHtml(model: MarkerModel, selected: boolean): string {
  const style = statusStyle(model.status)
  const scale = selected ? 1.12 : 1

  /*
   * 요금 미공개·운영 종료는 점으로만 찍는다.
   *
   * 이 앱은 0원 주차장을 찾는 도구다. 금액을 모르는 유료 주차장이 '미공개' 라는
   * 글자를 달고 무료 주차장과 같은 크기로 지도를 덮으면, 정작 답인 초록 마커가
   * 그 사이에 묻힌다. 정보는 남기되(누르면 상세가 열린다) 목소리만 낮춘다.
   */
  if (model.minor) {
    return `
    <span class="pz-marker-dot" style="
      background:${style.markerFill};
      transform:scale(${selected ? 1.6 : 1});
      ${selected ? `box-shadow:0 0 0 3px ${style.markerRing},0 2px 6px -1px rgba(15,23,42,.4)` : ''};
    "></span>
  `
  }

  return `
    <span class="pz-marker-ring" style="background:${style.markerRing};opacity:${selected ? 1 : 0}"></span>
    <span class="pz-marker-pill" style="
      background:${style.markerFill};
      color:${style.markerInk};
      transform:scale(${scale});
      box-shadow:0 6px 16px -4px rgba(15,23,42,.45)${selected ? `,0 0 0 3px ${style.markerRing}` : ''};
    ">
      <span class="pz-marker-label">${escapeHtml(model.label)}</span>
    </span>
    <span class="pz-marker-tip" style="border-top-color:${style.markerFill}"></span>
  `
}

export function createMarkerElement(model: MarkerModel, selected: boolean, onClick: (id: string) => void): HTMLElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'pz-marker'
  el.dataset.testid = 'map-marker'
  el.setAttribute('data-testid', 'map-marker')
  el.setAttribute('data-parking-id', model.id)
  el.setAttribute('data-status', model.status)
  el.setAttribute('data-selected', selected ? 'true' : 'false')
  el.setAttribute('aria-label', model.name + ' — ' + model.label)
  el.innerHTML = markerInnerHtml(model, selected)

  el.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick(model.id)
  })

  return el
}

export function updateMarkerElement(el: HTMLElement, model: MarkerModel, selected: boolean): void {
  el.setAttribute('data-status', model.status)
  el.setAttribute('data-selected', selected ? 'true' : 'false')
  el.style.zIndex = selected ? '20' : '1'
  el.innerHTML = markerInnerHtml(model, selected)
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

/** 지도에서 점으로만 찍을 상태 — 답이 될 수 없는 곳은 목소리를 낮춘다. */
export function isMinorMarker(status: ParkingStatus, cost: number | null): boolean {
  return status === 'closed' || status === 'unknown' || cost === null
}

/** 요금/상태를 마커 한 줄 라벨로. 지도를 훑을 때 숫자 하나로 판단되게 한다. */
export function markerLabel(status: ParkingStatus, cost: number | null): string {
  if (status === 'closed') return '종료'
  // '?' 만 찍으면 무슨 뜻인지 알 수 없다. 요금을 모른다는 사실을 그대로 적는다.
  if (status === 'unknown' || cost === null) return '미공개'
  if (cost === 0) return '0원'
  if (cost >= 10000) return Math.round(cost / 1000) + '천'
  return cost.toLocaleString('ko-KR')
}
