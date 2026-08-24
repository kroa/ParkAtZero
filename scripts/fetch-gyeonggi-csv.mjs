#!/usr/bin/env node
/**
 * 경기도 시·공사가 공공데이터포털에 올린 공영주차장 CSV 를 좌표까지 채워 보완 데이터로 만든다.
 *
 * 두 곳을 담는다. 둘 다 인증 없이 내려받히고 주소만 있어 지오코딩이 필요하다.
 *
 *   시흥도시공사_유무료공영주차장현황  — 유료구분 칸에 무료/유료가 직접 적혀 있다
 *   수원도시공사_공영주차장 현황        — 급지·기본요금·추가단위·1일권까지 들어 있다
 *
 * ── 시흥의 '나눔주차장' 41곳은 담지 않는다 ──────────────────
 * 자료에는 '무료 · 24시간' 으로 올라 있지만, 이 주차장들을 안내하는 곳이
 * park.siheung.go.kr 인데 그 사이트는 거주자우선주차 배정 포털이다.
 * 일반 이용자가 아무 때나 댈 수 있는지 공식 문구로 확인하지 못했다.
 * 배정받은 사람만 쓰는 자리를 '무료'로 안내하면 갔다가 못 대고 돌아오게 된다.
 * 확인되면 그때 넣는다.
 *
 * ── 수원은 무료가 아니라 '최초 N분 무료' 다 ────────────────
 * 62곳 전부 유료인데 기본요금 칸이 '최초 1시간 무료'(57곳) 또는 '30분무료'(5곳) 다.
 * 기본시간에 그 시간을, 기본요금에 0 을 넣으면 초과분만 추가요금으로 계산된다.
 * 특기사항에 '최초 1시간 무료' 를 또 적지 않는다 — 요금표와 특기사항 양쪽에서
 * 빼면 두 배로 공제되어 2시간이 통째로 공짜가 된다.
 *
 * 필요한 환경변수: KAKAO_REST_API_KEY
 * 사용: node scripts/fetch-gyeonggi-csv.mjs [출력경로]
 */
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { geocodeAll } from './lib/geocode.mjs'

const SNAPSHOT = path.join('public', 'data', 'parkings.full.json')
const DEFAULT_OUT = path.join('public', 'data', 'gyeonggi.json')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
const DUP_METERS = 40

const SOURCES = [
  {
    id: 'SH',
    city: '시흥시',
    prefix: '경기도 시흥시',
    institution: '시흥도시공사',
    url: 'https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003116723&fileDetailSn=1&insertDataPrcus=N',
    page: 'https://www.data.go.kr/data/15110768/fileData.do',
    name: '시흥도시공사_유무료공영주차장현황',
  },
  {
    id: 'SW',
    city: '수원시',
    prefix: '경기도 수원시',
    institution: '수원도시공사',
    url: 'https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003596389&fileDetailSn=1&insertDataPrcus=N',
    page: 'https://www.data.go.kr/data/15074539/fileData.do',
    name: '수원도시공사_공영주차장 현황',
  },
]

const squash = (s) => String(s ?? '').split(/[ \t\r\n]+/).join(' ').trim()
const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 0
}

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
 * '최초 1시간 무료' / '30분무료' 를 기본시간(분)으로. 금액이 적혀 있으면 그 금액을 쓴다.
 * 읽을 수 없으면 null — 넘겨짚어 0원으로 만들지 않는다.
 */
export function readBasic(text) {
  const s = squash(text)
  if (!s) return null
  if (/무료/.test(s)) {
    const h = /(\d+)\s*시간/.exec(s)
    const m = /(\d+)\s*분/.exec(s)
    const minutes = (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0)
    return minutes > 0 ? { time: minutes, charge: 0 } : null
  }
  const won = num(s)
  return won > 0 ? { time: 0, charge: won } : null
}

