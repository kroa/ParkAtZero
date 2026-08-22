import type { DayType, Evaluation, FreeRule, Parking, ParkingFee, ParkingStatus } from '@/types/parking'
import {
  findContaining,
  intersectAll,
  intersectLists,
  totalLength,
  union,
  type Interval,
} from './interval'
import {
  DAY_MINUTES,
  extractFreeRules,
  extractRestriction,
  formatDurationShort,
  formatMinuteOfDay,
  getDayType,
  minutesOfDay,
  minutesToDate,
  operatesOn,
  startOfDay,
} from './timeRules'

/** 방문 당일을 0으로 두고 앞뒤 며칠까지 규칙을 펼칠지. 야간무료·자정 넘김 계산에 필요. */
const DAY_SPAN = [-1, 0, 1, 2, 3] as const

export function formatMoney(won: number): string {
  return won.toLocaleString('ko-KR') + '원'
}

/**
 * 과금 대상 시간(분)에 대한 예상 요금.
 * 표준데이터의 기본시간/기본요금/추가단위시간/추가단위요금/일주차권 상한을 그대로 적용한다.
 * 계산 불가한 조합이면 null 을 돌려 UI 가 '정보 부족'으로 표시하게 한다.
 */
export function computeCost(fee: ParkingFee, minutes: number): { cost: number | null; estimated: boolean } {
  if (minutes <= 0) return { cost: 0, estimated: false }

  const { basicTime, basicCharge, addTime, addCharge, dayTicket } = fee

  /*
   * 금액이 전부 비어 있으면 '0원'이 아니라 '모른다'.
   *
   * 표준데이터에는 요금정보를 '유료'로 등록해 놓고 금액 칸은 채우지 않은 레코드가
   * 적지 않다(실측 621곳). 그걸 0원으로 읽으면 유료 주차장이 초록 '완전 무료'로
   * 표시되어, 돈을 내야 하는 곳에 무료인 줄 알고 가게 된다.
   * 무료인 주차장은 요금정보가 '무료'로 들어오고 evaluate 가 그 경로를 따로 타므로,
   * 여기까지 왔다는 것은 유료·혼합이라는 뜻이다.
   */
  if (basicCharge === 0 && addCharge === 0 && !(dayTicket && dayTicket > 0)) {
    return { cost: null, estimated: true }
  }

  let cost = 0
  let remaining = minutes
  let estimated = false

  if (basicTime > 0) {
    cost = basicCharge
    remaining = minutes - basicTime
  }

  if (remaining > 0) {
    if (addTime > 0) {
      cost += Math.ceil(remaining / addTime) * addCharge
    } else if (basicTime > 0) {
      // 추가 단위가 비어 있는 데이터 — 기본요금만 확정할 수 있다.
      estimated = true
    } else if (basicCharge > 0) {
      // 기본시간/추가단위 모두 없고 요금만 있는 정액제
      cost = basicCharge
    } else {
      return { cost: null, estimated: true }
    }
  }

  if (dayTicket && dayTicket > 0) cost = Math.min(cost, dayTicket)
  return { cost, estimated }
}

/** 요금 체계를 사람이 읽는 한 줄로. */
export function describeFee(p: Parking): string {
  if (p.chargeType === '무료') return '무료'
  const { basicTime, basicCharge, addTime, addCharge, dayTicket } = p.fee
  const parts: string[] = []
  if (basicTime > 0) parts.push('기본 ' + formatDurationShort(basicTime) + ' ' + formatMoney(basicCharge))
  else if (basicCharge > 0) parts.push('기본 ' + formatMoney(basicCharge))
  if (addTime > 0) parts.push('추가 ' + formatDurationShort(addTime) + '당 ' + formatMoney(addCharge))
  if (dayTicket && dayTicket > 0) parts.push('일 최대 ' + formatMoney(dayTicket))

  /*
   * 시간 요금이 하나도 없는 곳은 월정기만 파는 구획이다(실측 59곳).
   * '요금 정보 없음' 이라고 적으면 알아낼 방법이 없어 보이지만, 실제로는 아는 금액이 있다.
   */
  if (parts.length === 0 && p.fee.monthTicket) return '월 정기권 ' + formatMoney(p.fee.monthTicket)

  return parts.length ? parts.join(' · ') : '요금 정보 없음'
}

