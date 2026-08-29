#!/usr/bin/env node
/**
 * 한국천문연구원 특일 정보로 법정공휴일 표를 만든다.
 *
 * 설날·추석·부처님오신날은 음력이라 계산식으로 뽑을 수 없어 그동안 손으로 적어 두었다.
 * 그러다 2026년 광복절(8/15 토)의 대체공휴일 8/17 이 통째로 빠져 있는 걸 발견했다.
 * 그날 공휴일 무료인 주차장을 평일 유료로 안내하고 있었다. 손으로 적는 한 또 생긴다.
 *
 * 앱은 Local-First 라 런타임에 외부를 부르지 않는다. 그래서 빌드 전에 여기서 받아
 * src/data/holidays.json 에 박아 두고, 앱은 그 파일만 읽는다.
 *
 * 출처: https://www.data.go.kr/data/15012690/openapi.do (무료·자동승인·일 10,000건)
 *
 * ── 인증키 ────────────────────────────────────────────────
 * 공공데이터포털의 '일반 인증키(Encoding)' 를 그대로 두면 이미 % 인코딩된 상태다.
 * URLSearchParams 가 한 번 더 인코딩해 '등록되지 않은 서비스키' 가 된다.
 * 그래서 먼저 디코딩해 보고, 그래도 안 되면 원문 그대로 시도한다.
 *
 * 사용: PARKING_API_KEY=... node scripts/fetch-holidays.mjs [출력경로]
 */
import path from 'node:path'
import { writeFile } from 'node:fs/promises'

const API = 'http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo'
const SOURCE_URL = 'https://www.data.go.kr/data/15012690/openapi.do'
const DEFAULT_OUT = path.join('src', 'data', 'holidays.json')

/*
 * 특일 정보가 공휴일(isHoliday=Y)로 주지만 이 앱에서는 빼야 하는 날.
 *
 * 이 앱에서 '공휴일'은 <공영주차장이 공휴일 요금·운영을 적용하는 날>을 뜻한다.
 * 근로자의 날(노동절)은 근로기준법상 유급휴일이지 「관공서의 공휴일에 관한 규정」상
 * 공휴일이 아니다. 공무원은 근로기준법상 근로자가 아니라 관공서는 정상 근무하고,
 * 구청·시설공단이 굴리는 공영주차장도 평일처럼 운영한다.
 * 넣으면 그날 유료인 주차장을 무료라고 안내하게 된다 — 빼는 쪽이 안전하다.
 * (빼서 생기는 손해는 '무료인데 유료로 보이는 것' 뿐이다.)
 *
 * 반대로 제헌절은 넣는다. 오랫동안 공휴일이 아니었지만 특일 정보가 공휴일로 주고
 * 대체공휴일까지 계산해 주며, 규정 자체도 2026-05-11 시행으로 제2조가 개정됐다.
 * 선거일·임시공휴일도 관공서가 쉬므로 넣는다.
 */
const EXCLUDED = /노동절|근로자의?\s*날/

/** 한 해치를 받는다. 실패하면 null. */
async function fetchYear(year, key) {
  const q = new URLSearchParams({
    solYear: String(year),
    numOfRows: '100',
    pageNo: '1',
    ServiceKey: key,
  })
  const res = await fetch(API + '?' + q)
  const text = await res.text()
  if (!res.ok) return { error: 'HTTP ' + res.status }

  const err = /<errMsg>([^<]*)<\/errMsg>/.exec(text)
  if (err) return { error: err[1] }
  const code = /<resultCode>([^<]*)<\/resultCode>/.exec(text)?.[1]
  if (code && code !== '00') {
    return { error: 'resultCode ' + code + ' ' + (/<resultMsg>([^<]*)<\/resultMsg>/.exec(text)?.[1] ?? '') }
  }

  const items = []
  for (const block of text.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
    const pick = (t) => /<\s*(?:\w+:)?TAG\s*>([^<]*)<\//.source.replace('TAG', t)
    const get = (t) => new RegExp(pick(t)).exec(block)?.[1]?.trim() ?? ''
    const locdate = get('locdate')
    if (!/^\d{8}$/.test(locdate)) continue
    items.push({
      date: locdate.slice(0, 4) + '-' + locdate.slice(4, 6) + '-' + locdate.slice(6, 8),
      name: get('dateName'),
      isHoliday: get('isHoliday') === 'Y',
    })
  }
  return { items }
}

/** 인증키가 인코딩된 것인지 아닌지 모르므로 두 형태를 다 시도한다. */
async function resolveKey(raw, year) {
  const candidates = []
  try {
    const decoded = decodeURIComponent(raw)
    if (decoded !== raw) candidates.push(decoded)
  } catch {
    /* % 가 섞인 평문일 수 있다 — 원문으로 간다 */
  }
  candidates.push(raw)

  for (const key of candidates) {
    const r = await fetchYear(year, key)
    if (!r.error) return { key, first: r }
  }
  return null
}

async function main() {
  const out = process.argv[2] || DEFAULT_OUT
  const raw = process.env.PARKING_API_KEY
  if (!raw) throw new Error('PARKING_API_KEY 가 없습니다')

  const thisYear = new Date().getFullYear()
  const years = [thisYear - 1, thisYear, thisYear + 1, thisYear + 2]

  const resolved = await resolveKey(raw, years[0])
  if (!resolved) {
    throw new Error(
      '인증키가 이 서비스에 등록돼 있지 않습니다. ' + SOURCE_URL + ' 에서 활용신청을 먼저 하세요.',
    )
  }

  const all = new Map()
  const perYear = {}
  for (const year of years) {
    const r = year === years[0] ? resolved.first : await fetchYear(year, resolved.key)
    if (r.error) {
      console.warn('  ! ' + year + '년: ' + r.error)
      continue
    }
    const kept = r.items.filter((x) => x.isHoliday && !EXCLUDED.test(x.name))
    perYear[year] = kept.length
    for (const x of kept) all.set(x.date, x.name)
    console.log('  ' + year + '년 ' + kept.length + '일')
  }

  /*
   * 한 해에 공휴일이 10일도 안 되면 응답이 잘린 것이다. 그걸 그대로 쓰면
   * 앱이 공휴일을 통째로 잃는다. 덮어쓰지 않고 실패로 끝낸다.
   */
  const thin = Object.entries(perYear).filter(([, n]) => n < 10)
  if (thin.length > 0) throw new Error('공휴일이 너무 적습니다: ' + JSON.stringify(Object.fromEntries(thin)))
  if (Object.keys(perYear).length === 0) throw new Error('한 해도 받지 못했습니다')

  const dates = [...all.keys()].sort()
  await writeFile(
    out,
    JSON.stringify(
      {
        source: '한국천문연구원 특일 정보 (공공데이터포털)',
        sourceUrl: SOURCE_URL,
        fetchedOn: new Date().toISOString().slice(0, 10),
        years: Object.keys(perYear).map(Number),
        // 사람이 눈으로 검산할 수 있게 이름도 남긴다.
        names: Object.fromEntries([...all.entries()].sort()),
        dates,
      },
      null,
      1,
    ),
    'utf-8',
  )
  console.log('저장: ' + dates.length + '일 → ' + out)
}

if (process.argv[1] && process.argv[1].includes('fetch-holidays')) {
  main().catch((err) => {
    console.error('✗ 실패:', err.message)
    process.exit(1)
  })
}
