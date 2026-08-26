import type { DayType, FreeRule, OperRange, Parking } from '@/types/parking'
import { isPublicHoliday } from './holidays'

export const DAY_MINUTES = 1440

/** "0900" | "09:00" | "9" | "2400" → 00:00 기준 경과 분. 파싱 실패 시 null. */
export function parseHhmm(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim()
  if (!s || /^(미운영|없음|-|해당없음|N\/?A)$/i.test(s)) return null

  const colon = s.match(/^(\d{1,2})\s*:\s*(\d{1,2})$/)
  if (colon) {
    const h = Number(colon[1])
    const m = Number(colon[2])
    if (h > 24 || m > 59) return null
    return h * 60 + m
  }

  const digits = s.replace(/[^0-9]/g, '')
  if (!digits) return null
  if (digits.length <= 2) {
    const h = Number(digits)
    return h <= 24 ? h * 60 : null
  }
  const padded = digits.padStart(4, '0').slice(0, 4)
  const h = Number(padded.slice(0, 2))
  const m = Number(padded.slice(2, 4))
  if (h > 24 || m > 59) return null
  return h * 60 + m
}

/**
 * 운영 시작/종료 분으로 OperRange 를 만든다.
 * - 0000-2400, 0900-0900 → 24시간 개방
 * - close <= open → 자정을 넘기는 운영(예: 20:00~익일 02:00)
 * - 둘 다 비어 있으면 null (= 정보 없음. 운영요일과 함께 판단해야 한다)
 */
export function buildRange(openMin: number | null, closeMin: number | null): OperRange | null {
  if (openMin === null && closeMin === null) return null
  const open = openMin ?? 0
  let close = closeMin ?? DAY_MINUTES

  if (open === close) {
    // 0000-0000 / 0900-0900 처럼 동일값이면 표준데이터 관례상 24시간 개방으로 본다.
    return { open: 0, close: DAY_MINUTES, allDay: true }
  }
  if (close < open) close += DAY_MINUTES

  const allDay = close - open >= DAY_MINUTES - 1
  return { open, close, allDay }
}

export function getDayType(d: Date): DayType {
  if (isPublicHoliday(d) || d.getDay() === 0) return 'holiday'
  if (d.getDay() === 6) return 'saturday'
  return 'weekday'
}

export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes()
}

/** 방문 시작 시각의 자정(00:00)을 기준점으로 삼는다. 모든 분 계산은 이 기준의 오프셋. */
export function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

export function minutesToDate(base: Date, minutes: number): Date {
  return new Date(startOfDay(base).getTime() + minutes * 60_000)
}

export function formatMinuteOfDay(minutes: number): string {
  const norm = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES
  const h = Math.floor(norm / 60)
  const m = norm % 60
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0')
}

export function formatDurationShort(minutes: number): string {
  if (minutes < 60) return minutes + '분'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? h + '시간' : h + '시간 ' + m + '분'
}

/**
 * 운영요일 문자열("평일+토요일+공휴일", "매일" 등)로 해당 요일 구분에 문을 여는지 판단한다.
 * 운영시간 컬럼이 비어 있을 때 '24시간 개방'과 '그날은 미운영'을 가르는 유일한 단서다.
 */
export function operatesOn(operDay: string | undefined, dayType: DayType): boolean {
  if (!operDay) return true
  const s = operDay.replace(/\s/g, '')
  if (/매일|연중|상시|전일/.test(s)) return true

  // 한국어에는 단어 경계가 없어 한 글자 패턴('일', '토')은 '평일'·'토요일' 안에서 오탐한다.
  // 반드시 완전한 낱말만 매칭해야 "평일+토요일" 이 공휴일 운영으로 잘못 읽히지 않는다.
  switch (dayType) {
    case 'weekday':
      return /평일|주중|월~금|[월화수목금]요일/.test(s)
    case 'saturday':
      return /토요일|주말/.test(s)
    default:
      return /공휴일|일요일|휴일|주말/.test(s)
  }
}

