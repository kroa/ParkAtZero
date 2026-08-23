#!/usr/bin/env node
/**
 * 대구광역시 통합주차정보로 표준데이터에 빠진 대구 무료 공영주차장을 채운다.
 *
 * 대구는 「전국주차장정보표준데이터」에 1,102곳만 올라 있는데, 대구광역시가 직접
 * 배포하는 통합주차정보(공공데이터포털 15151311)에는 2,218곳이 있다. 그중 상당수가
 * 이름부터 'OO길 노상무료'인 무료 노상주차장이다 — 이 앱이 찾아 주려는 바로 그것이다.
 *
 * 출처: 공공데이터포털 「대구광역시_통합주차정보」 (CSV, 인증 불필요)
 *       https://www.data.go.kr/data/15151311/fileData.do
 * 교차 확인: 대구광역시 통합주차정보시스템(pis.daegu.go.kr)의 실시간 목록 API 에도
 *       같은 주차장이 '공영/노상/중구청 교통과'로 올라 있다.
 *
 * ── 담는 기준 ──────────────────────────────────────────────
 * 이 자료에는 일반 주차요금 칸이 없다. 요금 컬럼은 거주자우선 주차권 요금뿐이라
 * '유료'인 곳은 금액을 알 수 없다. 그래서 요금부과구분이 '무료'인 곳만 담는다.
 *   - 민영 제외: 부설주차장이라 일반인이 못 대는 곳이 섞여 있다.
 *   - 거주자우선주차장 제외: 배정받은 사람만 댈 수 있다.
 *   - 유료 제외: 금액을 모르는 채로 넣으면 지도에 '미공개' 마커만 늘어난다.
 *
 * 같은 실수를 한 번 할 뻔했다. 함께 공개된 「대구광역시_부설주차장운영및개방공유정보」는
 * 4,364곳이 '무료'로 적혀 있지만 특기사항이 '학교 관계자 외 주차금지',
 * '카페 이용객 주차장' 이다. 개방공유가 'Y'인 곳은 5곳뿐이다. 그 자료는 쓰지 않는다.
 *
 * 사용: node scripts/fetch-daegu.mjs [출력경로]
 */
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const CSV_URL =
  'https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003517698&fileDetailSn=1&insertDataPrcus=N'
const SNAPSHOT = path.join('public', 'data', 'parkings.full.json')
const DEFAULT_OUT = path.join('public', 'data', 'daegu.json')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
/** 이 거리 안에 이미 등록된 주차장이 있으면 같은 곳으로 본다(m). */
const DUP_METERS = 40

const squash = (s) => String(s ?? '').split(/[ \t\r\n]+/).join(' ').trim()

/** 따옴표를 지키는 최소 CSV 파서. 특기사항에 쉼표가 들어 있어 split(',') 로는 못 읽는다. */
export function parseCsv(text) {
  const rows = []
  let field = ''
  let row = []
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      field = ''
      if (row.length > 1) rows.push(row)
      row = []
    } else if (c !== '\r') field += c
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/**
 * 운영시간 구분 코드를 hhmm 두 개로.
 * 이 자료는 시각이 아니라 '전일운영' 같은 코드로만 준다.
 */
export function readOperCode(code) {
  const s = squash(code)
  if (/전일운영|무료운영|24/.test(s)) return { open: '0000', close: '2400' }
  // 시간제운영은 몇 시부터인지 알 수 없다. 비워 두면 normalize 가 '정보 없음'으로 다룬다.
  return { open: '', close: '' }
}