/*
 * 노상인데도 물리적으로 막히는 곳의 신호.
 *
 * "운영시간 내 무료. 야간 차단기 통제" 처럼 적힌 노상주차장이 있다. 이런 곳은
 * 운영시간 밖에 아예 들어갈 수 없으므로 아래 <운영시간 외 무료> 규칙을 적용하면 안 된다.
 * 요금을 잘못 알려 주는 것보다 갔는데 못 대는 쪽이 더 나쁘다.
 */
const BARRIER_HINT = /차단기|차단봉|게이트|폐쇄|통제|출입\s*금지|진입\s*금지/

function dayTypeForOffset(visitStart: Date, offset: number): DayType {
  const d = new Date(startOfDay(visitStart).getTime() + offset * DAY_MINUTES * 60_000)
  return getDayType(d)
}

/**
 * 요일별 운영시간을 방문 당일 자정 기준의 절대 분 구간으로 펼친다.
 *
 * 운영시간 컬럼이 비어 있을 때가 많아 운영요일(operDay)을 함께 본다.
 *  - 운영요일에 포함된 날: 24시간 개방으로 가정하고 '추정' 표시
 *  - 운영요일에서 빠진 날: 그날은 미운영
 */
function buildOperIntervals(p: Parking, visitStart: Date): { intervals: Interval[]; assumed: boolean } {
  const intervals: Interval[] = []
  let assumed = false

  for (const offset of DAY_SPAN) {
    const dt = dayTypeForOffset(visitStart, offset)
    const range = p.hours[dt]
    const base = offset * DAY_MINUTES

    if (!range) {
      if (!operatesOn(p.operDay, dt)) continue
      assumed = true
      intervals.push({ start: base, end: base + DAY_MINUTES })
      continue
    }
    intervals.push({ start: base + range.open, end: base + range.close })
  }
  return { intervals: union(intervals), assumed }
}

/** 무료 규칙을 방문 당일 자정 기준 절대 분 구간으로 펼친다. grace/targeted 는 제외. */
function buildRuleIntervals(
  rules: FreeRule[],
  visitStart: Date,
): { intervals: Interval[]; used: FreeRule[]; inferred: boolean } {
  const intervals: Interval[] = []
  const used: FreeRule[] = []
  let inferred = false

  for (const rule of rules) {
    if (rule.kind === 'grace' || rule.kind === 'targeted' || rule.kind === 'exempt') continue

    if (rule.kind === 'always') {
      intervals.push({ start: DAY_SPAN[0] * DAY_MINUTES, end: (DAY_SPAN[DAY_SPAN.length - 1] + 1) * DAY_MINUTES })
      used.push(rule)
      continue
    }

    for (const offset of DAY_SPAN) {
      const dt = dayTypeForOffset(visitStart, offset)
      const base = offset * DAY_MINUTES

      if (rule.kind === 'dayType') {
        if (!rule.days.includes(dt)) continue
        intervals.push({ start: base, end: base + DAY_MINUTES })
        continue
      }

      // window
      if (rule.days && !rule.days.includes(dt)) continue
      const from = base + rule.from
      const to = base + (rule.to <= rule.from ? rule.to + DAY_MINUTES : rule.to)
      intervals.push({ start: from, end: to })
      if (rule.inferred) inferred = true
    }
    used.push(rule)
  }

  return { intervals: union(intervals), used, inferred }
}

function pickBadge(status: ParkingStatus): string {
  switch (status) {
    case 'free':
      return '완전 무료'
    case 'conditional':
      return '조건부 무료'
    case 'paid':
      return '유료'
    case 'closed':
      return '운영 종료'
    default:
      return '정보 부족'
  }
}

export interface EvaluateInput {
  parking: Parking
  visitStart: Date
  /** 예상 주차 시간(분) */
  durationMin: number
}

