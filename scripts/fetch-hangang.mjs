#!/usr/bin/env node
/**
 * 한강공원 주차장 30곳을 서울 열린데이터광장 오픈API 에서 받아 온다.
 *
 *   node scripts/fetch-hangang.mjs [출력경로]
 *
 * 왜 따로 받나
 *   「전국주차장정보표준데이터」는 지자체가 자율로 등록하는 자료다. 한강공원 주차장은
 *   서울시 미래한강본부가 직접 운영하는데 표준데이터에는 한 곳도 올라 있지 않다.
 *   서울에서 이용자가 가장 많은 주차장 무리가 통째로 비어 있던 셈이다.
 *
 * 서비스: TbParkingInfoView (갱신주기 매일 1회, 공공누리 제1유형)
 *   http://openapi.seoul.go.kr:8088/{인증키}/json/TbParkingInfoView/1/1000/
 *
 * 필요한 환경변수 (.env.local 또는 CI 시크릿)
 *   SEOUL_OPENAPI_KEY — 서울 열린데이터광장 인증키
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const SERVICE = 'TbParkingInfoView'
const DEFAULT_OUT = path.join('public', 'data', 'hangang.json')

/** dotenv 의존성 없이 .env.local 을 읽는다 — 스크립트 하나 때문에 패키지를 늘리지 않는다. */
async function loadEnvFile(file) {
  if (!existsSync(file)) return
  const text = await readFile(file, 'utf-8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!(key in process.env)) process.env[key] = value
  }
}

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** "06:00" → "0600". 표준데이터의 운영시각 칸은 HHMM 문자열이다. */
const hhmm = (v) => {
  const s = String(v ?? '').trim()
  const m = /^(\d{1,2}):?(\d{2})$/.exec(s)
  return m ? m[1].padStart(2, '0') + m[2] : ''
}

/**
 * "서울강서구방화동61(방화동)" 처럼 띄어쓰기가 없는 주소를 읽기 좋게 벌린다.
 * 원문을 지우지는 않는다 — 시·구 뒤에만 공백을 넣는다.
 */
function spaceAddress(raw) {
  return String(raw ?? '')
    .replace(/^서울(?=[가-힣])/, '서울특별시 ')
    .replace(/(구|군)(?=[가-힣])/, '$1 ')
    .trim()
}

/**
 * 오픈API 한 행을 「전국주차장정보표준데이터」와 같은 모양으로 옮긴다.
 * 이렇게 두면 normalize·freeCalc 가 표준데이터와 똑같이 처리한다.
 */
