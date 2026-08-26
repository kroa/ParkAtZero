#!/usr/bin/env node
/**
 * 공공기관이 청사·학교 주차장을 시민에게 열어 둔 '개방주차장'을 모은다.
 *
 * 도서관·주민센터·학교처럼 건물에 딸린 주차장은 전국주차장정보표준데이터에 거의 없다.
 * 주차장이 아니라 <시설>로 등록되기 때문이다. 그래서 별도 출처가 필요하다.
 *
 * ── 담는 것 ──────────────────────────────────────────────
 *  1) 전국공공시설개방정보표준데이터(15013117) 중 이름에 '주차'가 든 무료 시설
 *  2) 인천 부평구 학교주차장 야간개방(15102680)
 *
 * ── 일부러 뺀 것 ─────────────────────────────────────────
 *  · 대구 북구·달서구 개방공유 주차장(15096534·15110065)
 *    — 34곳 모두 '특정행사 시 개방불가', '교회행사시 주차금지' 단서가 붙는다.
 *      언제 닫히는지 데이터에 없으니 무료라고 안내하면 헛걸음을 시킨다.
 *  · 인천 미추홀구 부설주차장 개방(15080780)
 *    — 개방 시간대 칸이 아예 없다. '언제' 무료인지 말할 수 없다.
 *  · 대구광역시 부설주차장 운영및개방공유정보(15109421, 5,362행)
 *    — 개방 목록이 아니라 건물별 부설주차장 대장이다. '무료' 4,364곳은 대부분
 *      상가·모텔·교회가 제 고객에게 공짜라는 뜻이지 시민 개방이 아니다.
 *
 * ── 무료인데 시간이 있는 곳 ────────────────────────────────
 * 야간개방 주차장은 열려 있는 동안 공짜고, 닫히면 못 들어간다. 그래서 요금정보에 '무료'를
 * 넣고 운영시간에 개방시간을 넣는다. 앱은 무료 구간을 운영시간과 교차하므로 문이 닫힌
 * 시간은 '미운영'으로 나온다 — 이게 사실과 맞다.
 *
 * 사용: node scripts/fetch-open-facility.mjs [출력경로]
 *       KAKAO_REST_API_KEY 가 있으면 좌표 없는 행을 주소로 채운다.
 */
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { decodeCsv, downloadFile, downloadStandard, parseCsv } from './lib/datago.mjs'
import { geocodeAll } from './lib/geocode.mjs'

const DEFAULT_OUT = path.join('public', 'data', 'open-facility.json')
const PUBFAC_PK = '15013117'
const BUPYEONG_PK = '15102680'
const pageUrl = (pk, kind) => 'https://www.data.go.kr/data/' + pk + '/' + kind + '.do'

const squash = (s) => String(s ?? '').split(/[ \t\r\n]+/).join(' ').trim()

/** '09:00' · '0900' · '9시' → '0900'. 못 읽으면 null. */
export function hhmm(text) {
  const s = squash(text)
  if (!s) return null
  const colon = /^(\d{1,2})\s*[:시]\s*(\d{1,2})?/.exec(s)
  if (colon) {
    const h = Number(colon[1])
    const m = Number(colon[2] ?? 0)
    if (h > 24 || m > 59) return null
    return String(h).padStart(2, '0') + String(m).padStart(2, '0')
  }
  const bare = /^(\d{4})$/.exec(s)
  if (bare) return bare[1]
  return null
}

/**
 * 휴관일 문구에서 <문 닫는 요일>을 읽는다.
 * '연중무휴' 는 빈 집합. '월+법정 공휴일' 은 공휴일을 뺀다.
 * 토·일이 아닌 평일 휴관(월요일 휴관 등)은 이 앱의 요일 구분(평일/토/공휴일)으로
 * 표현할 수 없으므로 특기사항에만 남기고 운영요일에서 빼지 않는다.
 */
export function closedDayTypes(text) {
  const s = squash(text)
  const out = new Set()
  if (!s || /연중\s*무휴|없음|무휴/.test(s)) return out

  /*
   * 자바스크립트의 \b 는 한글에 걸리지 않는다. '매주 토+일+공휴일' 에서 '토\b' 는
   * 토와 + 가 둘 다 비단어 문자라 경계가 없어 매칭에 실패한다. 그대로 두면 토요일
   * 휴관인 청사가 토요일에 문을 여는 것으로 읽힌다. 그래서 글자로 직접 본다.
   * '평일' 은 먼저 지운다 — 그 안의 '일' 을 일요일로 오독하지 않으려는 것이다.
   */
  const t = s.replace(/평일/g, '')
  if (/토|주말/.test(t)) out.add('토요일')
  // '월요일' 의 '일' 은 앞이 한글이라 걸리지 않는다. 홀로 선 '일' 만 일요일로 본다.
  if (/일요일|공휴일|주말|명절|(^|[^가-힣])일([^가-힣]|$)/.test(t)) out.add('공휴일')
  return out
}