function toMinutes(value: number, unit: string): number {
  return /시간/.test(unit) ? value * 60 : value
}

/**
 * 이미 해석한 구간은 제어문자(U+0001)로 덮는다.
 * 공백으로 덮으면 뒤따르는 정규식의 `\s*` 가 마스킹 구간을 가로질러 엉뚱한 매칭을 만든다
 * (예: "평일 19시 이후 무료 개방" → 19시 규칙 처리 후 "평일 … 개방" 이 '평일 전일 무료'로 잘못 잡힘).
 */
const MASK = '\u0001'

function mask(text: string, index: number, length: number): string {
  return text.slice(0, index) + MASK.repeat(length) + text.slice(index + length)
}

/** 정규식을 반복 적용하며 매칭 구간을 마스킹한다. 무한 루프 방지를 위해 상한을 둔다. */
function scan(text: string, re: RegExp, onMatch: (m: RegExpExecArray) => void): string {
  let working = text
  for (let guard = 0; guard < 12; guard++) {
    re.lastIndex = 0
    const m = re.exec(working)
    if (!m) break
    onMatch(m)
    working = mask(working, m.index, m[0].length)
  }
  return working
}

/*
 * '개방' 은 무료 신호가 아니다.
 *
 * "토+일+공휴일 개방", "월+공휴일개방", "토+일+공휴일 개방<밤 11시 주차장 폐쇄>" 처럼
 * 그날 문을 연다(운영한다)는 뜻으로 쓰인다. 이걸 무료로 읽어 부천시 노상 22곳이
 * 일요일에 초록 '완전 무료'로 나오고 있었다. 실제로는 요금을 받는 곳이다.
 * '무료개방' 은 아래 TAIL 이 '개방' 을 먹으므로 그대로 잡힌다.
 */
/** 무료 표현 뒤에 흔히 붙는 군더더기까지 함께 먹어 치워 잔여 텍스트를 깨끗하게 만든다. */
const TAIL = '(?:\\s*(?:개방|운영|가능|적용))?'

const DAYTYPE_WORD: Record<string, DayType[]> = {
  평일: ['weekday'],
  토요일: ['saturday'],
  주말: ['saturday', 'holiday'],
  법정공휴일: ['holiday'],
  공휴일: ['holiday'],
  휴일: ['holiday'],
}

/**
 * '일요일'은 요일 규칙으로 따로 뽑는다.
 *
 * dayType 의 'holiday' 는 일요일과 공휴일을 함께 묶는다. 그래서 '일요일 무료'를
 * holiday 로 읽으면 설·추석에도 무료라고 안내하게 된다. 조례에 "일요일은 운영하지
 * 아니한다"면서 공휴일에는 요금을 받는 지자체가 실제로 있다
 * (부산 영도구·부산진구·연제구). 특기사항에 '일요일'만 적힌 주차장이 전국 93곳이다.
 */
const WEEKDAY_WORD: Record<string, number[]> = {
  일요일: [0],
  월요일: [1],
  화요일: [2],
  수요일: [3],
  목요일: [4],
  금요일: [5],
}

const TARGET_WORDS = [
  '경차',
  '장애인',
  '국가유공자',
  '유공자',
  '저공해',
  '친환경',
  '전기차',
  '다자녀',
  '임산부',
  '고엽제',
  '보훈',
]

/**
 * 특정 차종·대상만 댈 수 있는 주차장인지 본다.
 *
 * "관광버스 전용" 2면짜리 노상 구간을 승용차 운전자에게 '완전 무료'로 보여주면
 * 갔다가 못 대고 돌아온다. 요금이 0원인 것과 내가 댈 수 있는 것은 다른 문제다.
 */