function metersBetween(aLat, aLng, bLat, bLng) {
  const R = 6371000
  const rad = (x) => (x * Math.PI) / 180
  const dLat = rad(bLat - aLat)
  const dLng = rad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

async function loadCsv(src) {
  const res = await fetch(src.url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(src.name + ' HTTP ' + res.status)
  const rows = parseCsv(new TextDecoder('euc-kr').decode(await res.arrayBuffer()))
  const head = rows[0].map((h) => squash(h))
  return { head, body: rows.slice(1).filter((r) => r.length > 2), get: (r, n) => squash(r[head.indexOf(n)]) }
}

async function main() {
  const out = process.argv[2] || DEFAULT_OUT
  const kakaoKey = process.env.KAKAO_REST_API_KEY
  if (!kakaoKey) {
    console.error('✗ KAKAO_REST_API_KEY 가 없습니다.')
    process.exit(1)
  }
  const today = new Date().toISOString().slice(0, 10)

  const tally = {}
  const bump = (k) => {
    tally[k] = (tally[k] ?? 0) + 1
  }
  const items = []

  for (const src of SOURCES) {
    const { body, get } = await loadCsv(src)
    console.log(src.name + ': ' + body.length + '행')

    for (const r of body) {
      if (src.id === 'SH') {
        if (get(r, '유료구분') !== '무료') {
          bump('시흥 유료 제외')
          continue
        }
        const kind = get(r, '구분')
        if (kind === '나눔주차장') {
          bump('시흥 나눔주차장 제외')
          continue
        }
        const nm = get(r, '주차장명')
        if (/거주자|주거지/.test(nm)) {
          bump('시흥 거주자 제외')
          continue
        }
        items.push({
          key: src.id + '#' + items.length,
          addr: src.prefix + ' ' + get(r, '주소'),
          src,
          name: nm,
          type: kind === '노상' ? '노상' : '노외',
          charge: '무료',
          fee: { basicTime: '0', basicCharge: '0', addUnitTime: '0', addUnitCharge: '0', dayCmmtkt: '0' },
          capacity: get(r, '주차면'),
        })
      } else {
        const basic = readBasic(get(r, '주차기본요금(원)'))
        if (!basic) {
          bump('수원 요금 해석 불가')
          continue
        }
        const addr = get(r, '소재지도로명주소') || get(r, '소재지지번주소')
        if (!addr) {
          bump('수원 주소 없음')
          continue
        }
        items.push({
          key: src.id + '#' + items.length,
          addr: src.prefix + ' ' + addr,
          src,
          name: get(r, '주차장명'),
          type: get(r, '주차장유형') || '노외',
          charge: '유료',
          fee: {
            basicTime: String(basic.time),
            basicCharge: String(basic.charge),
            addUnitTime: String(num(get(r, '추가단위시간'))),
            addUnitCharge: String(num(get(r, '추가단위요금(원)'))),
            dayCmmtkt: String(num(get(r, '1일주차권요금(원)'))),
          },
          capacity: get(r, '주차구획수'),
        })
      }
    }
  }
  console.log('좌표를 찾을 대상: ' + items.length + '곳')

  const found = await geocodeAll(items, kakaoKey, (done, total, n) =>
    console.log('  ' + done + '/' + total + ' (찾음 ' + n + ')'),
  )
  console.log('지오코딩: ' + found.size + '/' + items.length + '곳')

  const existing = []
  if (existsSync(SNAPSHOT)) {
    const snap = JSON.parse(await readFile(SNAPSHOT, 'utf-8'))
    for (const r of snap.data ?? snap.rows ?? []) {
      const la = Number(r.latitude)
      const ln = Number(r.longitude)
      if (la > 33 && ln > 124) existing.push([la, ln])
    }
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
    if (seen.some(([la, ln]) => metersBetween(hit.lat, hit.lng, la, ln) < 15)) {
      bump('자체 중복')
      continue
    }
    seen.push([hit.lat, hit.lng])
    bump(it.src.city + ' 추가')

    rows.push({
      prkplceNo: 'PZ-' + it.key.replace('#', '-'),
      prkplceNm: it.name || (it.src.city + ' 공영주차장'),
      prkplceSe: '공영',
      prkplceType: it.type,
      rdnmadr: it.addr,
      latitude: String(hit.lat),
      longitude: String(hit.lng),
      parkingchrgeInfo: it.charge,
      operDay: '매일',
      weekdayOperOpenHhmm: '0000',
      weekdayOperColseHhmm: '2400',
      satOperOperOpenHhmm: '0000',
      satOperCloseHhmm: '2400',
      holidayOperOpenHhmm: '0000',
      holidayCloseOpenHhmm: '2400',
      ...it.fee,
      prkcmprt: it.capacity || '0',
      // 무료 시간은 요금표(기본시간 0원)에만 적는다. 특기사항에 또 적으면 두 번 공제된다.
      spcmnt: '',
      institutionNm: it.src.institution,
      pzSource: it.src.page,
      pzVerifiedOn: today,
    })
  }

  await writeFile(
    out,
    JSON.stringify(
      {
        source: SOURCES.map((s) => s.name).join(' / '),
        sourceUrl: SOURCES[0].page,
        license: '각 도시공사 제공 공공데이터. 좌표는 주소로 찾아 지번·도로명을 확인한 것만 씀',
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

if (process.argv[1] && process.argv[1].includes('fetch-gyeonggi-csv')) {
  main().catch((err) => {
    console.error('✗ 실패:', err.message)
    process.exit(1)
  })
}
