import type { Evaluation, Parking, ParkingStatus } from '@/types/parking'
import { evaluate, STATUS_ORDER } from './freeCalc'
import { haversineKm, type LatLng } from './geo'
import { searchKey } from '@/data/landmarks'

export type StatusFilter = 'all' | 'free' | 'freeish'
export type OwnershipFilter = 'all' | '공영' | '민영'
export type SortKey = 'smart' | 'distance' | 'cost'

export interface QueryState {
  keyword: string
  visitStart: Date
  durationMin: number
  center: LatLng
  radiusKm: number
  status: StatusFilter
  ownership: OwnershipFilter
  sort: SortKey
}

export interface ResultItem {
  parking: Parking
  evaluation: Evaluation
  distanceKm: number
}

export interface ResultSummary {
  total: number
  free: number
  conditional: number
  paid: number
  closed: number
}

function matchesKeyword(p: Parking, key: string): boolean {
  if (!key) return true
  return (
    searchKey(p.name).includes(key) ||
    searchKey(p.address).includes(key) ||
    searchKey(p.managedBy ?? '').includes(key)
  )
}

function passesStatus(status: ParkingStatus, filter: StatusFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'free') return status === 'free'
  return status === 'free' || status === 'conditional'
}

/**
 * 화면에 뿌릴 최종 결과를 만든다.
 *
 * 반경 필터를 먼저 적용해 evaluate() 호출 수를 줄인다 — 전국 데이터(수만 건)를 다 평가하면
 * 시간 슬라이더를 움직일 때마다 프레임이 떨어진다.
 */
export function buildResults(parkings: Parking[], q: QueryState): ResultItem[] {
  const key = searchKey(q.keyword)
  const items: ResultItem[] = []

  for (const p of parkings) {
    const distanceKm = haversineKm(q.center, p)
    // 키워드 검색 중에는 반경을 넓게 본다 — "속초"를 검색했는데 반경 3㎞로 잘리면 곤란하다.
    const withinRadius = key ? distanceKm <= Math.max(q.radiusKm, 400) : distanceKm <= q.radiusKm
    if (!withinRadius) continue
    if (!matchesKeyword(p, key)) continue
    if (q.ownership !== 'all' && p.ownership !== q.ownership) continue

    const evaluation = evaluate({ parking: p, visitStart: q.visitStart, durationMin: q.durationMin })
    if (!passesStatus(evaluation.status, q.status)) continue

    items.push({ parking: p, evaluation, distanceKm })
  }

  return sortResults(items, q.sort)
}

export function sortResults(items: ResultItem[], sort: SortKey): ResultItem[] {
  const sorted = [...items]

  if (sort === 'distance') {
    sorted.sort((a, b) => a.distanceKm - b.distanceKm)
    return sorted
  }

  if (sort === 'cost') {
    sorted.sort((a, b) => {
      const ac = a.evaluation.cost ?? Number.MAX_SAFE_INTEGER
      const bc = b.evaluation.cost ?? Number.MAX_SAFE_INTEGER
      if (ac !== bc) return ac - bc
      return a.distanceKm - b.distanceKm
    })
    return sorted
  }

  // smart: 무료 → 조건부 → 유료 순, 같은 등급 안에서는 가까운 순.
  sorted.sort((a, b) => {
    const rank = STATUS_ORDER[a.evaluation.status] - STATUS_ORDER[b.evaluation.status]
    if (rank !== 0) return rank
    return a.distanceKm - b.distanceKm
  })
  return sorted
}

export function summarize(items: ResultItem[]): ResultSummary {
  const summary: ResultSummary = { total: items.length, free: 0, conditional: 0, paid: 0, closed: 0 }
  for (const it of items) {
    switch (it.evaluation.status) {
      case 'free':
        summary.free++
        break
      case 'conditional':
        summary.conditional++
        break
      case 'paid':
      case 'unknown':
        summary.paid++
        break
      case 'closed':
        summary.closed++
        break
    }
  }
  return summary
}

/** 검색 자동완성에 쓸 주차장 후보 */
export function suggestParkings(parkings: Parking[], keyword: string, limit = 5): Parking[] {
  const key = searchKey(keyword)
  if (key.length < 1) return []

  const starts: Parking[] = []
  const contains: Parking[] = []

  for (const p of parkings) {
    const name = searchKey(p.name)
    if (name.startsWith(key)) starts.push(p)
    else if (name.includes(key) || searchKey(p.address).includes(key)) contains.push(p)
    if (starts.length >= limit) break
  }

  return [...starts, ...contains].slice(0, limit)
}
