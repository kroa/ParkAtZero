#!/usr/bin/env node
/**
 * 서울시 공영주차장 API 로 표준데이터에 빠진 서울 주차장을 채운다.
 *
 * 서울은 전국에서 등록이 가장 성긴 곳이다. 인구 10만명당 등록 주차장이
 * 제주 235곳, 강원 92곳, 경북 76곳인데 서울은 10.1곳으로 꼴찌다.
 * 표준데이터에 든 서울 주차장은 807곳뿐인데, 서울시가 직접 운영하는
 * 공영주차장 API 에는 2,189곳이 있다.
 *
 *   목록: openapi.seoul.go.kr/{key}/json/GetParkInfo/{start}/{end}/
 *
 * ── 주말 무료 플래그를 쓰지 않는 이유 ──────────────────────────────
 * 이 API 에는 SAT_CHGD_FREE_SE(토요일)와 LHLDY_YN(공휴일) 이 있고, 액면 그대로
 * 읽으면 2,189곳 중 2,013곳이 '토요일 무료'가 된다. 쓰면 안 된다.
 *
 *   - 공휴일 무료가 817곳인데 토요일 무료가 2,013곳이다. 공휴일보다 토요일에
 *     더 많이 무료라는 건 앞뒤가 맞지 않는다.
 *   - 광화문 세종로 공영주차장(1,260면, 5분당 430원, 일 30,900원)도 '토요일 무료'로
 *     찍혀 있다. 서울시설공단 요금표에는 요일별 감면이 없다.
 *   - '토요일 유료'로 찍힌 176곳은 하나같이 토요일 운영시간이 0000-0000, 즉
 *     토요일에 문을 열지 않는 곳이다. 값이 요금이 아니라 다른 뜻으로 쓰인 정황이다.
 *
 * 그래서 여기서는 평일 요금·운영시간·좌표만 옮긴다. 주말 무료 여부는 자치구
 * 조례로 따로 확인해서 채운다. 잘못 넣으면 유료 주차장 2,000곳이 '완전 무료'가 된다.
 *
 * 좌표가 없는 733곳도 넣지 않는다. 지도에 못 찍는 주차장은 이 앱에서 쓸모가 없고,
 * 동 중심점으로 대충 찍으면 수백 미터 떨어진 곳으로 안내하게 된다.
 *
 * 필요한 환경변수: SEOUL_OPENAPI_KEY
 * 사용: node scripts/fetch-seoul-lots.mjs [출력경로]
 */
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const SERVICE = 'GetParkInfo'
const SNAPSHOT = path.join('public', 'data', 'parkings.full.json')
const DEFAULT_OUT = path.join('public', 'data', 'seoul-lots.json')
const PAGE = 1000
/** 이 거리 안에 이미 등록된 주차장이 있으면 같은 곳으로 본다(m). */
const DUP_METERS = 40

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 0
}
const squash = (s) => String(s ?? '').split(/[ \t\r\n]+/).join(' ').trim()

/** hhmm 문자열 정리. 0000-0000 이나 빈 값은 '운영 정보 없음'으로 본다. */
function hhmm(v) {
  const s = String(v ?? '').replace(/[^0-9]/g, '')
  return s.length === 4 ? s : ''
}

