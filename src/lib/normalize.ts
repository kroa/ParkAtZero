import type { DayType, Parking } from '@/types/parking'
import { buildRange, extractRestriction, operatesOn, parseHhmm } from './timeRules'
import { findCorrection } from '@/data/corrections'

/**
 * 공공데이터포털 '전국주차장정보표준데이터' 레코드를 앱 내부 모델로 정규화한다.
 *
 * 같은 데이터셋이라도 배포 경로(odcloud REST / 파일 다운로드 CSV→JSON / 지자체 개별 API)에 따라
 * 컬럼명이 영문 카멜케이스와 한글 헤더를 오간다. 그래서 필드마다 별칭 목록을 두고 첫 번째로
 * 값이 잡히는 것을 쓴다. (weekdayOperColseHhmm 의 'Colse' 오타는 원본 스펙 그대로다.)
 */
type Raw = Record<string, unknown>

function pick(row: Raw, keys: readonly string[]): unknown {
  for (const k of keys) {
    const v = row[k]
    if (v !== undefined && v !== null && String(v).trim() !== '') return v
  }
  return undefined
}

function num(value: unknown, fallback = 0): number {
  if (value === undefined || value === null) return fallback
  const cleaned = String(value).replace(/[^0-9.-]/g, '')
  if (!cleaned) return fallback
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : fallback
}

function str(value: unknown, fallback = ''): string {
  if (value === undefined || value === null) return fallback
  const s = String(value).trim()
  return s === '' ? fallback : s
}

const FIELD = {
  id: ['prkplceNo', '주차장관리번호', 'id', 'parkingCode'],
  name: ['prkplceNm', '주차장명', 'name'],
  type: ['prkplceType', '주차장유형', 'type'],
  ownership: ['prkplceSe', '주차장구분', 'ownership'],
  roadAddr: ['rdnmadr', '소재지도로명주소', 'roadAddress'],
  lotAddr: ['lnmadr', '소재지지번주소', 'address'],
  capacity: ['prkcmprt', '주차구획수', 'capacity'],
  operDay: ['operDay', '운영요일'],
  weekdayOpen: ['weekdayOperOpenHhmm', '평일운영시작시각'],
  weekdayClose: ['weekdayOperColseHhmm', 'weekdayOperCloseHhmm', '평일운영종료시각'],
  satOpen: ['satOperOperOpenHhmm', 'satOperOpenHhmm', '토요일운영시작시각'],
  satClose: ['satOperCloseHhmm', '토요일운영종료시각'],
  holOpen: ['holidayOperOpenHhmm', '공휴일운영시작시각'],
  // 실제 API 가 쓰는 이름은 holidayCloseOpenHhmm 이다(오탈자로 보이지만 원본 스펙 그대로).
  // 이걸 빠뜨리면 공휴일 종료시각을 못 읽어 전부 24시간 운영으로 오해한다.
  holClose: ['holidayCloseOpenHhmm', 'holidayCloseHhmm', 'holidayOperCloseHhmm', '공휴일운영종료시각'],
  chargeInfo: ['parkingchrgeInfo', '요금정보', 'chargeType'],
  basicTime: ['basicTime', '주차기본시간'],
  basicCharge: ['basicCharge', '주차기본요금'],
  addTime: ['addUnitTime', '추가단위시간'],
  addCharge: ['addUnitCharge', '추가단위요금'],
  dayTicketTime: ['dayCmmtktAdjTime', '1일주차권요금적용시간'],
  dayTicket: ['dayCmmtkt', '1일주차권요금'],
  monthTicket: ['monthCmmtkt', '월정기권요금'],
  payment: ['metpay', '결제방법'],
  note: ['spcmnt', '특기사항'],
  tel: ['phoneNumber', '전화번호'],
  managedBy: ['institutionNm', '관리기관명'],
  openDates: ['pzOpenDates'],
  lat: ['latitude', '위도', 'lat'],
  lng: ['longitude', '경도', 'lng'],
  updatedAt: ['referenceDate', '데이터기준일자'],
  // 보완표(data/supplements.json)에서만 오는 값. 표준데이터에는 없다.
  sourceUrl: ['pzSource'],
  sourceVerifiedOn: ['pzVerifiedOn'],
} as const

function normalizeChargeType(raw: string): Parking['chargeType'] {
  const s = raw.replace(/\s/g, '')
  if (!s) return '알수없음'
  if (s.includes('혼합')) return '혼합'
  if (s.includes('무료')) return '무료'
  if (s.includes('유료')) return '유료'
  return '알수없음'
}