function metersBetween(aLat, aLng, bLat, bLng) {
  const R = 6371000
  const rad = (x) => (x * Math.PI) / 180
  const dLat = rad(bLat - aLat)
  const dLng = rad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

async function main() {
  const out = process.argv[2] || DEFAULT_OUT
  const today = new Date().toISOString().slice(0, 10)

  const res = await fetch(CSV_URL, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error('내려받기 실패 HTTP ' + res.status)
  // 공공데이터포털 CSV 는 CP949 로 나온다.
  const text = new TextDecoder('euc-kr').decode(await res.arrayBuffer())
  const rows = parseCsv(text)
  const head = rows[0]
  const body = rows.slice(1)
  console.log('내려받음: ' + body.length.toLocaleString() + '행 · 컬럼 ' + head.length)

  const col = (name) => head.indexOf(name)
  const need = ['주차장명', '주차장구분', '주차장유형', '지번주소', '위도', '경도', '요금부과구분명', '요금수준구분명', '관리기관명']
  for (const n of need) {
    if (col(n) < 0) throw new Error('컬럼이 없습니다: ' + n + ' — 원본 형식이 바뀌었을 수 있습니다.')
  }
  const get = (r, n) => squash(r[col(n)])

  const existing = []
  if (existsSync(SNAPSHOT)) {
    const snap = JSON.parse(await readFile(SNAPSHOT, 'utf-8'))
    for (const r of snap.data ?? snap.rows ?? []) {
      const la = Number(r.latitude)
      const ln = Number(r.longitude)
      if (la > 33 && ln > 124) existing.push([la, ln])
    }
  }

  const tally = {}
  const bump = (k) => {
    tally[k] = (tally[k] ?? 0) + 1
  }
  const outRows = []

  for (const r of body) {
    const lat = Number(get(r, '위도'))
    const lng = Number(get(r, '경도'))
    if (!(lat > 33 && lat < 39 && lng > 124 && lng < 132)) {
      bump('좌표 없음')
      continue
    }
    if (get(r, '주차장구분') !== '공영') {
      bump('민영 제외')
      continue
    }
    if (get(r, '요금수준구분명') === '거주자우선주차장') {
      bump('거주자우선 제외')
      continue
    }
    // 이 자료에는 일반 요금 칸이 없다. 유료인데 금액을 모르면 '미공개'만 늘린다.
    if (get(r, '요금부과구분명') !== '무료') {
      bump('유료(금액 없음) 제외')
      continue
    }
    if (existing.some(([la, ln]) => metersBetween(lat, lng, la, ln) < DUP_METERS)) {
      bump('이미 등록됨')
      continue
    }

    const wd = readOperCode(get(r, '운영시간평일구분'))
    const sat = readOperCode(get(r, '운영시간토요일구분코드'))
    const hol = readOperCode(get(r, '운영시간휴일구분코드'))
    bump('추가')

    outRows.push({
      prkplceNo: 'PZ-DG-' + (get(r, '연번') || outRows.length),
      prkplceNm: get(r, '주차장명'),
      prkplceSe: '공영',
      prkplceType: get(r, '주차장유형') || '노상',
      rdnmadr: get(r, '지번주소'),
      latitude: String(lat),
      longitude: String(lng),
      parkingchrgeInfo: '무료',
      operDay: '매일',
      weekdayOperOpenHhmm: wd.open,
      weekdayOperColseHhmm: wd.close,
      satOperOperOpenHhmm: sat.open,
      satOperCloseHhmm: sat.close,
      holidayOperOpenHhmm: hol.open,
      holidayCloseOpenHhmm: hol.close,
      basicTime: '0',
      basicCharge: '0',
      addUnitTime: '0',
      addUnitCharge: '0',
      dayCmmtkt: '0',
      prkcmprt: get(r, '주차구획수') || get(r, '일반(면수)') || '0',
      // 비고는 '실제와 다를 수 있으니 현장 확인 바랍니다' 안내문이라 옮기지 않는다.
      spcmnt: '',
      institutionNm: get(r, '관리기관명'),
      pzSource: 'https://www.data.go.kr/data/15151311/fileData.do',
      pzVerifiedOn: today,
    })
  }

  const payload = {
    source: '공공데이터포털 — 대구광역시_통합주차정보',
    sourceUrl: 'https://www.data.go.kr/data/15151311/fileData.do',
    license: '대구광역시 제공 공공데이터. 요금부과구분이 무료인 공영 주차장만 옮김',
    fetchedOn: today,
    rows: outRows,
  }
  await writeFile(out, JSON.stringify(payload, null, 1), 'utf-8')
  console.log('저장: ' + outRows.length.toLocaleString() + '곳 → ' + out)
  console.log('분류: ' + JSON.stringify(tally))
}

if (process.argv[1] && process.argv[1].includes('fetch-daegu')) {
  main().catch((err) => {
    console.error('✗ 실패:', err.message)
    process.exit(1)
  })
}