function metersBetween(aLat, aLng, bLat, bLng) {
  const R = 6371000
  const rad = (x) => (x * Math.PI) / 180
  const dLat = rad(bLat - aLat)
  const dLng = rad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * 운영구분에서 일반 차량이 댈 수 없는 이유를 읽는다.
 * 버스전용·거주자우선 구획을 '무료 주차장'으로 내보내면, 갔는데 못 대는 최악이 된다.
 */
export function readRestriction(operSeNm) {
  const s = squash(operSeNm)
  if (/버스전용/.test(s) && !/시간제/.test(s)) return '버스 전용'
  if (/거주자\s*우선/.test(s) && !/시간제/.test(s)) return '거주자 전용'
  return ''
}

async function main() {
  const out = process.argv[2] || DEFAULT_OUT
  const key = process.env.SEOUL_OPENAPI_KEY
  if (!key) {
    console.error('✗ SEOUL_OPENAPI_KEY 가 없습니다.')
    process.exit(1)
  }
  const today = new Date().toISOString().slice(0, 10)

  const head = (await (await fetch(`http://openapi.seoul.go.kr:8088/${key}/json/${SERVICE}/1/1/`)).json())[SERVICE]
  if (head?.RESULT?.CODE !== 'INFO-000') {
    console.error('✗ API 오류: ' + (head?.RESULT?.MESSAGE ?? '알 수 없음'))
    process.exit(1)
  }
  const total = Number(head.list_total_count)
  console.log('API 총건수: ' + total.toLocaleString())

  const api = []
  for (let s = 1; s <= total; s += PAGE) {
    const res = await fetch(`http://openapi.seoul.go.kr:8088/${key}/json/${SERVICE}/${s}/${Math.min(s + PAGE - 1, total)}/`)
    api.push(...(((await res.json())[SERVICE] ?? {}).row ?? []))
  }
  console.log('수집: ' + api.length.toLocaleString() + '건')

  // 이미 등록된 주차장 좌표 — 중복으로 두 번 찍히지 않게 한다.
  const existing = []
  if (existsSync(SNAPSHOT)) {
    const snap = JSON.parse(await readFile(SNAPSHOT, 'utf-8'))
    for (const r of snap.data ?? snap.rows ?? []) {
      const la = Number(r.latitude)
      const ln = Number(r.longitude)
      if (la > 33 && ln > 124) existing.push([la, ln])
    }
  }
  console.log('기존 스냅샷 좌표: ' + existing.length.toLocaleString() + '건')

  const rows = []
  const tally = {}
  const bump = (k) => {
    tally[k] = (tally[k] ?? 0) + 1
  }

  /*
   * 관리번호(PKLT_CD)로 묶는다.
   *
   * 노상주차장은 구획 하나가 한 행으로 들어온다. '봉천복개3 공영주차장'은 같은
   * 관리번호로 40행이 오는데, 좌표가 몇 미터씩 다른 같은 주차장이다. 그대로 넣으면
   * 길 하나에 마커가 40개 찍혀서 지도를 덮는다.
   * 한 주차장을 한 점으로 줄이되, 구획들의 중심을 써서 위치를 최대한 맞춘다.
   */
  const groups = new Map()
  for (const r of api) {
    const lat = Number(r.LAT)
    const lng = Number(r.LOT)
    if (!(lat > 33 && lat < 39 && lng > 124 && lng < 132)) {
      bump('좌표 없음')
      continue
    }
    const id = String(r.PKLT_CD ?? '') || squash(r.PKLT_NM)
    if (!groups.has(id)) groups.set(id, { first: r, pts: [] })
    groups.get(id).pts.push([lat, lng])
  }
  console.log('관리번호로 묶음: ' + groups.size.toLocaleString() + '곳 (구획 ' + api.length.toLocaleString() + '행)')

  for (const [, { first: r, pts }] of groups) {
    const lat = pts.reduce((s, p) => s + p[0], 0) / pts.length
    const lng = pts.reduce((s, p) => s + p[1], 0) / pts.length
    if (pts.length > 1) bump('구획 묶음')

    if (existing.some(([la, ln]) => metersBetween(lat, lng, la, ln) < DUP_METERS)) {
      bump('이미 등록됨')
      continue
    }

    const charge = r.CHGD_FREE_NM === '무료' ? '무료' : '유료'
    const wdOpen = hhmm(r.WD_OPER_BGNG_TM)
    const wdClose = hhmm(r.WD_OPER_END_TM)
    const weOpen = hhmm(r.WE_OPER_BGNG_TM)
    const weClose = hhmm(r.WE_OPER_END_TM)
    const hoOpen = hhmm(r.LHLDY_BGNG)
    const hoClose = hhmm(r.LHLDY)

    const restriction = readRestriction(r.OPER_SE_NM)
    bump(restriction ? '제한 있음' : charge === '무료' ? '무료' : '유료')

    rows.push({
      prkplceNo: 'PZ-SEOUL-' + r.PKLT_CD,
      prkplceNm: squash(r.PKLT_NM),
      prkplceSe: '공영',
      prkplceType: /노상/.test(r.PKLT_KND_NM ?? '') ? '노상' : '노외',
      rdnmadr: '서울특별시 ' + squash(r.ADDR),
      latitude: String(lat),
      longitude: String(lng),
      parkingchrgeInfo: charge,
      operDay: '매일',
      weekdayOperOpenHhmm: wdOpen,
      weekdayOperColseHhmm: wdClose,
      satOperOperOpenHhmm: weOpen,
      satOperCloseHhmm: weClose,
      holidayOperOpenHhmm: hoOpen,
      holidayCloseOpenHhmm: hoClose,
      basicTime: String(num(r.PRK_HM)),
      basicCharge: String(num(r.PRK_CRG)),
      addUnitTime: String(num(r.ADD_UNIT_TM_MNT)),
      addUnitCharge: String(num(r.ADD_CRG)),
      dayCmmtkt: String(num(r.DLY_MAX_CRG)),
      monthCmmtkt: String(num(r.MNTL_CMUT_CRG)),
      // 주말 무료 플래그는 신뢰할 수 없어 옮기지 않는다(파일 상단 설명 참고).
      spcmnt: restriction,
      prkcmprt: String(num(r.TPKCT)),
      institutionNm: '서울특별시',
      phoneNumber: squash(r.TELNO),
      pzSource: 'https://data.seoul.go.kr/dataList/OA-13122/S/1/datasetView.do',
      pzVerifiedOn: today,
    })
  }

  const payload = {
    source: '서울 열린데이터광장 — 서울시 공영주차장 안내 정보 (GetParkInfo)',
    sourceUrl: 'https://data.seoul.go.kr/dataList/OA-13122/S/1/datasetView.do',
    license: '서울특별시 제공 공공데이터. 평일 요금·운영시간·좌표만 옮김 (주말 무료 플래그는 신뢰할 수 없어 제외)',
    fetchedOn: today,
    rows,
  }
  await writeFile(out, JSON.stringify(payload, null, 1), 'utf-8')
  console.log('저장: ' + rows.length.toLocaleString() + '곳 → ' + out)
  console.log('분류: ' + JSON.stringify(tally))
}

if (process.argv[1] && process.argv[1].includes('fetch-seoul-lots')) {
  main().catch((err) => {
    console.error('✗ 실패:', err.message)
    process.exit(1)
  })
}