export function extractRestriction(note: string | undefined): string | undefined {
  if (!note) return undefined
  const cleaned = note.replace(/\s+/g, ' ')

  /*
   * 월정기·거주자우선 구획은 방문자가 시간 단위로 댈 수 있는 곳이 아니다.
   *
   * 이런 곳은 시간 요금 칸이 비어 있어 '요금 미공개'로 분류됐지만, 사실은 금액을
   * 모르는 게 아니라 시간 주차라는 상품 자체가 없는 것이다(실측 84곳).
   * "월정기 전용", "거주자주차제 전용" 처럼 단어가 바로 붙지 않는 표현이 많아
   * 아래 일반 패턴으로는 잡히지 않으므로 따로 본다.
   *
   * "주간만사용가능(야간_거주자우선주차장)" 처럼 낮에는 일반 개방하는 곳은 제외한다.
   */
  if (!/주간만|주간\s*개방/.test(cleaned)) {
    if (/(월\s*정기|정기권)\s*(?:주차제?\s*)?(?:전용|만\s*운영|만\s*가능)/.test(cleaned))
      return '월정기 전용'
    if (/거주자\s*(?:우선|주차제)|거주민?\s*(?:월정기|우선)/.test(cleaned)) return '거주자 전용'
  }

  const m =
    /(관광버스|대형버스|버스|화물차|화물|이륜차|이륜|오토바이|자전거|경차|전기차|장애인|택시|거주자|주민|입주자|직원|내부)\s*(?:차량\s*)?(전용|만\s*가능|에\s*한함|한정)/.exec(cleaned)
  return m ? m[1] + ' 전용' : undefined
}

/**
 * 요금 필드와 특기사항(spcmnt) 에서 '무료 규칙'을 추출한다.
 *
 * 공공데이터의 특기사항은 자유 서술이라 100% 정형화가 불가능하다.
 * 확실한 표현만 규칙으로 승격하고, 추론이 섞인 항목에는 inferred 플래그를 달아
 * UI 가 '추정' 배지를 붙일 수 있게 한다.
 *
 * 해석 순서가 중요하다: 좁은 표현(시간대 → 최초 N분 → 대상)부터 먹어 치운 뒤
 * 마지막에 남은 문장으로 요일 규칙을 판단해야 "평일 19시 이후 무료" 같은 문장이
 * "평일 전일 무료"로 잘못 확장되지 않는다.
 */