function toStandardRow(row) {
  const lat = num(row.PSTN_INFO_LAT)
  const lng = num(row.PSTN_INFO_LOT)
  if (!(lat > 32 && lat < 39.5 && lng > 124 && lng < 132.5)) return null

  const name = String(row.PKLT_TYPE ?? '').trim()
  if (!name) return null

  const notes = []
  /*
   * EXMPTN_HR 은 면제시간(회차시간)이다. 그 안에 나가면 전액 무료이고 넘기면
   * 처음부터 과금된다 — '최초 N분 무료'처럼 시간을 빼 주는 것이 아니다.
   * timeRules 가 '면제시간 N분' 표현을 exempt 규칙으로 읽는다.
   */
  const exempt = num(row.EXMPTN_HR)
  if (exempt > 0) notes.push('면제시간 ' + exempt + '분')
  const night = num(row.NGHT_CRG)
  if (night > 0) notes.push('야간요금 ' + night.toLocaleString('ko-KR') + '원')

  const weekendOpen = hhmm(row.WE_OPER_BGNG_TM)
  const weekendClose = hhmm(row.WE_OPER_END_TM)

  return {
    prkplceNo: 'PZ-HAN-' + String(row.PKLT_TYPE ?? '').replace(/\s+/g, ''),
    // "여의도1주차장" 만으로는 어디인지 알기 어렵다. 검색에도 걸리도록 앞에 붙인다.
    prkplceNm: '한강공원 ' + name,
    prkplceSe: '공영',
    prkplceType: '노외',
    rdnmadr: spaceAddress(row.ADDR),
    latitude: String(lat),
    longitude: String(lng),
    prkcmprt: String(num(row.PRK_CNT)),
    operDay: '평일+토요일+공휴일',
    weekdayOperOpenHhmm: hhmm(row.WD_OPER_BGNG_TM),
    weekdayOperColseHhmm: hhmm(row.WD_OPER_END_TM),
    satOperOperOpenHhmm: weekendOpen,
    satOperCloseHhmm: weekendClose,
    holidayOperOpenHhmm: weekendOpen,
    holidayCloseOpenHhmm: weekendClose,
    parkingchrgeInfo: num(row.BSC_CRG) > 0 ? '유료' : '무료',
    basicTime: String(num(row.BSC_HR)),
    basicCharge: String(num(row.BSC_CRG)),
    addUnitTime: String(num(row.INTR_HR)),
    addUnitCharge: String(num(row.INTR_CRG)),
    dayCmmtkt: String(num(row.PRVDY_CRG)),
    monthCmmtkt: String(num(row.PRD_AMT)),
    spcmnt: notes.join('. '),
    institutionNm: String(row.PKLT_OPER_BZENTY ?? '').trim() || '서울특별시 미래한강본부',
    phoneNumber: String(row.BZENTY_TEL ?? '').split('/')[0].trim(),
    pzSource: 'https://data.seoul.go.kr/dataList/OA-21083/S/1/datasetView.do',
    pzVerifiedOn: new Date().toISOString().slice(0, 10),
  }
}

async function main() {
  await loadEnvFile(path.join(process.cwd(), '.env.local'))
  await loadEnvFile(path.join(process.cwd(), '.dev.vars'))

  const key = process.env.SEOUL_OPENAPI_KEY
  if (!key) {
    console.error('✗ SEOUL_OPENAPI_KEY 가 없습니다. .env.local 에 넣거나 CI 시크릿으로 주세요.')
    process.exit(1)
  }

  const url = 'http://openapi.seoul.go.kr:8088/' + key + '/json/' + SERVICE + '/1/1000/'
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) {
    console.error('✗ HTTP ' + res.status)
    process.exit(1)
  }

  const payload = await res.json()
  const body = payload?.[SERVICE]
  const code = body?.RESULT?.CODE
  if (!body || (code && code !== 'INFO-000')) {
    // 인증키는 절대 찍지 않는다.
    console.error('✗ API 오류: ' + (body?.RESULT?.MESSAGE ?? JSON.stringify(payload?.RESULT ?? payload).slice(0, 200)))
    process.exit(1)
  }

  const rows = Array.isArray(body.row) ? body.row : []
  const mapped = rows.map(toStandardRow).filter(Boolean)
  if (mapped.length === 0) {
    console.error('✗ 옮길 수 있는 행이 없습니다. 컬럼명이 바뀌었을 수 있습니다.')
    process.exit(1)
  }

  const out = process.argv[2] ?? DEFAULT_OUT
  await mkdir(path.dirname(out), { recursive: true })
  await writeFile(
    out,
    JSON.stringify(
      {
        source: SERVICE,
        sourceUrl: 'https://data.seoul.go.kr/dataList/OA-21083/S/1/datasetView.do',
        license: '공공누리 제1유형 (출처표시) · 서울특별시',
        fetchedOn: new Date().toISOString().slice(0, 10),
        rows: mapped,
      },
      null,
      1,
    ),
    'utf-8',
  )

  console.log('한강공원 주차장 ' + mapped.length + '곳 저장 (전체 ' + body.list_total_count + '건) → ' + out)
  const dropped = rows.length - mapped.length
  if (dropped > 0) console.log('  좌표·이름이 없어 제외한 ' + dropped + '건')
}

main().catch((err) => {
  console.error('✗ 실패:', err.message)
  process.exit(1)
})
