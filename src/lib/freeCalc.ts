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
  return parts.length ? parts.join(' · ') : '요금 정보 없음'
}

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
    if (rule.kind === 'grace' || rule.kind === 'targeted') continue

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

  const rules = extractFreeRules(parking)
  const targetedRules = rules.filter((r): r is Extract<FreeRule, { kind: 'targeted' }> => r.kind === 'targeted')
  const graceRules = rules.filter((r): r is Extract<FreeRule, { kind: 'grace' }> => r.kind === 'grace')

  const oper = buildOperIntervals(parking, visitStart)
  const openInVisit = intersectAll(oper.intervals, visit)
  const openMinutes = totalLength(openInVisit)

  const ruleSet = buildRuleIntervals(rules, visitStart)
  const freeByRules = intersectAll(ruleSet.intervals, visit)

  // ── 최초 N분 무료 ────────────────────────────────────────
  const graceMinutes = graceRules.reduce((max, r) => Math.max(max, r.minutes), 0)
  // 요금표에 이미 반영된 무료 시간은 요금 계산에서 다시 빼면 안 된다.
  const graceInFee = parking.fee.basicCharge === 0 && parking.fee.basicTime >= graceMinutes
  const billableGrace = graceInFee ? 0 : graceMinutes

  const graceInterval = (minutes: number): Interval[] =>
    minutes > 0 ? [{ start: startMin, end: Math.min(startMin + minutes, visit.end) }] : []

  const freeForCost = union([...freeByRules, ...graceInterval(billableGrace)])
  const freeForDisplay = union([...freeByRules, ...graceInterval(graceMinutes)])

  const freeInOpen = totalLength(intersectLists(freeForCost, openInVisit))
  const nonGraceInOpen = totalLength(intersectLists(freeByRules, openInVisit))
  // 표시용 무료 시간도 운영시간 안에서만 센다 — 문이 닫혀 있으면 '무료 2시간'이 아니라 0분이다.
  const freeMinutes = totalLength(intersectLists(freeForDisplay, openInVisit))

  const chargeable = Math.max(0, openMinutes - freeInOpen)

  const isDeclaredFree = parking.chargeType === '무료'
  const priced = isDeclaredFree ? { cost: 0, estimated: false } : computeCost(parking.fee, chargeable)

  const reasons: string[] = []
  let status: ParkingStatus
  let headline: string

  const coveredByRules = openMinutes > 0 && nonGraceInOpen >= openMinutes - 0.5

  // ── 상태 결정 ────────────────────────────────────────────────
  if (openMinutes === 0) {
    status = 'closed'
    const range = parking.hours[dayType]
    headline = range
      ? formatMinuteOfDay(range.open) + '~' + formatMinuteOfDay(range.close) + ' 운영'
      : '해당 요일 미운영'
    reasons.push('선택한 시간은 운영시간이 아닙니다.')
  } else if (priced.cost === null) {
    status = 'unknown'
    headline = '요금이 공개되지 않은 유료 주차장'
    reasons.push('원본 데이터에 요금이 비어 있어 금액을 계산할 수 없습니다.')
    reasons.push('무료라는 뜻이 아닙니다 — 현장 안내판을 확인하세요.')
  } else if (priced.cost === 0) {
    if (coveredByRules) {
      status = 'free'
      headline = isDeclaredFree ? '무료 주차장' : '이 시간대 전면 무료'
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
    badge: pickBadge(status),
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
    estimated: priced.estimated || oper.assumed || ruleSet.inferred,
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