export function extractFreeRules(p: Parking): FreeRule[] {
  const rules: FreeRule[] = []

  if (p.chargeType === '무료') {
    rules.push({ kind: 'always', label: '무료 주차장' })
  }

  const { basicTime, basicCharge, addCharge } = p.fee
  // 유료로 등록됐는데 금액이 비어 있는 것을 '요금 0원'으로 승격하면 안 된다.
  // 지자체가 금액을 입력하지 않은 것일 뿐이며, freeCalc 가 '정보 부족'으로 처리한다.
  if (basicCharge === 0 && basicTime > 0 && addCharge > 0) {
    // 요금표 자체가 '최초 N분 0원' 구조인 경우. 요금 계산에서 이미 반영되므로
    // freeCalc 는 이 규칙을 표시용으로만 쓴다(중복 차감 방지).
    rules.push({
      kind: 'grace',
      minutes: basicTime,
      label: '최초 ' + formatDurationShort(basicTime) + ' 무료',
    })
  }

  let text = (p.note ?? '').replace(/\s+/g, ' ')
  if (!text) return dedupeRules(rules)

  // 요일 한정어 존재 여부는 마스킹 전에 한 번만 본다(마스킹 후에는 판단이 흔들린다).
  const hasDayWord = Object.keys(DAYTYPE_WORD).some((w) => text.includes(w))

  /*
   * 0) 구매 조건이 붙은 무료는 '누구나 무료'가 아니다.
   *
   * "쇼핑금액 1만원 이상시 2시간 무료주차" 를 그냥 두면 아래 5) 가 최초 2시간 무료로
   * 읽어, 아무것도 사지 않아도 0원이라고 알려 준다. 대형마트·아울렛 주차 안내에 아주
   * 흔한 표현이라 그대로 두면 오탐이 무더기로 생긴다.
   *
   * 조건이 걸린 절은 통째로 덮고 대상 한정(targeted)으로만 남긴다. 절 안에 조건 없는
   * 무료 표현이 섞여 있어도 함께 덮는데, 그 값은 요금 칸(기본시간 0원)이 들고 있으므로
   * 잃는 것이 없다. 못 읽는 쪽이 공짜라고 잘못 말하는 쪽보다 낫다.
   */
  {
    /*
     * 조건부 무료를 알아보는 표현들.
     *  - 구매/영수증/금액 : "1만원 이상 구매시 2시간 무료"
     *  - 강좌/관람/대관   : "강좌 이용시 3시간 무료" (문화센터·영화관 제휴)
     *  - 최대 N시간 무료  : 조건을 채웠을 때의 상한이지 기본 제공이 아니다
     */
    const PURCHASE =
      /[0-9,]+\s*만?\s*원\s*이상|구매\s*시|구매고객|영수증|쇼핑\s*금액|강좌|수강|문화센터|관람|대관|회원|멤버십|최대\s*[0-9]+\s*(?:분|시간)\s*무료/
    let cursor = 0
    /*
     * 쉼표로는 자르지 않는다. "1만원 이상 구매시, 2시간 무료" 를 갈라 놓으면
     * 조건은 앞 조각에 남고 혜택만 뒤 조각에 남아 그대로 통과한다.
     */
    for (const piece of text.split(/(\s\/\s|[;\u00b7\n])/)) {
      const start = cursor
      cursor += piece.length
      if (!piece || !PURCHASE.test(piece) || !/무료|면제/.test(piece)) continue
      rules.push({
        kind: 'targeted',
        target: '구매',
        // 상세 화면이 조건을 그대로 보여 주므로 넉넉히 남긴다.
        label: piece.trim().replace(/^[-*·■※]+/, '').trim().slice(0, 140),
      })
      text = mask(text, start, piece.length)
    }
  }

  // 1) "20시~08시 무료", "20:00 ~ 익일 08:00 무료"
  text = scan(
    text,
    new RegExp(
      '(\\d{1,2})(?::(\\d{2}))?\\s*시?\\s*(?:~|-|–|부터)\\s*(?:익일\\s*|다음날\\s*)?(\\d{1,2})(?::(\\d{2}))?\\s*시?\\s*(?:까지)?\\s*(?:무료|면제)' +
        TAIL,
      'g',
    ),
    (m) => {
      const from = Number(m[1]) * 60 + Number(m[2] ?? 0)
      const to = Number(m[3]) * 60 + Number(m[4] ?? 0)
      rules.push({
        kind: 'window',
        from,
        to,
        label: formatMinuteOfDay(from) + '~' + formatMinuteOfDay(to) + ' 무료',
      })
    },
  )

  // 2) "19시 이후 무료", "18:30부터 무료"
  text = scan(
    text,
    new RegExp('(\\d{1,2})(?::(\\d{2}))?\\s*시?\\s*(?:이후|부터)\\s*(?:는\\s*)?(?:무료|면제)' + TAIL, 'g'),
    (m) => {
      const from = Number(m[1]) * 60 + Number(m[2] ?? 0)
      rules.push({
        kind: 'window',
        from,
        to: DAY_MINUTES,
        label: formatMinuteOfDay(from) + ' 이후 무료',
      })
    },
  )

  // 3) "08시 이전 무료"
  text = scan(
    text,
    new RegExp('(\\d{1,2})(?::(\\d{2}))?\\s*시\\s*(?:이전|까지)\\s*(?:는\\s*)?(?:무료|면제)' + TAIL, 'g'),
    (m) => {
      const to = Number(m[1]) * 60 + Number(m[2] ?? 0)
      rules.push({
        kind: 'window',
        from: 0,
        to,
        label: formatMinuteOfDay(to) + ' 이전 무료',
      })
    },
  )

  // 4) "야간 무료" / "심야 무료" — 시각이 명시되지 않아 추정값(20:00~08:00)을 쓴다.
  text = scan(text, new RegExp('(?:야간|심야)\\s*(?:에는|시간대?)?\\s*(?:무료|면제)' + TAIL, 'g'), () => {
    rules.push({
      kind: 'window',
      from: 20 * 60,
      to: 8 * 60,
      inferred: true,
      label: '야간 무료(20:00~08:00 추정)',
    })
  })

  // 4-1) "면제시간 10분" — N분 안에 나가면 전액 무료. 시간을 빼 주는 grace 와 다르다.
  text = scan(text, /면제\s*시간\s*(\d{1,3})\s*분/g, (m) => {
    const minutes = Number(m[1])
    if (minutes > 0 && minutes < DAY_MINUTES) {
      rules.push({ kind: 'exempt', minutes, label: formatDurationShort(minutes) + ' 이내 무료' })
    }
  })

  // 5) "최초 30분 무료", "1시간 무료"
  text = scan(
    text,
    new RegExp('(?:최초|처음|기본)?\\s*(\\d{1,3})\\s*(분|시간)\\s*(?:까지|이내|동안)?\\s*(?:무료|면제)' + TAIL, 'g'),
    (m) => {
      const minutes = toMinutes(Number(m[1]), m[2] as string)
      if (minutes > 0 && minutes < DAY_MINUTES) {
        rules.push({ kind: 'grace', minutes, label: '최초 ' + formatDurationShort(minutes) + ' 무료' })
      } else if (minutes >= DAY_MINUTES && !hasDayWord) {
        // "24시간 무료"는 '최초 24시간만 무료'가 아니라 '상시 무료'라는 뜻이다.
        // 다만 "일요일 24시간 무료"처럼 요일이 붙으면 상시로 승격하면 안 되므로,
        // 요일 표현이 하나라도 있는 특기사항에서는 아무 규칙도 만들지 않는다
        // (무료를 놓치는 쪽이 유료를 무료로 잘못 표시하는 쪽보다 안전하다).
        rules.push({ kind: 'always', label: '상시 무료' })
      }
    },
  )

  // 6~7) 남은 문장을 절(clause) 단위로 훑는다.
  //
  //  정규식 한 방으로 잡지 않는 이유: "경차 및 저공해차량 무료" 처럼 한 절에 대상이 여러 개면
  //  앞선 매칭이 뒤 단어까지 삼켜 버려 하나만 남는다. 절 안에 '무료/면제'가 있는지만 확인하고
  //  해당 절에 등장하는 사전 단어를 전부 거두는 편이 정확하다.
  let carried = ''
  for (const fragment of splitClauses(text)) {
    const clause = carried ? carried + ' ' + fragment : fragment

    if (!/(무료|면제|100%)/.test(clause)) {
      // "일요일+공휴일 무료개방" 처럼 목록의 앞 항목만 떨어져 나오는 형태가 있다.
      // 사전 단어로만 이뤄진 조각은 버리지 않고 다음 절에 이어 붙인다.
      carried = isBareListItem(fragment) ? clause : ''
      continue
    }
    carried = ''

    // 6) 대상 한정 무료 — 모든 방문자에게 적용되지 않으므로 별도 분류
    const targets = pickWords(clause, TARGET_WORDS)
    for (const t of targets) rules.push({ kind: 'targeted', target: t, label: t + ' 무료' })

    // 7) 요일 규칙. 대상 한정 문구가 섞인 절은 '누구나 무료'가 아니므로 건너뛴다.
    if (targets.length > 0) continue

    /*
     * 요일은 절 전체가 아니라 항목별로 본다.
     *
     * "무료개방(평일 야간+토\u00b7일\u00b7공휴일)" 을 한 덩어리로 읽으면 '평일 종일 무료'가 되어
     * 평일 낮에도 초록 무료로 표시된다(실측 24곳). 실제로는 평일은 야간만 무료다.
     * 시각을 특정하지 못한 시간 한정어가 붙은 항목은 종일 무료로 승격하지 않는다.
     */
    // ' / ' 도 항목 구분자다. 마스킹된 안내문 옆에 붙은 깨끗한 규칙까지 함께
    // 건너뛰지 않도록 잘라 준다.
    for (const item of clause.split(/\s\/\s|[+\u00b7,]/)) {
      // 이미 시간대 규칙으로 해석돼 마스킹된 항목은 다시 세지 않는다.
      if (item.includes(MASK)) continue
      if (/(야간|심야|주간|오전|오후)/.test(item)) continue

      const words = pickWords(item, Object.keys(DAYTYPE_WORD))
      const days = new Set<DayType>()
      for (const word of words) for (const d of DAYTYPE_WORD[word] as DayType[]) days.add(d)
      if (days.size > 0) {
        rules.push({ kind: 'dayType', days: [...days], label: words.join('\u00b7') + ' 무료' })
      }

      const dowWords = pickWords(item, Object.keys(WEEKDAY_WORD))
      const dow = new Set<number>()
      for (const word of dowWords) for (const n of WEEKDAY_WORD[word] as number[]) dow.add(n)
      if (dow.size > 0) {
        rules.push({ kind: 'weekdays', days: [...dow], label: dowWords.join('·') + ' 무료' })
      }
    }
  }


  // 8) 별도 조건 없이 "무료" 만 적힌 경우 (예: "전면 무료 개방")
  if (rules.length === 0 && /(전면|전일|상시|24시간)\s*무료/.test(text)) {
    rules.push({ kind: 'always', label: '상시 무료' })
  }

  return dedupeRules(rules)
}

