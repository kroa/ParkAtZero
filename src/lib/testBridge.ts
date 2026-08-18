import type { Parking } from '@/types/parking'
import { evaluate } from './freeCalc'
import { extractFreeRules } from './timeRules'
import { normalizeAll, normalizeParking } from './normalize'
import { buildResults, summarize, type QueryState } from './query'

export interface TestBridge {
  version: string
  /** 원본 표준데이터 한 건 → 정규화 */
  normalize: typeof normalizeParking
  normalizeAll: typeof normalizeAll
  /** 특기사항/요금에서 무료 규칙 추출 */
  extractFreeRules: typeof extractFreeRules
  /** 시간 판별 — ISO 문자열을 받아 직렬화 가능한 결과를 돌려준다 */
  evaluate: (parking: Parking, visitIso: string, durationMin: number) => Record<string, unknown>
  /** 필터/정렬까지 포함한 전체 파이프라인 */
  run: (parkings: Parking[], query: Omit<QueryState, 'visitStart'> & { visitIso: string }) => unknown
}

declare global {
  interface Window {
    __parkatzero?: TestBridge
  }
}

/**
 * Playwright 가 브라우저 안에서 순수 판정 로직을 직접 호출할 수 있게 하는 브리지.
 *
 * E2E 만으로는 "평일 03시 / 공휴일 14시 / 야간 무료" 같은 경계 조건을 전부 UI 로 훑기 어렵다.
 * 이 브리지 덕분에 같은 번들(= 실제 배포되는 코드)로 단위 수준 검증까지 할 수 있다.
 * 프로덕션 빌드(VITE_E2E 미설정)에서는 아예 import 되지 않아 번들에 포함되지 않는다.
 */
export function installTestBridge(): void {
  if (typeof window === 'undefined') return

  window.__parkatzero = {
    version: '1.0.0',
    normalize: normalizeParking,
    normalizeAll,
    extractFreeRules,
    evaluate(parking, visitIso, durationMin) {
      const result = evaluate({ parking, visitStart: new Date(visitIso), durationMin })
      return {
        ...result,
        nextFreeAt: result.nextFreeAt ? result.nextFreeAt.toISOString() : null,
        freeUntil: result.freeUntil ? result.freeUntil.toISOString() : null,
      }
    },
    run(parkings, query) {
      const { visitIso, ...rest } = query
      const items = buildResults(parkings, { ...rest, visitStart: new Date(visitIso) })
      return {
        summary: summarize(items),
        items: items.map((it) => ({
          id: it.parking.id,
          name: it.parking.name,
          status: it.evaluation.status,
          cost: it.evaluation.cost,
          distanceKm: Number(it.distanceKm.toFixed(3)),
        })),
      }
    },
  }
}
