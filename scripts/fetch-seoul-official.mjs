#!/usr/bin/env node
/**
 * 서울시가 고시한 「서울시 공영주차장 현황」의 요일별 운영시간을 옮긴다.
 *
 * 서울특별시 교통운영관 주차계획과가 시 직영·위탁 공영주차장 125곳(노상 57·노외 68)의
 * '운영시간(평일·토요일·공휴일)'을 주차장별로 공개한다. 요금을 받는 시간을 요일별로
 * 밝힌 자료라 이 앱에는 가장 값진 출처다.
 *
 * 출처: https://news.seoul.go.kr/traffic/archives/26877
 *
 * ── 왜 필요한가 ────────────────────────────────────────────
 * 표준데이터는 같은 주차장의 공휴일 칸에 토요일 시간을 그대로 복사해 놓은 경우가 많다.
 * 여의도공원 노상은 표준데이터가 공휴일 09:00-15:00 인데, 서울시 공식표는 공휴일이
 * '무료개방' 이다. 서울시설공단 안내도 "09:00~19:00(평일) 09:00~15:00(토요일)
 * 무료개방(공휴일)" 으로 같다. 그대로 두면 일요일에 공짜인 곳을 유료로 안내한다.
 *
 * ── 이름으로만 짝짓는다 ─────────────────────────────────────
 * 공식표에는 주소 칸이 없다. 그래서 이름이 서울 안에서 딱 하나일 때만 짝짓는다.
 * '대림역' 과 '대림역2' 는 숫자를 지우지 않으므로 서로 섞이지 않는다.
 * 이름이 둘 이상이면 어느 쪽인지 알 수 없으므로 건드리지 않는다.
 *
 * 사용: node scripts/fetch-seoul-official.mjs [출력경로]
 */
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const PAGE = 'https://news.seoul.go.kr/traffic/archives/26877'
const SNAPSHOT = path.join('public', 'data', 'parkings.full.json')
const DEFAULT_OUT = path.join('public', 'data', 'seoul-official-hours.json')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'

const squash = (s) => String(s ?? '').split(/[ \t\r\n]+/).join(' ').trim()

/** 이름 비교용. 숫자는 지우지 않는다 — '대림역' 과 '대림역2' 는 다른 주차장이다. */
export function normName(s) {
  return squash(s)
    .replace(/\([^)]*\)/g, '')
    .replace(/[\s·ㆍ_-]/g, '')
    .replace(/공영주차장|주차장|공영/g, '')
    .toLowerCase()
}

/**
 * '09:00-19:00' → { open: '0900', close: '1900' }
 * '무료개방' / 빈칸 → null (그날은 요금을 받지 않는다)
 */
export function readCell(text) {
  const s = squash(text)
  if (!s || /무료/.test(s)) return null
  const m = /(\d{1,2})\s*:\s*(\d{2})\s*[-~–]\s*(\d{1,2})\s*:\s*(\d{2})/.exec(s)
  if (!m) return null
  const pad = (h, mm) => String(Math.min(24, Number(h))).padStart(2, '0') + mm
  return { open: pad(m[1], m[2]), close: pad(m[3], m[4]) }
}

/** 페이지에서 '운영시간(평일·토요일·공휴일)' 이 든 세부 현황표를 찾아 행으로 만든다. */
export function parseDetailTable(html) {
  for (const table of [...String(html).matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0])) {
    const flat = table.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
    if (!/운영주체/.test(flat) || !/공휴일/.test(flat)) continue

    const rows = []
    for (const tr of [...table.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0])) {
      const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) =>
        m[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(),
      )
      if (cells.length < 10) continue
      if (!/^\d+$/.test(cells[0])) continue
      rows.push({ name: cells[2], type: cells[3], weekday: cells[7], saturday: cells[8], holiday: cells[9] })
    }
    if (rows.length > 0) return rows
  }
  return []
}

async function main() {
  const out = process.argv[2] || DEFAULT_OUT
  const today = new Date().toISOString().slice(0, 10)

  const html = await (await fetch(PAGE, { headers: { 'User-Agent': UA } })).text()
  const official = parseDetailTable(html)
  console.log('공식 세부 현황: ' + official.length + '행')
  if (official.length === 0) throw new Error('세부 현황표를 찾지 못했습니다. 페이지 구조가 바뀌었을 수 있습니다.')

  if (!existsSync(SNAPSHOT)) throw new Error('스냅샷이 없습니다: ' + SNAPSHOT)
  const snap = JSON.parse(await readFile(SNAPSHOT, 'utf-8'))
  const seoul = (snap.data ?? []).filter((r) => /^서울/.test(String(r.rdnmadr ?? '') + String(r.lnmadr ?? '')))

  // 이름이 서울 안에서 유일할 때만 쓴다.
  const byName = new Map()
  for (const r of seoul) {
    const k = normName(r.prkplceNm)
    if (!k) continue
    byName.set(k, byName.has(k) ? null : r)
  }

  const tally = {}
  const bump = (k) => {
    tally[k] = (tally[k] ?? 0) + 1
  }
  const rows = []

  for (const o of official) {
    const key = normName(o.name)
    const hit = byName.get(key)
    if (hit === undefined) {
      bump('스냅샷에 없음')
      continue
    }
    if (hit === null) {
      bump('이름이 여러 곳과 겹침')
      continue
    }
    // 요금정보가 '무료'면 손대지 않는다. 운영시간을 넣어 유료로 뒤집힐 이유가 없다.
    if (String(hit.parkingchrgeInfo ?? '').trim() === '무료') {
      bump('원래 무료')
      continue
    }

    const wd = readCell(o.weekday)
    const sat = readCell(o.saturday)
    const hol = readCell(o.holiday)
    if (!wd && !sat && !hol) {
      bump('세 요일 모두 무료 — 요금정보를 건드리지 않음')
      continue
    }

    /*
     * 요금을 받지 않는 요일은 시각을 비우고 운영요일에서도 뺀다.
     * 시각만 비우면 운영요일이 '매일'로 남아 '그날 24시간 운영'으로 읽힌다.
     */
    const operDay = ['평일', sat ? '토요일' : '', hol ? '공휴일' : ''].filter(Boolean).join('+')
    bump('반영')
    rows.push({
      prkplceNo: String(hit.prkplceNo ?? ''),
      prkplceNm: String(hit.prkplceNm ?? ''),
      officialName: squash(o.name),
      hours: {
        operDay,
        weekdayOperOpenHhmm: wd?.open ?? '',
        weekdayOperColseHhmm: wd?.close ?? '',
        satOperOperOpenHhmm: sat?.open ?? '',
        satOperCloseHhmm: sat?.close ?? '',
        holidayOperOpenHhmm: hol?.open ?? '',
        holidayCloseOpenHhmm: hol?.close ?? '',
      },
    })
  }

  await writeFile(
    out,
    JSON.stringify(
      {
        source: '서울특별시 교통운영관 주차계획과 — 서울시 공영주차장 현황',
        sourceUrl: PAGE,
        license: '서울특별시가 고시한 주차장별 요일 운영시간(평일·토요일·공휴일)',
        fetchedOn: today,
        rows,
      },
      null,
      1,
    ),
    'utf-8',
  )
  console.log('저장: ' + rows.length + '곳 → ' + out)
  console.log('분류: ' + JSON.stringify(tally))
}

if (process.argv[1] && process.argv[1].includes('fetch-seoul-official')) {
  main().catch((err) => {
    console.error('✗ 실패:', err.message)
    process.exit(1)
  })
}