/**
 * 특기사항을 절 단위로 나눈다.
 *
 * '+' 를 구분자에 넣는 이유: 특기사항이 있는 곳의 절반(실측 1,271곳)이
 * "경차+저공해 50프로 할인+일요일+공휴일 무료개방" 처럼 '+' 로 항목을 잇는다.
 * 이걸 한 절로 보면 맨 앞의 '경차'가 대상 한정으로 잡혀, 뒤에 붙은 요일 무료 규칙까지
 * 통째로 버려진다(실측 74곳이 이렇게 무료를 잃고 있었다).
 *
 * 다만 괄호 안의 '+' 는 한 항목 안의 목록이므로 자르지 않는다.
 */
function splitClauses(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let buf = ''

  for (const ch of text) {
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1)
    else if (depth === 0 && /[,.;\u00b7+]/.test(ch)) {
      out.push(buf)
      buf = ''
      continue
    }
    buf += ch
  }
  out.push(buf)
  return out
}

// 요일 단어(일요일 등)도 목록 항목이 될 수 있다. 빠뜨리면 "일요일+공휴일 무료개방"
// 에서 앞 항목이 버려져 규칙이 '공휴일'만 남는다.
const LIST_WORDS = [...Object.keys(DAYTYPE_WORD), ...Object.keys(WEEKDAY_WORD), ...TARGET_WORDS].sort(
  (a, b) => b.length - a.length,
)

