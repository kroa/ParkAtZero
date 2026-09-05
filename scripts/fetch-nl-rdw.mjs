#!/usr/bin/env node
/**
 * 네덜란드 RDW 주차 개방데이터를 이 앱의 모양으로 옮긴다. (시제품)
 *
 * 한국 다음으로 만들 나라를 고르며 <데이터가 실제로 되는지>를 확인하려고 만든 것이다.
 * 아직 앱에 연결하지 않는다 — UI가 100% 한국어라 i18n 없이는 붙일 수 없다.
 *
 * ── 왜 네덜란드인가 ────────────────────────────────────────
 * 요금표·요일별 징수시간·공휴일·좌표가 한 나라 단위로, 인증키 없이 열린다.
 * 한국에서 조례 HWP를 파싱해 얻어야 했던 것을 여기는 데이터로 준다.
 *
 * ── 사슬 ──────────────────────────────────────────────────
 *   GEBIED_REGELING (구역↔규정)  ─┐
 *   TIJDVAK         (요일별 징수시간) ├→ 언제 요금을 받는가
 *   TARIEFDEEL      (구간요금)     ─┘
 *   GEOMETRIE       (좌표)
 *
 * ── 만료일 함정 ───────────────────────────────────────────
 * 만료일이 <빈 값>인 행이 많다. 그건 '끝나지 않았다'는 뜻인데, 문자열로 비교하면
 * 빈 값이 과거보다 작아 전부 만료로 걸러진다. 실제로 그렇게 세었다가 좌표 있는 구역을
 * 6,073개가 아니라 1,013개로 잘못 셌다. live() 가 이걸 막는다.
 *
 * ── 어디까지 됐고 무엇이 남았나 (2026-09-06 실측) ──────────
 * 현행 구역 9,641개 중 좌표까지 갖춘 것 6,073개(지자체 241곳). 이 중 4,993개를 옮겼다.
 *
 * 원본을 직접 조회해 계산한 <참값>과, 이 파일이 만든 행을 앱 엔진에 넣은 결과가 아직 다르다.
 *              참값    이 시제품
 *   월요일 14시   4%      19%
 *   월요일 22시  47%      53%
 *   일요일 14시  32%      28%
 * 게다가 4,993개 중 2,237개(45%)가 요금을 못 붙여 '정보 부족'으로 나온다.
 *
 * 원인은 모델이 다르기 때문이다. 네덜란드는 <규정 → 요일별 시간대 → 시간대마다 요금코드>
 * 인데, 이 앱의 한국 스키마는 <요일마다 운영시간 하나 + 주차장마다 요금 하나>다.
 * 시간대가 여럿인 규정을 요일당 한 구간으로 접으면(가장 이른 시작~가장 늦은 종료)
 * 실제보다 넓게 징수하는 것으로 읽히고, 요금도 시간대별로 다른 것을 하나로 뭉갠다.
 *
 * 즉 이 나라를 담으려면 <수집기를 쓰는 일>이 아니라 <요금 모델을 일반화하는 일>이다.
 * 그 전까지 이 파일은 판단 근거일 뿐 앱에 연결하지 않는다.
 *
 * 사용: node scripts/fetch-nl-rdw.mjs [출력경로]
 */
import path from 'node:path'
import { writeFile } from 'node:fs/promises'

const B = 'https://opendata.rdw.nl/resource'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
const DEFAULT_OUT = path.join('public', 'data', 'nl-parking.json')

/** 오늘(YYYYMMDD). 만료 판정 기준. */
function today() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '')
}

/** 만료일이 비었거나 오늘 이후면 현행. ISO·YYYYMMDD 둘 다 받는다. */
export function live(value, ymd) {
  const s = String(value ?? '').replace(/\D/g, '').slice(0, 8)
  return s === '' || s > ymd
}

async function page(id, params = {}, size = 10000) {
  const out = []
  for (let off = 0; off < 200_000; off += size) {
    const url = B + '/' + id + '.json?' + new URLSearchParams({ ...params, $limit: String(size), $offset: String(off) })
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!res.ok) throw new Error(id + ' 응답 ' + res.status)
    const rows = await res.json()
    out.push(...rows)
    if (rows.length < size) break
  }
  return out
}