/** 한 건 정규화. 좌표가 없으면 지도에 못 올리므로 null 을 돌려 걸러낸다. */
export function normalizeParking(row: Raw, index: number): Parking | null {
  const lat = num(pick(row, FIELD.lat), NaN)
  const lng = num(pick(row, FIELD.lng), NaN)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  // 대한민국 대략 경계 밖 좌표는 오염 데이터로 본다.
  if (lat < 32 || lat > 39.5 || lng < 124 || lng > 132.5) return null

  const name = str(pick(row, FIELD.name))
  if (!name) return null

  const operDayRaw = str(pick(row, FIELD.operDay)) || undefined

  /*
   * 00:00-00:00 은 두 가지 뜻으로 쓰인다.
   *
   * buildRange 는 시작과 끝이 같으면 '24시간 개방'으로 읽는다(0900-0900 같은 표기가
   * 실제로 그 뜻이다). 그런데 지자체 상당수는 '그날은 운영하지 않는다'를 00:00-00:00
   * 으로 적는다. 성남도시개발공사 노상 66곳이 그렇다 — 운영요일은 '평일'인데
   * 토요일·공휴일 칸이 00:00-00:00 이고, 공사 안내는 "토·일·공휴일 무료개방"이다.
   *
   * 두 뜻을 가르는 신호는 운영요일이다. 운영요일이 그날을 빼고 있으면 미운영이 맞다.
   * 그대로 두면 전국 1,369곳이 쉬는 날에도 24시간 유료로 안내된다(공휴일 1,358곳).
   */
  const closedByOperDay = (open: number | null, close: number | null, dayType: DayType) =>
    open === 0 && close === 0 && Boolean(operDayRaw) && !operatesOn(operDayRaw, dayType)

  const range = (openRaw: unknown, closeRaw: unknown, dayType: DayType) => {
    const open = parseHhmm(openRaw)
    const close = parseHhmm(closeRaw)
    if (closedByOperDay(open, close, dayType)) return null
    return buildRange(open, close)
  }

  const weekday = range(pick(row, FIELD.weekdayOpen), pick(row, FIELD.weekdayClose), 'weekday')
  const saturday = range(pick(row, FIELD.satOpen), pick(row, FIELD.satClose), 'saturday')
  const holiday = range(pick(row, FIELD.holOpen), pick(row, FIELD.holClose), 'holiday')

  const dayTicket = num(pick(row, FIELD.dayTicket))
  const monthTicket = num(pick(row, FIELD.monthTicket))
  const note = str(pick(row, FIELD.note)) || undefined
  const managedBy = str(pick(row, FIELD.managedBy)) || undefined

  // 특기사항에 적혀 있으면 그것을 쓰고, 비어 있으면 확인된 보정표로 채운다.
  /*
   * pwdbsPpkZoneYn 은 '장애인전용주차구역 보유 여부'다.
   * 주차장 전체가 장애인 전용이라는 뜻이 아니라 그런 구획을 갖췄다는 표시이며,
   * 전국 4,825곳(27%)이 Y다. 이걸 이용 제한으로 읽으면 일반 주차장이 무더기로 막힌다.
   * 이용 제한이 아니라 편의시설 정보이므로 restriction 에 쓰지 않는다.
   */
  const chargeType = normalizeChargeType(str(pick(row, FIELD.chargeInfo)))
  const fee = {
    basicTime: num(pick(row, FIELD.basicTime)),
    basicCharge: num(pick(row, FIELD.basicCharge)),
    addTime: num(pick(row, FIELD.addTime)),
    addCharge: num(pick(row, FIELD.addCharge)),
    dayTicketTime: num(pick(row, FIELD.dayTicketTime)) || undefined,
    dayTicket: dayTicket || undefined,
    monthTicket: monthTicket || undefined,
  }

  /*
   * 월정기권 금액만 있고 시간 주차 상품이 아예 없는 곳(실측 59곳).
   *
   * 기본시간·추가단위시간까지 전부 0 이면 시간 단위로 파는 상품이 없다는 뜻이다.
   * 지자체가 금액 입력을 빠뜨린 것과 다르다. 이런 곳을 '요금 미공개'로 두면 방문자가
   * 갈 수 있는 곳처럼 보이는데, 실제로는 월정기 계약자만 댈 수 있다.
   * 서울 도봉구 공영주차장이 대표적이다(월 50,000원, 시간요금 없음).
   */
  const monthPassOnly =
    chargeType !== '무료' &&
    monthTicket > 0 &&
    fee.basicTime === 0 &&
    fee.basicCharge === 0 &&
    fee.addTime === 0 &&
    fee.addCharge === 0 &&
    !fee.dayTicket

  const restriction =
    extractRestriction(note) ??
    findCorrection(name, managedBy)?.restriction ??
    (monthPassOnly ? '월정기 전용' : undefined)

  /*
   * 관리번호(prkplceNo)는 고유하지 않다. 지자체마다 자체 번호를 붙여서 서로 겹친다.
   * 실제로 '116-2-000002' 하나에 구로3동 마을공동·천왕역·동구로가 함께 달려 있다.
   * 이 값을 그대로 id 로 쓰면 카드를 골랐을 때 엉뚱한 주차장의 상세가 열린다.
   * 좌표를 섞어 고유하게 만든다 — 원본이 같으면 id 도 같아 화면 상태가 흔들리지 않는다.
   */
  const baseId = str(pick(row, FIELD.id), 'pz-' + index)
  const id = baseId + '@' + lat.toFixed(5) + ',' + lng.toFixed(5)

  return {
    id,
    name,
    type: str(pick(row, FIELD.type), '기타'),
    ownership: str(pick(row, FIELD.ownership), '기타'),
    address: str(pick(row, FIELD.roadAddr)) || str(pick(row, FIELD.lotAddr), '주소 정보 없음'),
    lat,
    lng,
    capacity: num(pick(row, FIELD.capacity)),
    chargeType,
    operDay: str(pick(row, FIELD.operDay)) || undefined,
    hours: { weekday, saturday, holiday },
    fee,
    note,
    restriction,
    tel: str(pick(row, FIELD.tel)) || undefined,
    sourceUrl: str(pick(row, FIELD.sourceUrl)) || undefined,
    sourceVerifiedOn: str(pick(row, FIELD.sourceVerifiedOn)) || undefined,
    openDates: readOpenDates(pick(row, FIELD.openDates)),
    payment: str(pick(row, FIELD.payment)) || undefined,
    managedBy,
    updatedAt: str(pick(row, FIELD.updatedAt)) || undefined,
  }
}

