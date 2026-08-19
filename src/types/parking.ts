/** 요일 구분 — 공공데이터 '전국주차장표준데이터' 의 운영시간 컬럼 구성과 1:1 대응한다. */
export type DayType = 'weekday' | 'saturday' | 'holiday'

/**
 * 선택한 방문 시간 기준의 최종 판정.
 * - free        : 초록. 방문 구간 전체가 조건 없이 0원.
 * - conditional : 주황. 0원이지만 조건이 붙음(시간제한/대상제한) 또는 일부 구간만 무료.
 * - paid        : 회색. 해당 시간대는 유료.
 * - closed      : 회색(어둡게). 운영시간 외.
 * - unknown     : 요금 정보 부족으로 계산 불가.
 */
export type ParkingStatus = 'free' | 'conditional' | 'paid' | 'closed' | 'unknown'

/** 하루 안에서의 운영 구간. 분 단위(0=00:00). close 가 open 보다 작으면 자정을 넘긴다. */
export interface OperRange {
  /** 00:00 기준 경과 분 */
  open: number
  /** 00:00 기준 경과 분. 자정을 넘기는 경우 open 보다 큰 값으로 정규화(예: 익일 02:00 → 1560) */
  close: number
  /** 0000-2400 처럼 사실상 24시간 개방인 경우 */
  allDay: boolean
}

export interface ParkingFee {
  /** 기본 주차 시간(분) */
  basicTime: number
  /** 기본 요금(원) */
  basicCharge: number
  /** 추가 단위 시간(분) */
  addTime: number
  /** 추가 단위 요금(원) */
  addCharge: number
  /** 1일 주차권 적용 시간(분) */
  dayTicketTime?: number
  /** 1일 주차권 요금(원) — 요금 상한(cap)으로 사용 */
  dayTicket?: number
  /** 월 정기권 요금(원) */
  monthTicket?: number
}

/** 앱 전체가 사용하는 정규화된 주차장 레코드. */
export interface Parking {
  id: string
  name: string
  /** 노상/노외/부설 */
  type: string
  /** 공영/민영 */
  ownership: string
  address: string
  lat: number
  lng: number
  capacity: number
  /** 무료 / 유료 / 혼합 / 알수없음 */
  chargeType: '무료' | '유료' | '혼합' | '알수없음'
  /** 운영요일 원문(평일+토요일+공휴일 / 매일 등) */
  operDay?: string
  hours: {
    weekday: OperRange | null
    saturday: OperRange | null
    holiday: OperRange | null
  }
  fee: ParkingFee
  /** 특기사항 — '최초 30분 무료', '19시 이후 무료' 같은 조건부 무료 정보의 주 출처 */
  note?: string
  /**
   * 일반 차량이 댈 수 없는 이유 (예: '관광버스 전용').
   * 특기사항에서 읽거나, 원본이 비어 있으면 보정표(data/corrections.ts)에서 채운다.
   */
  restriction?: string
  tel?: string
  payment?: string
  managedBy?: string
  updatedAt?: string
  /** 계산 중 거리 캐시(㎞). 데이터 원본에는 없음. */
  distanceKm?: number
}

/** 특기사항/요금 필드에서 추출한 '무료 규칙' */
export type FreeRule =
  | { kind: 'always'; label: string }
  /** 최초 N분 무료 */
  | { kind: 'grace'; minutes: number; label: string }
  /** 하루 중 특정 시간대 무료 (분 단위, to 가 from 보다 작으면 자정 넘김) */
  | { kind: 'window'; from: number; to: number; days?: DayType[]; label: string; inferred?: boolean }
  /** 특정 요일 전일 무료 */
  | { kind: 'dayType'; days: DayType[]; label: string }
  /** 특정 대상만 무료(경차/장애인/저공해 등) — 모두에게 적용되지 않음 */
  | { kind: 'targeted'; target: string; label: string }

export interface FreeSegment {
  /** 방문 구간 시작으로부터의 오프셋(분) */
  start: number
  end: number
  rule: FreeRule
}

export interface Evaluation {
  status: ParkingStatus
  /** 뱃지에 그대로 찍히는 짧은 문구 */
  badge: string
  /** 카드 본문 한 줄 요약 */
  headline: string
  /** 방문 구간 총 길이(분) */
  totalMinutes: number
  /** 그 중 무료로 커버되는 분 */
  freeMinutes: number
  /** 예상 결제 금액(원). null = 계산 불가 */
  cost: number | null
  /** 요금 계산에 사용한 과금 대상 분 */
  chargeableMinutes: number
  /** 적용된 무료 규칙 */
  appliedRules: FreeRule[]
  /** 대상 한정(경차 등) 안내 */
  targetedRules: FreeRule[]
  /** 사용자에게 보여줄 근거 목록 */
  reasons: string[]
  /** 지금은 유료지만 이 시각부터 무료 (Date) */
  nextFreeAt: Date | null
  /** 무료가 끝나는 시각 (Date) */
  freeUntil: Date | null
  dayType: DayType
  isOpen: boolean
  /** 요금 상세를 추정으로 계산했는지 여부 */
  estimated: boolean
  /** 특정 차종·대상 전용이라 일반 차량은 댈 수 없는 경우의 라벨 (예: '관광버스 전용') */
  restriction?: string
}