/** 'POINT (4.9 52.3)' · 'POLYGON ((...))' → 대표 좌표 하나 */
export function centroid(wkt) {
  const nums = String(wkt ?? '').match(/-?\d+\.\d+/g)
  if (!nums || nums.length < 2) return null
  let sx = 0
  let sy = 0
  let n = 0
  for (let i = 0; i + 1 < nums.length; i += 2) {
    sx += Number(nums[i])
    sy += Number(nums[i + 1])
    n++
  }
  if (n === 0) return null
  const lng = sx / n
  const lat = sy / n
  // 네덜란드 범위 밖이면 버린다 — 좌표 순서가 뒤바뀐 행이 섞여 있다.
  if (lat < 50 || lat > 54 || lng < 3 || lng > 8) return null
  return { lat, lng }
}

/** 'HHMM' 류 → 자정 기준 분. */
export function toMinutes(v) {
  const n = Number(String(v ?? '').replace(/\D/g, ''))
  if (!Number.isFinite(n)) return null
  return Math.floor(n / 100) * 60 + (n % 100)
}

/*
 * 네덜란드 요일 낱말 → 이 앱의 요일 구분.
 * KOOPZONDAG(쇼핑 일요일)·KOOPAVOND(쇼핑 저녁)처럼 한국에 없는 것이 있고,
 * FEESTDAG 는 공휴일이다. 행사명(EVENEMENT_*)은 특정일 한정이라 버린다.
 */
const DAY_MAP = {
  MAANDAG: 'weekday',
  DINSDAG: 'weekday',
  WOENSDAG: 'weekday',
  DONDERDAG: 'weekday',
  VRIJDAG: 'weekday',
  ZATERDAG: 'saturday',
  ZONDAG: 'holiday',
  FEESTDAG: 'holiday',
}