/**
 * 선택한 방문 시각·주차 시간 기준으로 이 주차장이 '0원'인지 판정한다.
 *
 * 판정 기준
 *  - free        : 시간대·요일 규칙만으로 방문 구간 전체가 0원 (무료 주차장 / 그 시간대 전면 무료)
 *  - conditional : 0원이지만 '최초 N분' 같은 시간제한 덕분이거나, 구간 일부만 무료
 *  - paid        : 해당 시간대는 요금이 발생
 *  - closed      : 방문 구간에 운영시간이 전혀 걸리지 않음
 *
 * '최초 N분 무료'의 이중 차감 주의:
 *  요금표가 이미 기본요금 0원 + 기본시간 N분 구조라면 computeCost 가 그 N분을 빼 준다.
 *  그래서 그런 경우의 grace 는 요금 계산에서 제외하고 표시용으로만 쓴다.
 */
export function evaluate({ parking, visitStart, durationMin }: EvaluateInput): Evaluation {
  const duration = Math.max(1, Math.round(durationMin))
  const startMin = minutesOfDay(visitStart)
  const visit: Interval = { start: startMin, end: startMin + duration }
  const dayType = getDayType(visitStart)

  // 보통은 정규화 단계에서 채워진다. 다만 normalize 를 거치지 않고 만든 레코드도
  // 같은 판정을 받아야 하므로 특기사항에서 직접 읽는 경로를 남겨 둔다.
  const restriction = parking.restriction ?? extractRestriction(parking.note)

  const rules = extractFreeRules(parking)
  const targetedRules = rules.filter((r): r is Extract<FreeRule, { kind: 'targeted' }> => r.kind === 'targeted')
  const graceRules = rules.filter((r): r is Extract<FreeRule, { kind: 'grace' }> => r.kind === 'grace')

  const oper = buildOperIntervals(parking, visitStart)
  const openInVisit = intersectAll(oper.intervals, visit)
  const openMinutes = totalLength(openInVisit)

  const ruleSet = buildRuleIntervals(rules, visitStart)
  const freeByRules = intersectAll(ruleSet.intervals, visit)

  /*
   * ── 면제시간(회차시간) ────────────────────────────────
   *
   * '최초 N분 무료'(grace) 와 다르다. grace 는 그 시간만큼 과금 대상에서 빼 준다.
   * 면제시간은 <그 안에 나가면 전액 무료, 넘기면 처음부터 과금>이다. 시간을 빼 주면
   * 요금을 실제보다 싸게 알려 주게 된다 — 한강공원 2시간이 2,800원인데 2,600원이 된다.
   */
  const exemptMinutes = rules.reduce((max, r) => (r.kind === 'exempt' ? Math.max(max, r.minutes) : max), 0)
  const exemptCovers = exemptMinutes > 0 && duration <= exemptMinutes

  // ── 최초 N분 무료 ────────────────────────────────────────
  const graceMinutes = graceRules.reduce((max, r) => Math.max(max, r.minutes), 0)
  // 요금표에 이미 반영된 무료 시간은 요금 계산에서 다시 빼면 안 된다.
  const graceInFee = parking.fee.basicCharge === 0 && parking.fee.basicTime >= graceMinutes
  const billableGrace = graceInFee ? 0 : graceMinutes

  const graceInterval = (minutes: number): Interval[] =>
    minutes > 0 ? [{ start: startMin, end: Math.min(startMin + minutes, visit.end) }] : []

  // 면제시간 안에 들어오는 방문은 구간 전체가 0원이다.
  const exemptInterval: Interval[] = exemptCovers ? [{ start: startMin, end: visit.end }] : []

  const freeForCost = union([...freeByRules, ...graceInterval(billableGrace), ...exemptInterval])
  const freeForDisplay = union([...freeByRules, ...graceInterval(graceMinutes), ...exemptInterval])

  const freeInOpen = totalLength(intersectLists(freeForCost, openInVisit))
  const nonGraceInOpen = totalLength(intersectLists(freeByRules, openInVisit))
  // 표시용 무료 시간도 운영시간 안에서만 센다 — 문이 닫혀 있으면 '무료 2시간'이 아니라 0분이다.
  let freeMinutes = totalLength(intersectLists(freeForDisplay, openInVisit))

  const chargeable = Math.max(0, openMinutes - freeInOpen)

  const isDeclaredFree = parking.chargeType === '무료'
  const priced = isDeclaredFree ? { cost: 0, estimated: false } : computeCost(parking.fee, chargeable)

  const reasons: string[] = []
  let status: ParkingStatus
  let headline: string
  /** 운영시간 밖이라 0원이라고 판단한 경우 — 이 레코드에 적힌 값이 아니라 제도에서 온 추론이다. */
  let offHoursFree = false

  const coveredByRules = openMinutes > 0 && nonGraceInOpen >= openMinutes - 0.5

  // ── 상태 결정 ────────────────────────────────────────────────
  if (openMinutes === 0) {
    const range = parking.hours[dayType]
    const hoursLabel = range
      ? formatMinuteOfDay(range.open) + '~' + formatMinuteOfDay(range.close) + ' 운영'
      : '해당 요일 미운영'

    /*
     * 노상주차장의 운영시간 밖은 <문을 닫은 것>이 아니라 <요금을 받지 않는 것>이다.
     *
     * 노상주차장은 도로에 그려진 주차구획이라 차단기가 없다. 요금은 조례로 정한
     * 징수시간에만 부과하고, 그 시간이 지나면 그대로 대도 0원이다.
     * 이것이 한국 도심에서 공짜로 대는 가장 흔한 방법인데, 이 앱은 그걸 전부
     * '운영 종료' 회색으로 묻고 있었다. 청계천 일대 노상 주차장이 토요일 15시부터
     * 무료인데도 목록에 한 곳도 뜨지 않았다.
     *
     * 근거: 부천도시공사 안내(노상주차장 월~금 09:00~18:00 운영, 주말 무료),
     *       강동구청 청사 주차장 안내(평일 09~18시만 유료, 매일 18시~익일 09시 무료).
     *
     * 노외·부설은 제외한다. 차단기로 실제로 닫히는 곳이 섞여 있고, 데이터만으로는
     * 24시간 개방인지 야간 폐쇄인지 가릴 수 없다. 갔는데 못 대는 쪽이 더 나쁘다.
     */
    if (parking.type === '노상' && !BARRIER_HINT.test(parking.note ?? '')) {
      status = 'free'
      headline = '운영시간 외 — 요금을 받지 않아요'
      freeMinutes = duration
      offHoursFree = true
      reasons.push('노상주차장은 운영시간에만 요금을 받습니다 (' + hoursLabel + ').')
      reasons.push('도로변 주차구획이라 운영시간 밖에는 차단 없이 댈 수 있습니다.')
      reasons.push('다만 주차금지 표지·소화전·교차로 모퉁이는 시간과 무관하게 피하세요.')
    } else {
      status = 'closed'
      headline = hoursLabel
      reasons.push('선택한 시간은 운영시간이 아닙니다.')
    }
  } else if (priced.cost === null) {
    status = 'unknown'
    if (restriction) {
      /*
       * 금액을 모르는 게 아니라 시간 단위로 파는 상품이 아예 없는 곳이다.
       * 월정기·거주자우선 구획이 여기 해당한다(실측 143곳). 이런 곳을
       * '요금 미공개'로 적으면 전화해서 물어보면 댈 수 있는 것처럼 읽힌다.
       */
      headline = restriction + ' — 일반 차량은 이용할 수 없어요'
      reasons.push('시간 단위 주차를 받지 않는 곳입니다.')
    } else {
      headline = parking.tel ? '요금 미공개 — ' + parking.tel + ' 문의' : '요금이 공개되지 않은 유료 주차장'
      reasons.push('유료 주차장이지만 공공데이터에 금액이 비어 있어 계산할 수 없습니다.')
      reasons.push('무료라는 뜻이 아닙니다.')
      if (parking.tel) {
        reasons.push('관리기관(' + (parking.managedBy ?? '운영기관') + ')에 문의하면 확인할 수 있어요.')
      }
    }
  } else if (priced.cost === 0) {
    if (coveredByRules) {
      status = 'free'
      headline = isDeclaredFree ? '무료 주차장' : '이 시간대 전면 무료'
    } else if (exemptCovers) {
      // 면제시간 안에 들어와 0원이 된 경우 — 넘기면 처음부터 요금이 붙는다.
      status = 'conditional'
      headline = formatDurationShort(exemptMinutes) + ' 이내 무료 — ' + formatDurationShort(duration) + ' 주차 시 0원'
      reasons.push(formatDurationShort(exemptMinutes) + '을 넘기면 처음부터 요금이 붙습니다.')
    } else if (graceMinutes > 0) {
      // 무료 시간 한도 안에 들어와 0원이 된 경우 — 더 오래 대면 요금이 붙는다.
      status = 'conditional'
      headline =
        '최초 ' + formatDurationShort(graceMinutes) + ' 무료 — ' + formatDurationShort(duration) + ' 주차 시 0원'
      reasons.push(formatDurationShort(graceMinutes) + '을 넘기면 요금이 발생합니다.')
    } else {
      status = 'free'
      headline = isDeclaredFree ? '무료 주차장' : '요금 0원'
    }
  } else if (freeMinutes > 0) {
    status = 'conditional'
    headline = formatDurationShort(freeMinutes) + ' 무료 + ' + formatMoney(priced.cost)
  } else {
    status = 'paid'
    headline = formatDurationShort(duration) + ' 주차 시 ' + formatMoney(priced.cost)
  }

  /*
   * 전용 주차장은 '무료'가 아니라 '못 댄다'.
   *
   * 요금이 0원이어도 관광버스 전용 2면짜리 구간은 승용차 운전자의 답이 아니다.
   * 초록(완전 무료)에서 빼고 제한 내용을 그대로 뱃지에 띄워, '0원만' 필터에도 걸리지 않게 한다.
   */
  if (restriction && (status === 'free' || status === 'conditional')) {
    status = 'conditional'
    headline = restriction + ' — 일반 차량은 이용할 수 없어요'
  }

  // ── 근거 문구 ────────────────────────────────────────────────
  for (const r of ruleSet.used) reasons.push(r.label)
  for (const r of graceRules) if (!reasons.includes(r.label)) reasons.push(r.label)
  if (oper.assumed) reasons.push('운영시간 정보가 없어 24시간 개방으로 가정했습니다.')
  if (openMinutes > 0 && openMinutes < duration) {
    reasons.push('방문 구간 중 ' + formatDurationShort(duration - openMinutes) + '은 운영시간 밖입니다.')
  }

  // ── 무료 종료 시각 / 다음 무료 시작 시각 ────────────────────
  const hasAlways = rules.some((r) => r.kind === 'always')
  let freeUntil: Date | null = null
  let nextFreeAt: Date | null = null

  if (!hasAlways) {
    const containing = findContaining(ruleSet.intervals, startMin)
    if (containing) {
      freeUntil = minutesToDate(visitStart, containing.end)
      if (status === 'free' || status === 'conditional') {
        reasons.push(formatMinuteOfDay(containing.end) + '까지 무료')
      }
    } else {
      const next = ruleSet.intervals.find((it) => it.start > startMin)
      if (next) {
        nextFreeAt = minutesToDate(visitStart, next.start)
        if (status === 'paid') reasons.push(formatMinuteOfDay(next.start) + '부터 무료')
      }
    }
  }

  if (status === 'paid' && targetedRules.length > 0) {
    reasons.push(targetedRules.map((r) => r.label).join(' · '))
  }

  return {
    status,
    badge: restriction ?? pickBadge(status),
    headline,
    totalMinutes: duration,
    freeMinutes,
    cost: priced.cost,
    chargeableMinutes: chargeable,
    appliedRules: [...ruleSet.used, ...graceRules],
    targetedRules,
    reasons: Array.from(new Set(reasons)),
    nextFreeAt,
    freeUntil,
    dayType,
    isOpen: openMinutes > 0,
    estimated: priced.estimated || oper.assumed || ruleSet.inferred || offHoursFree,
    restriction,
  }
}

/** 정렬용 가중치 — 무료가 항상 위로 오게 한다. */
export const STATUS_ORDER: Record<ParkingStatus, number> = {
  free: 0,
  conditional: 1,
  paid: 2,
  unknown: 3,
  closed: 4,
}

export const DAY_TYPE_LABEL: Record<DayType, string> = {
  weekday: '평일',
  saturday: '토요일',
  holiday: '공휴일',
}
