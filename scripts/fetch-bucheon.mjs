#!/usr/bin/env node
/**
 * 부천도시공사 주차포털로 부천 주차장의 빈 요금 칸을 채우고 빠진 곳을 더한다.
 *
 * 표준데이터의 부천 109곳 중 108곳이 요금 칸이 비어 있다. 전국에서 한 기관이 만든
 * '요금 미공개' 로는 가장 큰 덩어리다(부천도시공사 105곳). 부천시 주차포털에는
 * 같은 주차장들의 요금표가 그대로 공개돼 있다.
 *
 * 출처: https://parking.bcits.go.kr — 공영주차장 목록 AJAX (인증 불필요)
 *   POST /publicparking/ajax_select_publicparking_list.do
 *
 * 두 가지를 함께 내보낸다.
 *   bucheon-fees.json — 이미 등록된 주차장의 빈 요금 칸을 채울 값 (좌표로 짝지음)
 *   bucheon.json      — 표준데이터에 아예 없는 주차장
 *
 * 좌표로 짝짓는 이유: 표준데이터의 이름은 '부천시 소사구 소원공영주차장' 인데
 * 포털은 '소원' 이다. 이름으로는 맞출 수 없고 좌표는 60m 안에서 일치한다.
 *
 * ── TLS 주의 ────────────────────────────────────────────────
 * parking.bcits.go.kr 은 정상적인 DigiCert(RapidSSL) 인증서를 쓰지만 중간 인증서를
 * 함께 보내지 않는다. Node 는 자체 CA 목록만 보므로 UNABLE_TO_VERIFY_LEAF_SIGNATURE
 * 로 끊긴다. 운영체제 신뢰 저장소를 쓰면 중간 인증서를 채워서 검증이 통과한다.
 * 검증을 끄는 게 아니라 신뢰 저장소를 바꾸는 것이므로 안전하다.
 *
 * 사용: node --use-system-ca scripts/fetch-bucheon.mjs   (npm run data:bucheon)
 */
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const LIST_URL = 'https://parking.bcits.go.kr/publicparking/ajax_select_publicparking_list.do'
const SNAPSHOT = path.join('public', 'data', 'parkings.full.json')
const OUT_SUPP = path.join('public', 'data', 'bucheon.json')
const OUT_FEES = path.join('public', 'data', 'bucheon-fees.json')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
/** 같은 주차장으로 볼 거리(m). 부천 노외주차장은 서로 충분히 떨어져 있다. */
const MATCH_METERS = 60

const squash = (s) => String(s ?? '').split(/[ \t\r\n]+/).join(' ').trim()
const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** 'HH:MM' → 'HHMM'. 23:59 는 사실상 자정이라 2400 으로 맞춘다. */
export function readTime(v) {
  const s = squash(v)
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (!m) return ''
  const h = Number(m[1])
  const mi = Number(m[2])
  if (h > 24 || mi > 59) return ''
  if (h === 23 && mi === 59) return '2400'
  return String(h).padStart(2, '0') + m[2]
}