/**
 * 특정 날짜에만 여는 주차장의 개방일 목록을 읽는다.
 *
 * 설·추석 연휴에만 개방하는 곳이라 값이 있으면 그 날짜에만 결과에 넣는다.
 * 배열로도, 쉼표로 이어 붙인 문자열로도 올 수 있다.
 */
function readOpenDates(raw: unknown): string[] | undefined {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(',')
  const dates = list
    .map((d) => String(d).trim())
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
  return dates.length > 0 ? [...new Set(dates)].sort() : undefined
}

/** 배열/odcloud 응답({data:[]})/공공API 응답({response:{body:{items:[]}}}) 어느 형태든 받아낸다. */
export function extractRows(payload: unknown): Raw[] {
  if (Array.isArray(payload)) return payload as Raw[]
  if (!payload || typeof payload !== 'object') return []
  const obj = payload as Raw

  if (Array.isArray(obj.data)) return obj.data as Raw[]
  if (Array.isArray(obj.records)) return obj.records as Raw[]
  if (Array.isArray(obj.items)) return obj.items as Raw[]

  const response = obj.response as Raw | undefined
  const body = response?.body as Raw | undefined
  const items = body?.items
  if (Array.isArray(items)) return items as Raw[]
  if (items && typeof items === 'object' && Array.isArray((items as Raw).item)) {
    return (items as Raw).item as Raw[]
  }
  return []
}

export function normalizeAll(payload: unknown): Parking[] {
  const rows = extractRows(payload)
  const out: Parking[] = []
  const seen = new Set<string>()
  const usedIds = new Set<string>()

  rows.forEach((row, i) => {
    const p = normalizeParking(row, i)
    if (!p) return

    // id 에 이미 좌표가 섞여 있으므로 이름까지 같아야 같은 등재로 본다.
    const key = p.id + '|' + p.name
    if (seen.has(key)) return
    seen.add(key)

    /*
     * 관리번호와 좌표가 모두 같은데 이름만 다른 레코드가 드물게 있다(전국 5건).
     * id 가 겹치면 카드를 골랐을 때 다른 주차장이 열리므로 꼬리표를 붙여 갈라 둔다.
     * 입력이 정렬된 스냅샷이라 매번 같은 번호가 붙는다.
     */
    let id = p.id
    for (let n = 2; usedIds.has(id); n++) id = p.id + '#' + n
    usedIds.add(id)

    out.push(id === p.id ? p : { ...p, id })
  })
  return out
}
