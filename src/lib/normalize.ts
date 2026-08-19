import type { Parking } from '@/types/parking'
import { buildRange, extractRestriction, parseHhmm } from './timeRules'
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
  holClose: ['holidayCloseHhmm', 'holidayOperCloseHhmm', '공휴일운영종료시각'],
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
  lat: ['latitude', '위도', 'lat'],
  lng: ['longitude', '경도', 'lng'],
  updatedAt: ['referenceDate', '데이터기준일자'],
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

  const weekday = buildRange(parseHhmm(pick(row, FIELD.weekdayOpen)), parseHhmm(pick(row, FIELD.weekdayClose)))
  const saturday = buildRange(parseHhmm(pick(row, FIELD.satOpen)), parseHhmm(pick(row, FIELD.satClose)))
  const holiday = buildRange(parseHhmm(pick(row, FIELD.holOpen)), parseHhmm(pick(row, FIELD.holClose)))

  const dayTicket = num(pick(row, FIELD.dayTicket))
  const monthTicket = num(pick(row, FIELD.monthTicket))
  const note = str(pick(row, FIELD.note)) || undefined
  const managedBy = str(pick(row, FIELD.managedBy)) || undefined

  // 특기사항에 적혀 있으면 그것을 쓰고, 비어 있으면 확인된 보정표로 채운다.
  const restriction = extractRestriction(note) ?? findCorrection(name, managedBy)?.restriction

  return {
    id: str(pick(row, FIELD.id), 'pz-' + index),
    name,
    type: str(pick(row, FIELD.type), '기타'),
    ownership: str(pick(row, FIELD.ownership), '기타'),
    address: str(pick(row, FIELD.roadAddr)) || str(pick(row, FIELD.lotAddr), '주소 정보 없음'),
    lat,
    lng,
    capacity: num(pick(row, FIELD.capacity)),
    chargeType: normalizeChargeType(str(pick(row, FIELD.chargeInfo))),
    operDay: str(pick(row, FIELD.operDay)) || undefined,
    hours: { weekday, saturday, holiday },
    fee: {
      basicTime: num(pick(row, FIELD.basicTime)),
      basicCharge: num(pick(row, FIELD.basicCharge)),
      addTime: num(pick(row, FIELD.addTime)),
      addCharge: num(pick(row, FIELD.addCharge)),
      dayTicketTime: num(pick(row, FIELD.dayTicketTime)) || undefined,
      dayTicket: dayTicket || undefined,
      monthTicket: monthTicket || undefined,
    },
    note,
    restriction,
    tel: str(pick(row, FIELD.tel)) || undefined,
    payment: str(pick(row, FIELD.payment)) || undefined,
    managedBy,
    updatedAt: str(pick(row, FIELD.updatedAt)) || undefined,
  }
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
  rows.forEach((row, i) => {
    const p = normalizeParking(row, i)
    if (!p) return
    // 같은 주차장이 여러 지자체 파일에 중복 등재되는 일이 잦다.
    const key = p.id + '|' + p.name + '|' + p.lat.toFixed(5) + '|' + p.lng.toFixed(5)
    if (seen.has(key)) return
    seen.add(key)
    out.push(p)
  })
  return out
}
