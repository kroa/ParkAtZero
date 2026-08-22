import type { Parking } from '@/types/parking'
import { CONFIG } from './env'
import type { LatLng } from './geo'
import { normalizeAll } from './normalize'

/**
 * 데이터의 출처.
 *  - 'sample' : 저장소에 동봉된 예시 데이터. 실제 공공데이터가 아니며 요금/운영시간이 가공값이다.
 *  - 'remote' : 공공데이터포털에서 받아온 실제 데이터.
 *
 * UI 는 이 값을 보고 출처를 정직하게 표기해야 한다. 예시 데이터를 정부 데이터처럼
 * 보여주면 사용자가 실제로 그 요금을 믿고 차를 몰고 간다.
 */
export type DataSource = 'sample' | 'remote'

/**
 * 격자 색인. 빌드 때 scripts/split-snapshot.mjs 가 만든다.
 *
 * 전국 스냅샷은 11.6MB 라 저사양 단말에서 내려받고 JSON 으로 푸는 데만 2초 넘게
 * 메인 스레드를 잡는다. 그런데 화면에 필요한 것은 언제나 '보고 있는 곳 반경 몇 km' 뿐이다.
 * 색인은 3KB 남짓이라 앱이 뜨자마자 받아도 부담이 없고, 그다음 필요한 칸만 골라 받는다.
 */
export interface CellIndex {
  /** 격자 한 칸의 크기(도) */
  cellSize: number
  /** 스냅샷 전체 건수 — 출처 표시에 쓴다 */
  totalCount: number
  referenceDate?: string
  /**
   * 존재하는 칸과 그 안의 건수·파일명.
   *
   * 파일명에는 내용 해시가 붙어 있다(150_507.a1b2c3d4.json). 칸 파일은 영구 캐시라
   * 데이터가 바뀌면 이름이 바뀌고, 색인만 새로 받으면 곧바로 반영된다.
   */
  cells: Record<string, { count: number; file: string }>
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error('HTTP ' + res.status + ' — ' + url)
  return res.json()
}

/** 실패를 예외가 아니라 null 로 돌려주는 로더. */
async function tryJson(url: string, signal?: AbortSignal): Promise<unknown | null> {
  if (!url) return null
  try {
    return await fetchJson(url, signal)
  } catch {
    return null
  }
}

export async function loadCellIndex(signal?: AbortSignal): Promise<CellIndex | null> {
  const raw = (await tryJson(CONFIG.cellIndexUrl, signal)) as CellIndex | null
  if (!raw || typeof raw.cellSize !== 'number' || !raw.cells) return null
  return raw
}

/**
 * 화면에 필요한 격자 칸 목록.
 *
 * 반경 원을 감싸는 사각형이 걸치는 칸을 모두 고른다. 원 대신 사각형으로 잡는 편이
 * 계산이 단순하고, 몇 칸 더 받아도 어차피 반경 필터가 걸러 준다.
 */
export function cellKeysFor(center: LatLng, radiusKm: number, index: CellIndex): string[] {
  const size = index.cellSize
  const dLat = radiusKm / 110.574
  const dLng = radiusKm / (111.32 * Math.cos((center.lat * Math.PI) / 180) || 1)

  const keys: string[] = []
  const latFrom = Math.floor((center.lat - dLat) / size)
  const latTo = Math.floor((center.lat + dLat) / size)
  const lngFrom = Math.floor((center.lng - dLng) / size)
  const lngTo = Math.floor((center.lng + dLng) / size)

  for (let la = latFrom; la <= latTo; la++) {
    for (let lo = lngFrom; lo <= lngTo; lo++) {
      const key = la + '_' + lo
      // 빈 칸(바다·산)은 파일 자체가 없다. 404 를 만들지 않는다.
      if (index.cells[key]) keys.push(key)
    }
  }
  return keys
}

/** 격자 칸 여러 개를 병렬로 받아 하나로 합친다. 실패한 칸은 건너뛴다. */
export async function loadCells(keys: string[], index: CellIndex, signal?: AbortSignal): Promise<Parking[]> {
  const base = CONFIG.cellBaseUrl
  const results = await Promise.all(
    keys.map((key) => {
      const file = index.cells[key]?.file
      return file ? tryJson(base + '/' + file, signal) : Promise.resolve(null)
    }),
  )
  const merged: Parking[] = []
  for (const payload of results) {
    if (!payload) continue
    merged.push(...normalizeAll(payload))
  }
  return merged
}

/** 격자가 아직 없을 때(인증키 없이 띄운 환경) 쓰는 예시 데이터. */
export async function loadSample(signal?: AbortSignal): Promise<Parking[]> {
  const payload = await tryJson(CONFIG.seedUrl, signal)
  return payload ? normalizeAll(payload) : []
}