/** 사전 단어와 이음말로만 이뤄진 조각인가 — "일요일", "경차ㆍ장애인" 같은 목록의 한 항목. */
function isBareListItem(fragment: string): boolean {
  let rest = fragment
  let matched = false
  for (const word of LIST_WORDS) {
    if (!rest.includes(word)) continue
    rest = rest.split(word).join(' ')
    matched = true
  }
  return matched && /^[\s\u00b7\u318d/및과와()[\]]*$/.test(rest)
}

/**
 * 절 안에 등장하는 사전 단어를 등장 순서대로 거둔다.
 * 긴 단어에 포함되는 짧은 단어('공휴일' ⊂ '법정공휴일')는 중복으로 세지 않는다.
 */
function pickWords(clause: string, dictionary: string[]): string[] {
  const found = dictionary
    .filter((w) => clause.includes(w))
    .sort((a, b) => clause.indexOf(a) - clause.indexOf(b) || b.length - a.length)

  const out: string[] = []
  for (const word of found) {
    if (out.some((w) => w.includes(word) || word.includes(w))) continue
    out.push(word)
  }
  return out
}

function dedupeRules(rules: FreeRule[]): FreeRule[] {
  const seen = new Set<string>()
  const out: FreeRule[] = []
  for (const r of rules) {
    const key = JSON.stringify(r)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}