/**
 * 개방시설의 '00:00-00:00' 은 그날 열지 않는다는 뜻이다.
 * 노상주차장 표준데이터의 관례(시작과 끝이 같으면 24시간)를 여기에 적용하면
 * 문 닫은 청사를 24시간 무료 주차장으로 안내하게 된다.
 */
function usableRange(pair) {
  if (!pair[0] || !pair[1]) return null
  if (pair[0] === pair[1]) return null
  return pair
}

/** 앱이 쓰는 표준데이터 모양으로 한 행을 만든다. */
function makeRow({ no, name, type, addr, lat, lng, slots, weekday, saturday, holiday, note, org, source, today }) {
  const operDay = ['평일', saturday ? '토요일' : '', holiday ? '공휴일' : ''].filter(Boolean).join('+')
  return {
    prkplceNo: no,
    prkplceNm: name,
    prkplceSe: '공영',
    prkplceType: type,
    rdnmadr: addr,
    latitude: String(lat),
    longitude: String(lng),
    prkcmprt: slots ? String(slots) : '',
    operDay,
    weekdayOperOpenHhmm: weekday?.[0] ?? '',
    weekdayOperColseHhmm: weekday?.[1] ?? '',
    satOperOperOpenHhmm: saturday?.[0] ?? '',
    satOperCloseHhmm: saturday?.[1] ?? '',
    holidayOperOpenHhmm: holiday?.[0] ?? '',
    holidayCloseOpenHhmm: holiday?.[1] ?? '',
    parkingchrgeInfo: '무료',
    basicTime: '0',
    basicCharge: '0',
    addUnitTime: '0',
    addUnitCharge: '0',
    spcmnt: note,
    institutionNm: org,
    pzSource: source,
    pzVerifiedOn: today,
  }
}

/** 1) 전국공공시설개방정보 — 이름에 '주차'가 들고 유료사용여부가 N 인 것. */
async function fromPublicFacility(today) {
  const all = await downloadStandard(PUBFAC_PK)
  console.log('전국공공시설개방정보: ' + all.length + '행')

  const rows = []
  const tally = { 주차아님: 0, 유료: 0, 좌표없음: 0, 시각없음: 0, 담음: 0 }

  for (const r of all) {
    const name = squash(r['개방시설명'])
    const place = squash(r['개방장소명'])
    if (!/주차/.test(name + place)) {
      tally.주차아님++
      continue
    }
    if (squash(r['유료사용여부']) !== 'N') {
      tally.유료++
      continue
    }
    const lat = Number(r['위도'])
    const lng = Number(r['경도'])
    if (!(lat > 33 && lat < 39 && lng > 124 && lng < 132)) {
      tally.좌표없음++
      continue
    }

    const wd = usableRange([hhmm(r['평일운영시작시각']), hhmm(r['평일운영종료시각'])])
    const we = usableRange([hhmm(r['주말운영시작시각']), hhmm(r['주말운영종료시각'])])
    if (!wd) {
      tally.시각없음++
      continue
    }

    const closed = closedDayTypes(r['휴관일'])
    const weekend = we
    const rest = squash(r['휴관일'])
    const label = /주차/.test(name) ? name : place + ' ' + name

    rows.push(
      makeRow({
        no: 'PZ-OPEN-' + squash(r['제공기관코드'] || '') + '-' + rows.length,
        name: squash(label),
        type: '부설',
        addr: squash(r['소재지도로명주소']) || squash(r['소재지지번주소']),
        lat,
        lng,
        slots: '',
        weekday: wd,
        saturday: weekend && !closed.has('토요일') ? weekend : null,
        holiday: weekend && !closed.has('공휴일') ? weekend : null,
        note: ['공공시설 개방 주차장 — 무료', rest && rest !== '연중무휴' ? '휴관일 ' + rest : '']
          .filter(Boolean)
          .join('. '),
        org: squash(r['관리기관명']) || squash(r['제공기관명']),
        source: pageUrl(PUBFAC_PK, 'standard'),
        today,
      }),
    )
    tally.담음++
  }
  console.log('  분류: ' + JSON.stringify(tally))
  return rows
}

