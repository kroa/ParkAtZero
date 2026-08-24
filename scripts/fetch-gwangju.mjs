#!/usr/bin/env node
/**
 * 광주 공영주차장 현황으로 표준데이터에 빠진 무료 주차장을 채운다.
 *
 * 광주는 표준데이터에 497곳이 있는데 그중 무료로 판정되는 곳은 181곳뿐이다.
 * 광주시가 배포하는 공영주차장 현황에는 418곳이 있고 요금정보 칸에 무료/유료가
 * 직접 적혀 있다. 그중 322곳이 무료다 — 동·서·남·북·광산 5개 자치구가 운영하는
 * 소규모 공영주차장과 주민센터·구청 청사 주차장이다.
 *
 * 출처: 공공데이터포털 「전남광주통합특별시_공영주차장 현황」 (CSV, 인증 불필요)
 *
 * ── 담는 기준 ──────────────────────────────────────────────
 * 요금정보가 '무료'인 것만 담는다.
 *   - '유료' 93곳은 급지만 있고 금액이 없다. 넣으면 지도에 '미공개' 마커만 늘어난다.
 *   - '등록제' 3곳은 등록한 차량만 댈 수 있어 일반 이용자에게 무료가 아니다.
 *
 * 좌표가 없어 지번주소로 찾는다. 카카오가 돌려준 법정동·본번·부번이 요청과 모두
 * 같을 때만 쓰고, 어긋나면 그 주차장은 버린다. 예컨대 '금호동 747-2' 는 카카오
 * 주소 DB 에 없고 '747' 만 있는데, 다른 필지이므로 747 로 대신 찍지 않는다.
 *
 * 필요한 환경변수: KAKAO_REST_API_KEY
 * 사용: node scripts/fetch-gwangju.mjs [출력경로]
 */
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { geocodeAll } from './lib/geocode.mjs'

const CSV_URL =
  'https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003237508&fileDetailSn=1&insertDataPrcus=N'
const SNAPSHOT = path.join('public', 'data', 'parkings.full.json')
const DEFAULT_OUT = path.join('public', 'data', 'gwangju.json')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
const DUP_METERS = 40

const squash = (s) => String(s ?? '').split(/[ \t\r\n]+/).join(' ').trim()

/** 따옴표를 지키는 최소 CSV 파서. 비고에 쉼표가 들어 있어 split(',') 로는 못 읽는다. */
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
  const kakaoKey = process.env.KAKAO_REST_API_KEY
  if (!kakaoKey) {
    console.error('✗ KAKAO_REST_API_KEY 가 없습니다. 이 자료는 좌표가 없어 지오코딩이 필요합니다.')
    process.exit(1)
  }
  const today = new Date().toISOString().slice(0, 10)

  const res = await fetch(CSV_URL, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error('내려받기 실패 HTTP ' + res.status)
  const rows = parseCsv(new TextDecoder('euc-kr').decode(await res.arrayBuffer()))
  const head = rows[0]
  const body = rows.slice(1).filter((r) => r.length > 2)
  console.log('내려받음: ' + body.length + '행')

  const col = (n) => head.indexOf(n)
  for (const n of ['명칭', '주소', '요금정보', '유형', '운영주체']) {
    if (col(n) < 0) throw new Error('컬럼이 없습니다: ' + n + ' — 원본 형식이 바뀌었을 수 있습니다.')
  }
  const get = (r, n) => squash(r[col(n)])

  const tally = {}
  const bump = (k) => {
    tally[k] = (tally[k] ?? 0) + 1
  }

  const free = []
  for (const r of body) {
    const charge = get(r, '요금정보')
    if (charge !== '무료') {
      bump(charge === '등록제' ? '등록제 제외' : '유료(금액 없음) 제외')
      continue
    }
    if (!get(r, '주소')) {
      bump('주소 없음')
      continue
    }
    free.push(r)
  }
  console.log('무료: ' + free.length + '곳 → 지번주소로 좌표를 찾습니다...')

  const found = await geocodeAll(
    free.map((r, i) => ({ key: String(i), addr: '광주광역시 ' + get(r, '주소') })),
    kakaoKey,
    (done, total, n) => console.log('  ' + done + '/' + total + ' (찾음 ' + n + ')'),
  )
  console.log('지오코딩: ' + found.size + '/' + free.length + '곳 좌표 확보')

  const existing = []
  if (existsSync(SNAPSHOT)) {
    const snap = JSON.parse(await readFile(SNAPSHOT, 'utf-8'))
    for (const r of snap.data ?? snap.rows ?? []) {
      const la = Number(r.latitude)
      const ln = Number(r.longitude)
      if (la > 33 && ln > 124) existing.push([la, ln])
    }
  }

  const outRows = []
  for (let i = 0; i < free.length; i++) {
    const hit = found.get(String(i))
    if (!hit) {
      bump('좌표 못 찾음')
      continue
    }
    if (existing.some(([la, ln]) => metersBetween(hit.lat, hit.lng, la, ln) < DUP_METERS)) {
      bump('이미 등록됨')
      continue
    }
    const r = free[i]
    bump('추가')
    outRows.push({
      prkplceNo: 'PZ-GJ-' + (get(r, '연번') || i),
      prkplceNm: get(r, '명칭'),
      prkplceSe: '공영',
      prkplceType: get(r, '유형') || '노외',
      rdnmadr: '광주광역시 ' + get(r, '주소'),
      latitude: String(hit.lat),
      longitude: String(hit.lng),
      parkingchrgeInfo: '무료',
      operDay: '매일',
      weekdayOperOpenHhmm: '0000',
      weekdayOperColseHhmm: '2400',
      satOperOperOpenHhmm: '0000',
      satOperCloseHhmm: '2400',
      holidayOperOpenHhmm: '0000',
      holidayCloseOpenHhmm: '2400',
      basicTime: '0',
      basicCharge: '0',
      addUnitTime: '0',
      addUnitCharge: '0',
      dayCmmtkt: '0',
      prkcmprt: get(r, '주차면수') || '0',
      spcmnt: '',
      institutionNm: '광주광역시 ' + (get(r, '운영주체') || ''),
      pzSource: 'https://www.data.go.kr/data/3043284/fileData.do',
      pzVerifiedOn: today,
    })
  }

  await writeFile(
    out,
    JSON.stringify(
      {
        source: '공공데이터포털 — 전남광주통합특별시_공영주차장 현황',
        sourceUrl: 'https://www.data.go.kr/data/3043284/fileData.do',
        license: '광주광역시 제공 공공데이터. 요금정보가 무료인 곳만 옮기고, 좌표는 지번주소로 찾아 번지까지 확인한 것만 씀',
        fetchedOn: today,
        rows: outRows,
      },
      null,
      1,
    ),
    'utf-8',
  )
  console.log('저장: ' + outRows.length + '곳 → ' + out)
  console.log('분류: ' + JSON.stringify(tally))
}

if (process.argv[1] && process.argv[1].includes('fetch-gwangju')) {
  main().catch((err) => {
    console.error('✗ 실패:', err.message)
    process.exit(1)
  })
}