function metersBetween(aLat, aLng, bLat, bLng) {
  const R = 6371000
  const rad = (x) => (x * Math.PI) / 180
  const dLat = rad(bLat - aLat)
  const dLng = rad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function findRows(obj) {
  let found = null
  const walk = (o) => {
    if (found || !o || typeof o !== 'object') return
    if (Array.isArray(o) && o.length && o[0] && (o[0].PARKING_NM || o[0].PORTAL_PARKING_NM)) {
      found = o
      return
    }
    for (const v of Object.values(o)) walk(v)
  }
  walk(obj)
  return found ?? []
}

async function main() {
  const today = new Date().toISOString().slice(0, 10)

  const res = await fetch(LIST_URL, {
    method: 'POST',
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': UA, Referer: 'https://parking.bcits.go.kr/' },
  })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const api = findRows(await res.json())
  console.log('부천 공영주차장: ' + api.length + '건')
  if (api.length === 0) throw new Error('주차장 배열을 찾지 못했습니다.')

  const snapRows = existsSync(SNAPSHOT) ? (JSON.parse(await readFile(SNAPSHOT, 'utf-8')).data ?? []) : []
  const nearby = snapRows.filter((r) => Number(r.latitude) > 33 && /부천/.test(String(r.rdnmadr ?? '') + String(r.lnmadr ?? '')))
  const anyLot = snapRows.filter((r) => Number(r.latitude) > 33)

  const fees = []
  const supp = []
  const tally = {}
  const bump = (k) => {
    tally[k] = (tally[k] ?? 0) + 1
  }

  for (const r of api) {
    const lat = Number(r.LAT)
    const lng = Number(r.LNG)
    if (!(lat > 33 && lat < 39 && lng > 124 && lng < 132)) {
      bump('좌표 없음')
      continue
    }
    const basicCharge = num(r.DFLT_AMT)
    const addCharge = num(r.INTVL_AMT)
    if (basicCharge === 0 && addCharge === 0) {
      // 요금이 안 적힌 곳은 채울 것이 없다. 무료라는 표시가 아니다.
      bump('요금 미입력')
      continue
    }

    // 가장 가까운 기존 레코드를 찾는다.
    let best = null
    let bestD = Infinity
    for (const s of nearby) {
      const d = metersBetween(lat, lng, Number(s.latitude), Number(s.longitude))
      if (d < bestD) {
        bestD = d
        best = s
      }
    }

    if (best && bestD < MATCH_METERS) {
      const hasFee = num(best.basicCharge) > 0 || num(best.addUnitCharge) > 0
      if (hasFee || String(best.parkingchrgeInfo ?? '').trim() === '무료') {
        bump('기존에 요금이 이미 있음')
        continue
      }
      fees.push({
        prkplceNo: String(best.prkplceNo ?? ''),
        prkplceNm: String(best.prkplceNm ?? ''),
        basicTime: String(num(r.DFLT_TM)),
        basicCharge: String(basicCharge),
        addUnitTime: String(num(r.INTVL_TM)),
        addUnitCharge: String(addCharge),
        dayCmmtkt: String(num(r.DAY_PARKING_AMT)),
        extraNote: '',
        matchedName: squash(r.PORTAL_PARKING_NM || r.PARKING_NM),
        matchedMeters: Math.round(bestD),
      })
      bump('요금 채움')
      continue
    }

    // 부천 밖 레코드까지 포함해 한 번 더 본다 — 경계에 걸친 주차장이 있다.
    if (anyLot.some((s) => metersBetween(lat, lng, Number(s.latitude), Number(s.longitude)) < MATCH_METERS)) {
      bump('다른 레코드와 중복')
      continue
    }

    bump('새로 추가')
    supp.push({
      prkplceNo: 'PZ-BC-' + squash(r.PARKING_ID),
      prkplceNm: '부천 ' + squash(r.PORTAL_PARKING_NM || r.PARKING_NM) + ' 공영주차장',
      prkplceSe: '공영',
      prkplceType: /노상/.test(squash(r.PARKING_DIV_CD)) ? '노상' : '노외',
      rdnmadr: squash(r.CELL_ADDR_LOAD) || squash(r.CELL_ADDR_JIBUN) || squash(r.PARKING_ADDR),
      latitude: String(lat),
      longitude: String(lng),
      parkingchrgeInfo: '유료',
      operDay: '매일',
      weekdayOperOpenHhmm: readTime(r.WDAYS_START_TM),
      weekdayOperColseHhmm: readTime(r.WDAYS_END_TM),
      satOperOperOpenHhmm: readTime(r.WEND_START_TM),
      satOperCloseHhmm: readTime(r.WEND_END_TM),
      holidayOperOpenHhmm: readTime(r.HEND_START_TM),
      holidayCloseOpenHhmm: readTime(r.HEND_END_TM),
      basicTime: String(num(r.DFLT_TM)),
      basicCharge: String(basicCharge),
      addUnitTime: String(num(r.INTVL_TM)),
      addUnitCharge: String(addCharge),
      dayCmmtkt: String(num(r.DAY_PARKING_AMT)),
      monthCmmtkt: String(num(r.PERIOD_TICKET_AMT)),
      prkcmprt: String(num(r.CELL_CNT)),
      spcmnt: squash(r.NOTE),
      institutionNm: squash(r.MNG_NM) || '부천도시공사',
      phoneNumber: squash(r.TEL_NO),
      pzSource: 'https://parking.bcits.go.kr',
      pzVerifiedOn: today,
    })
  }

  const meta = {
    source: '부천시 주차포털 (부천도시공사)',
    sourceUrl: 'https://parking.bcits.go.kr',
    license: '부천도시공사 공개 주차장 정보',
    fetchedOn: today,
  }
  await writeFile(OUT_FEES, JSON.stringify({ ...meta, rows: fees }, null, 1), 'utf-8')
  await writeFile(OUT_SUPP, JSON.stringify({ ...meta, rows: supp }, null, 1), 'utf-8')
  console.log('요금 채움표: ' + fees.length + '곳 → ' + OUT_FEES)
  console.log('새 주차장:   ' + supp.length + '곳 → ' + OUT_SUPP)
  console.log('분류: ' + JSON.stringify(tally))
}

if (process.argv[1] && process.argv[1].includes('fetch-bucheon')) {
  main().catch((err) => {
    console.error('✗ 실패:', err.message)
    process.exit(1)
  })
}
