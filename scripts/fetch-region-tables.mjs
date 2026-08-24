#!/usr/bin/env node
/**
 * 지자체 공식 페이지에서 옮겨 적은 무료 주차장 표를 좌표까지 채워 보완 데이터로 만든다.
 *
 * 표준데이터는 지자체 자율 등록이라 구·군이 자기 홈페이지에는 올려 두고도 표준데이터에는
 * 안 올린 주차장이 많다. 울산이 대표적이다 — 표준데이터에 387곳뿐인데 북구청·동구청·
 * 울주군 홈페이지의 '무료 공영주차장 현황' 표에만 214곳이 있다.
 *
 * 그 표들에는 주소만 있고 좌표가 없어서 예전에는 쓸 수 없었다. 지오코더가 생겨서
 * 이제 쓴다.
 *
 * 원본 표는 src/data/region-tables.json 에 출처와 함께 그대로 남겨 두었다.
 * 지자체 페이지는 예고 없이 바뀌므로, 옮겨 적은 시점의 값을 저장소에 박아 두고
 * 이 스크립트는 좌표만 붙인다.
 *
 * ── 담는 기준 ──────────────────────────────────────────────
 * 표에 '무료'라고 명시된 행만 담는다. 요금 칸이 비어 있는 것은 무료가 아니라 모름이다.
 * 좌표는 법정동·본번·부번이 모두 맞을 때만 쓰고, 어긋나면 그 주차장은 버린다.
 *
 * 필요한 환경변수: KAKAO_REST_API_KEY
 * 사용: node scripts/fetch-region-tables.mjs [출력경로]
 */
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { geocodeAll } from './lib/geocode.mjs'

const TABLES = path.join('src', 'data', 'region-tables.json')
const SNAPSHOT = path.join('public', 'data', 'parkings.full.json')
const DEFAULT_OUT = path.join('public', 'data', 'region-lots.json')
const DUP_METERS = 40

const squash = (s) => String(s ?? '').split(/[ \t\r\n]+/).join(' ').trim()

/** '10:00~19:00' 같은 표기를 hhmm 두 개로. 못 읽으면 24시간으로 본다. */
export function readHours(text) {
  const m = /(\d{1,2})\s*:\s*(\d{2})\s*[~\-–]\s*(\d{1,2})\s*:\s*(\d{2})/.exec(squash(text))
  if (!m) return { open: '0000', close: '2400' }
  const pad = (h, mm) => String(Math.min(24, Number(h))).padStart(2, '0') + mm
  return { open: pad(m[1], m[2]), close: pad(m[3], m[4]) }
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

  const { sources = [] } = JSON.parse(await readFile(TABLES, 'utf-8'))
  const items = []
  for (const s of sources) {
    for (let i = 0; i < s.rows.length; i++) {
      const r = s.rows[i]
      items.push({
        key: s.institution + '#' + i,
        addr: (s.prefix ? s.prefix + ' ' : '') + r.address,
        row: r,
        source: s,
      })
    }
  }
  console.log('옮겨 적은 무료 주차장: ' + items.length + '곳 (' + sources.length + '개 출처)')

  const found = await geocodeAll(items, kakaoKey, (done, total, n) =>
    console.log('  ' + done + '/' + total + ' (찾음 ' + n + ')'),
  )
  console.log('지오코딩: ' + found.size + '/' + items.length + '곳 좌표 확보')

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
  const rows = []
  const seen = []

  for (const it of items) {
    const hit = found.get(it.key)
    if (!hit) {
      bump('좌표 못 찾음')
      continue
    }
    if (existing.some(([la, ln]) => metersBetween(hit.lat, hit.lng, la, ln) < DUP_METERS)) {
      bump('이미 등록됨')
      continue
    }
    // 같은 표 안에서도 같은 자리를 두 번 적어 놓은 경우가 있다.
    if (seen.some(([la, ln]) => metersBetween(hit.lat, hit.lng, la, ln) < 15)) {
      bump('표 안에서 중복')
      continue
    }
    seen.push([hit.lat, hit.lng])

    const h = readHours(it.row.hours)
    bump(it.source.institution)
    rows.push({
      prkplceNo: 'PZ-RT-' + it.key.replace(/[^A-Za-z0-9#]/g, '') + '-' + rows.length,
      prkplceNm: it.row.name || '공영주차장',
      prkplceSe: '공영',
      prkplceType: it.row.type || '노외',
      rdnmadr: it.addr,
      latitude: String(hit.lat),
      longitude: String(hit.lng),
      parkingchrgeInfo: '무료',
      operDay: '매일',
      weekdayOperOpenHhmm: h.open,
      weekdayOperColseHhmm: h.close,
      satOperOperOpenHhmm: h.open,
      satOperCloseHhmm: h.close,
      holidayOperOpenHhmm: h.open,
      holidayCloseOpenHhmm: h.close,
      basicTime: '0',
      basicCharge: '0',
      addUnitTime: '0',
      addUnitCharge: '0',
      dayCmmtkt: '0',
      prkcmprt: it.row.capacity || '0',
      spcmnt: '',
      institutionNm: it.source.institution,
      pzSource: it.source.sourceUrl,
      pzVerifiedOn: today,
    })
  }

  await writeFile(
    out,
    JSON.stringify(
      {
        source: '지자체 공식 주차장 표 (' + sources.map((s) => s.institution).join(', ') + ')',
        sourceUrl: sources[0]?.sourceUrl ?? '',
        license: '각 지자체 공식 페이지의 무료 공영주차장 표를 옮긴 값. 좌표는 지번·도로명을 확인해 채움',
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

if (process.argv[1] && process.argv[1].includes('fetch-region-tables')) {
  main().catch((err) => {
    console.error('✗ 실패:', err.message)
    process.exit(1)
  })
}