async function main() {
  const out = process.argv[2] || DEFAULT_OUT
  const ymd = today()
  console.log('기준일 ' + ymd)

  const [tvAll, grAll, geoAll, tdAll, amAll] = await Promise.all([
    page('ixf8-gtwq'),
    page('qtex-qwd8'),
    page('nsk3-v9n7'),
    page('534e-5vdg'),
    page('2uc2-nnv3'),
  ])

  const tv = tvAll.filter((r) => live(r.enddatetimeframe, ymd))
  const gr = grAll.filter((r) => live(r.enddatearearegulation, ymd))
  const geo = geoAll.filter((r) => live(r.enddatearea, ymd))
  const td = tdAll.filter((r) => live(r.enddatefarepart, ymd))
  console.log(
    '현행 — 시간대 ' + tv.length + ' · 구역규정 ' + gr.length + ' · 좌표 ' + geo.length + ' · 요금 ' + td.length,
  )

  const amName = new Map(amAll.map((a) => [a.areamanagerid, a.areamanagerdesc ?? a.areamanagerid]))
  const geoBy = new Map()
  for (const g of geo) {
    const c = centroid(g.areageometryastext)
    if (c) geoBy.set(g.areamanagerid + '|' + g.areaid, c)
  }

  const tvBy = new Map()
  for (const t of tv) {
    const k = t.areamanagerid + '|' + t.regulationid
    if (!tvBy.has(k)) tvBy.set(k, [])
    tvBy.get(k).push(t)
  }
  const feeBy = new Map()
  for (const f of td) {
    const k = f.areamanagerid + '|' + f.farecalculationcode
    if (!feeBy.has(k)) feeBy.set(k, [])
    feeBy.get(k).push(f)
  }

  const rows = []
  const tally = { 좌표없음: 0, 시간대없음: 0, 담음: 0 }
  const seen = new Set()

  for (const a of gr) {
    const areaKey = a.areamanagerid + '|' + a.areaid
    if (seen.has(areaKey)) continue
    const pos = geoBy.get(areaKey)
    if (!pos) {
      tally.좌표없음++
      continue
    }
    const slots = tvBy.get(a.areamanagerid + '|' + a.regulationid)
    if (!slots || slots.length === 0) {
      tally.시간대없음++
      continue
    }
    seen.add(areaKey)

    // 요일 구분별로 가장 이른 시작·가장 늦은 종료를 취한다(한국 스키마가 요일당 한 구간이다).
    const span = {}
    for (const s of slots) {
      const day = DAY_MAP[s.daytimeframe]
      if (!day) continue
      const from = toMinutes(s.starttimetimeframe)
      const to = toMinutes(s.endtimetimeframe)
      if (from === null || to === null) continue
      const cur = span[day]
      span[day] = cur ? { from: Math.min(cur.from, from), to: Math.max(cur.to, to) } : { from, to }
    }
    const hhmm = (m) => String(Math.floor(m / 60) % 24).padStart(2, '0') + String(m % 60).padStart(2, '0')
    const operDay = ['weekday', 'saturday', 'holiday']
      .filter((d) => span[d])
      .map((d) => ({ weekday: '평일', saturday: '토요일', holiday: '공휴일' })[d])
      .join('+')

    /*
     * 요금은 <구간별>로 온다. 첫 구간이 0원인 경우가 흔한데(도입 무료 시간),
     * 그것만 보고 '무료 주차장'으로 적으면 유료 구역이 통째로 공짜가 된다.
     * 실제로 그렇게 만들었다가 월요일 14시 무료 비율이 4% 가 아니라 70% 로 나왔다.
     * 한 구간이라도 금액이 있으면 유료다.
     */
    const bands = slots
      .map((s) => s.farecalculationcode)
      .filter(Boolean)
      .flatMap((code) => feeBy.get(a.areamanagerid + '|' + code) ?? [])
      .sort((x, y) => Number(x.startdurationfarepart) - Number(y.startdurationfarepart))
    const paidBand = bands.find((b) => Number(b.amountfarepart) > 0)
    const fee = paidBand ?? bands[0]
    /*
     * 요금 정보를 못 찾았으면 '무료' 가 아니라 <모른다> 다.
     * 요금정보를 비워 두면 앱이 '정보 부족' 으로 표시한다 — 그게 사실에 맞다.
     * 무료로 적으면 유료 구역이 공짜로 둔갑한다.
     */
    const charges = paidBand ? '유료' : bands.length > 0 ? '무료' : ''

    rows.push({
      prkplceNo: 'NL-' + a.areamanagerid + '-' + a.areaid,
      prkplceNm: a.areaid,
      prkplceSe: '공영',
      prkplceType: '노상',
      rdnmadr: amName.get(a.areamanagerid) ?? ('관리자 ' + a.areamanagerid),
      latitude: String(pos.lat),
      longitude: String(pos.lng),
      operDay,
      weekdayOperOpenHhmm: span.weekday ? hhmm(span.weekday.from) : '',
      weekdayOperColseHhmm: span.weekday ? hhmm(span.weekday.to) : '',
      satOperOperOpenHhmm: span.saturday ? hhmm(span.saturday.from) : '',
      satOperCloseHhmm: span.saturday ? hhmm(span.saturday.to) : '',
      holidayOperOpenHhmm: span.holiday ? hhmm(span.holiday.from) : '',
      holidayCloseOpenHhmm: span.holiday ? hhmm(span.holiday.to) : '',
      parkingchrgeInfo: charges,
      basicTime: fee ? String(fee.stepsizefarepart ?? '') : '',
      basicCharge: fee ? String(Math.round(Number(fee.amountfarepart ?? 0) * 100)) : '',
      institutionNm: amName.get(a.areamanagerid) ?? '',
      pzSource: 'https://opendata.rdw.nl/',
      pzVerifiedOn: new Date().toISOString().slice(0, 10),
      pzNote: '금액 단위는 유로센트. 이 앱의 원 통화(원)와 다르므로 그대로 쓰면 안 된다.',
    })
    tally.담음++
  }

  await writeFile(
    out,
    JSON.stringify(
      {
        source: 'RDW Open Data Parkeren (네덜란드)',
        sourceUrl: 'https://opendata.rdw.nl/',
        license: 'CC0 / 공개 데이터',
        fetchedOn: new Date().toISOString().slice(0, 10),
        note: '시제품. 통화·언어·요일 의미가 한국과 달라 앱에 그대로 붙이면 안 된다.',
        tally,
        rows,
      },
      null,
      1,
    ),
    'utf-8',
  )
  console.log('분류: ' + JSON.stringify(tally))
  console.log('저장: ' + rows.length + '구역 → ' + out)
}

if (process.argv[1] && process.argv[1].includes('fetch-nl-rdw')) {
  main().catch((err) => {
    console.error('✗ 실패:', err.message)
    process.exit(1)
  })
}