/** 2) 인천 부평구 학교주차장 야간개방 — 매일 저녁부터 다음날 아침까지 개방한다. */
async function fromBupyeongSchools(today, kakaoKey) {
  const file = await downloadFile(BUPYEONG_PK)
  const rows = parseCsv(decodeCsv(file.buffer))
  console.log('인천 부평구 학교주차장: ' + rows.length + '행')

  const wanted = []
  for (const r of rows) {
    const name = squash(r['학교명'])
    const addr = squash(r['소재지'])
    // '당일 18:00~다음날 07:30' 처럼 적힌다. 앞뒤 두 시각만 쓴다.
    const wd = /(\d{1,2}:\d{2})\s*[~∼-]\s*(?:다음날|익일)?\s*(\d{1,2}:\d{2})/.exec(squash(r['개방시간(평일)']))
    const we = /(\d{1,2}:\d{2})\s*[~∼-]\s*(?:휴일\s*)?(?:다음날|익일)?\s*(\d{1,2}:\d{2})/.exec(
      squash(r['개방시간(주말_공휴일)']),
    )
    if (!name || !addr || !wd) continue
    wanted.push({
      name,
      addr,
      slots: squash(r['개방면수(면)']),
      weekday: [hhmm(wd[1]), hhmm(wd[2])],
      weekend: we ? [hhmm(we[1]), hhmm(we[2])] : null,
    })
  }
  if (wanted.length === 0) return []
  if (!kakaoKey) {
    console.log('  ! KAKAO_REST_API_KEY 가 없어 좌표를 못 채웁니다 — 건너뜁니다')
    return []
  }

  const found = await geocodeAll(
    wanted.map((w) => ({ key: w.name, addr: w.addr })),
    kakaoKey,
  )
  const out = []
  for (const w of wanted) {
    const hit = found.get(w.name)
    if (!hit) continue
    out.push(
      makeRow({
        no: 'PZ-OPEN-BUPYEONG-' + out.length,
        name: w.name + ' 주차장(야간개방)',
        type: '부설',
        addr: w.addr,
        lat: hit.lat,
        lng: hit.lng,
        slots: w.slots,
        weekday: w.weekday,
        saturday: w.weekend,
        holiday: w.weekend,
        note: '부평구 학교주차장 야간개방 — 개방시간 무료',
        org: '인천광역시 부평구청',
        source: pageUrl(BUPYEONG_PK, 'fileData'),
        today,
      }),
    )
  }
  console.log('  좌표 확인 ' + out.length + '/' + wanted.length + '곳')
  return out
}

/**
 * 이미 담긴 주차장과 같은 곳이면 뺀다.
 *
 * 이름이 달라 격자 분할의 <이름@좌표> 대조를 빠져나가는 중복이 있다.
 * '포항시청사 부설주차장' 과 '경상북도 포항시청 부설주차장' 은 좌표가 0m 차이인
 * 같은 주차장이고, 'New평리도서관' 과 '평리도서관' 도 7m 차이다. 그대로 두면
 * 지도에 핀이 둘 겹치고 요금 설명이 서로 어긋난다.
 *
 * 25m 로 자른다. 그보다 멀면 청사 부설과 그 앞 노상처럼 실제로 다른 주차장이다
 * (부평남초 부설 ↔ 남새싹5길 노상이 39m).
 */
async function dropKnown(rows) {
  const files = [
    path.join('public', 'data', 'parkings.full.json'),
    path.join('src', 'data', 'supplements.json'),
    path.join('public', 'data', 'seoul-lots.json'),
    path.join('public', 'data', 'daegu.json'),
    path.join('public', 'data', 'gwangju.json'),
    path.join('public', 'data', 'region-lots.json'),
    path.join('public', 'data', 'gyeonggi.json'),
  ]
  const known = []
  for (const f of files) {
    if (!existsSync(f)) continue
    const j = JSON.parse(await readFile(f, 'utf-8'))
    for (const r of j.data ?? j.rows ?? []) {
      const lat = Number(r.latitude)
      const lng = Number(r.longitude)
      if (Number.isFinite(lat) && Number.isFinite(lng)) known.push([lat, lng])
    }
  }

  const metres = (aLat, aLng, bLat, bLng) => {
    const rad = (x) => (x * Math.PI) / 180
    const dLat = rad(bLat - aLat)
    const dLng = rad(bLng - aLng)
    const h =
      Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2
    return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
  }

  const kept = rows.filter((r) => {
    const lat = Number(r.latitude)
    const lng = Number(r.longitude)
    return !known.some(([kLat, kLng]) => metres(lat, lng, kLat, kLng) < 25)
  })
  console.log('이미 있는 주차장과 겹쳐 뺌: ' + (rows.length - kept.length) + '곳 (기준 ' + known.length + '곳)')
  return kept
}

async function main() {
  const out = process.argv[2] || DEFAULT_OUT
  const today = new Date().toISOString().slice(0, 10)
  const kakaoKey = process.env.KAKAO_REST_API_KEY

  const rows = await dropKnown([
    ...(await fromPublicFacility(today)),
    ...(await fromBupyeongSchools(today, kakaoKey)),
  ])

  await writeFile(
    out,
    JSON.stringify(
      {
        source: '공공데이터포털 — 전국공공시설개방정보표준데이터, 인천 부평구 학교주차장 개방 현황',
        sourceUrl: pageUrl(PUBFAC_PK, 'standard'),
        license: '공공누리 제1유형',
        fetchedOn: today,
        rows,
      },
      null,
      1,
    ),
    'utf-8',
  )
  console.log('저장: ' + rows.length + '곳 → ' + out)
}

if (process.argv[1] && process.argv[1].includes('fetch-open-facility')) {
  main().catch((err) => {
    console.error('✗ 실패:', err.message)
    process.exit(1)
  })
}
