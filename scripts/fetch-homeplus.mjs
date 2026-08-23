#!/usr/bin/env node
/**
 * 홈플러스 점포별 주차 안내를 모아 보완 데이터로 만든다.
 *
 * 「전국주차장정보표준데이터」에는 홈플러스 매장 주차장이 한 곳도 없다. 이름에 '홈플러스'가
 * 들어간 2건은 매장 앞 공영주차장이다. 대형마트 주차장은 도심에서 실제로 가장 많이 쓰이는
 * 무료 주차 수단인데 통째로 비어 있던 셈이다.
 *
 * 홈플러스는 매장찾기 API 가 점포별 주차 안내(storParkCntt)를 문자열로 준다.
 *   목록: POST my.homeplus.co.kr/store/get_list  (viewHomeplus/viewExpress/viewPlus/viewSpecial)
 *   상세: POST my.homeplus.co.kr/store/get_view  (storId)
 *
 * storParkCntt 는 사람이 쓴 자유 문구지만 형식이 몇 가지로 수렴한다(전국 388곳 실측).
 *   '무료주차 가능'                    → 조건 없는 무료
 *   '무료주차 가능/1시간'              → 최초 1시간 무료, 구매 조건 없음
 *   '무료주차 가능/1시간(1만원이상)'   → 1만원 이상 사야 1시간 무료
 *   '주차장 이용 : 유료'               → 유료. 금액이 없다
 *   '주차 불가'                        → 주차장이 없다
 *
 * 담는 기준:
 *   - '주차 불가'는 넣지 않는다. 주차장이 없는 곳을 주차장 목록에 넣을 이유가 없다.
 *   - 금액도 조건도 없는 '유료'는 넣지 않는다. 지도에 '미공개' 마커만 늘린다.
 *   - 무료 정보가 있거나 금액이 적힌 곳만 넣는다.
 *
 * 사용: node scripts/fetch-homeplus.mjs [출력경로]
 */
import path from 'node:path'
import { writeFile } from 'node:fs/promises'

const LIST_URL = 'https://my.homeplus.co.kr/store/get_list'
const VIEW_URL = 'https://my.homeplus.co.kr/store/get_view'
const REFERER = 'https://my.homeplus.co.kr/store?hyper=Y'
const LIST_BODY =
  'viewHomeplus=H&viewExpress=E&viewPlus=P&viewSpecial=S&draw=1&pageSize=999&sortFlag=N&searchRegion=&locatePage=N&searchStoreNm='
const DEFAULT_OUT = path.join('public', 'data', 'homeplus.json')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const squash = (s) => String(s ?? '').split(/[ \t\r\n]+/).join(' ').trim()

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'X-Requested-With': 'XMLHttpRequest',
      Referer: REFERER,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    body,
  })
  if (!res.ok) throw new Error(url + ' → HTTP ' + res.status)
  return JSON.parse(await res.text())
}

/** 응답이 { data: [...] } 인지 { rows: [...] } 인지 고정돼 있지 않다. 비어 있지 않은 첫 배열을 쓴다. */
function firstArray(obj) {
  if (Array.isArray(obj)) return obj
  for (const v of Object.values(obj ?? {})) if (Array.isArray(v) && v.length) return v
  return []
}

/** 중첩된 응답에서 문자열 키 하나를 찾는다. 상세 응답이 한 겹 더 감싸져 올 때가 있다. */
function deepGet(obj, key) {
  let found = ''
  const walk = (o) => {
    if (found || !o || typeof o !== 'object') return
    if (typeof o[key] === 'string') {
      found = o[key]
      return
    }
    for (const child of Object.values(o)) walk(child)
  }
  walk(obj)
  return found
}

/** '1시간30분' / '30분' / '2시간' → 분 */
function toMinutes(text) {
  const h = text.match(/([0-9]+)\s*시간/)
  const m = text.match(/([0-9]+)\s*분/)
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0)
}

const NO_PARKING = /주차\s*불가|주차장\s*없음/
const MONEY = /[0-9,]+\s*(?:만|천)?\s*원/
const DURATION = '([0-9]+\\s*시간(?:\\s*[0-9]+\\s*분)?|[0-9]+\\s*분)'
const COND_FREE = new RegExp('무료주차\\s*가능\\s*/\\s*' + DURATION + '\\s*\\(\\s*([0-9,]+\\s*(?:만|천)?\\s*원\\s*이상)[^)]*\\)')
const GRACE_FREE = new RegExp('무료주차\\s*가능\\s*/\\s*' + DURATION)
/** '1만원이상 : 2시간' 처럼 구매 금액별 무료시간을 등급표로 적은 경우 */
const TIER = new RegExp('([0-9,]+\\s*(?:만|천)?\\s*원\\s*이상)\\s*[:~]\\s*' + DURATION, 'g')

/**
 * 주차 안내 문구 하나를 앱이 쓰는 요금 정보로 옮긴다.
 *
 * 판단이 서지 않으면 skip 을 돌려보내고 그 점포는 버린다. 안내 문구를 넘겨짚어
 * '무료'로 적으면, 갔더니 돈을 받는 최악의 오답이 된다.
 */
export function readParking(raw) {
  const text = squash(raw)
  if (!text) return { skip: '안내 없음' }
  if (NO_PARKING.test(text)) return { skip: '주차 불가' }

  const hasFree = /무료/.test(text)
  if (!hasFree && !MONEY.test(text)) return { skip: '금액 없는 유료' }

  /*
   * 구매 조건이 붙은 무료.
   *
   * 조건 문구를 그대로 살려야 timeRules 의 구매 조건 판별에 걸려서 요금 계산에서는
   * 빠지고, 카드에는 '조건을 채우면 무료'로 따로 뜬다. 여기서 조건을 지우고
   * '1시간 무료'로만 적으면 아무나 1시간 공짜인 것처럼 계산돼 버린다.
   */
  const cond = text.match(COND_FREE)
  if (cond) {
    return {
      charge: '유료',
      basicTime: 0,
      basicCharge: 0,
      note: squash(cond[2]) + ' 구매 시 ' + squash(cond[1]) + ' 무료',
    }
  }

  // 조건 없는 N시간 무료. 그만큼은 확실히 0원이고, 넘기면 금액을 몰라 계산하지 않는다.
  const grace = text.match(GRACE_FREE)
  if (grace && !text.includes('(')) {
    /*
     * 무료 시간은 특기사항에만 적고 basicTime 에는 넣지 않는다.
     * 두 곳에 적으면 특기사항에서 뽑은 무료 구간을 빼고 남은 시간에 기본시간이 또
     * 적용돼서, 1시간 무료인 곳이 2시간까지 0원으로 계산될 수 있다.
     */
    if (toMinutes(grace[1]) > 0) {
      return { charge: '유료', basicTime: 0, basicCharge: 0, note: '최초 ' + squash(grace[1]) + ' 무료' }
    }
  }

  // 시간 제한도 조건도 없는 무료 — '무료주차 가능', '주차장 이용 : 무료'
  if (hasFree && !MONEY.test(text) && !text.includes('/')) {
    return { charge: '무료', basicTime: 0, basicCharge: 0, note: '영업시간 내 무료' }
  }

  // 위 어디에도 안 맞지만 무료가 적힌 긴 안내문 — 해석하지 말고 원문을 그대로 싣는다.
  if (hasFree) return { charge: '유료', basicTime: 0, basicCharge: 0, note: text.slice(0, 200) }

  /*
   * '무료'라는 낱말 없이 등급표로만 적은 곳 — '유료 (1만원이상 : 2시간, 3만원이상 : 3시간)'.
   * 여기서 '2시간'은 2시간 무료를 준다는 뜻이다. 낱말이 없으면 앱이 조건부 무료로 읽지
   * 못하므로 '무료'를 붙여 원문의 등급을 그대로 옮긴다.
   */
  const tiers = [...text.matchAll(TIER)]
  if (tiers.length > 0) {
    const note = tiers.map((m) => squash(m[1]) + ' 구매 시 ' + squash(m[2]) + ' 무료').join(', ')
    return { charge: '유료', basicTime: 0, basicCharge: 0, note: note.slice(0, 200) }
  }

  return { skip: '해석 불가' }
}

/** '10:00~23:00' 꼴을 찾아 hhmm 두 개로. 못 찾으면 대형마트 표준 영업시간. */
export function readHours(sales) {
  const m = squash(sales).match(/([0-9]{1,2}):([0-9]{2})\s*[~-]\s*([0-9]{1,2}):([0-9]{2})/)
  if (!m) return { open: '1000', close: '2300' }
  const pad = (h, mm) => String(h).padStart(2, '0') + mm
  return { open: pad(m[1], m[2]), close: pad(m[3], m[4]) }
}

function inKorea(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat > 33 && lat < 39 && lng > 124 && lng < 132
}

async function main() {
  const out = process.argv[2] || DEFAULT_OUT
  const today = new Date().toISOString().slice(0, 10)

  const list = firstArray(await post(LIST_URL, LIST_BODY))
  console.log('점포 목록: ' + list.length + '건')
  if (list.length === 0) {
    console.error('✗ 목록이 비어 있습니다. API 형식이 바뀌었을 수 있습니다.')
    process.exit(1)
  }

  const rows = []
  const tally = {}
  const bump = (k) => {
    tally[k] = (tally[k] ?? 0) + 1
  }
  let done = 0

  for (const s of list) {
    let park = ''
    try {
      park = deepGet(await post(VIEW_URL, 'storId=' + encodeURIComponent(s.storId)), 'storParkCntt')
    } catch (err) {
      console.warn('  ! ' + s.storKorNm + ': ' + err.message)
    }
    await sleep(120)
    if (++done % 60 === 0) console.log('  ' + done + '/' + list.length)

    const info = readParking(park)
    if (info.skip) {
      bump(info.skip)
      continue
    }

    // 좌표가 없으면 지도에 찍을 수 없다. 아무 데나 두는 것보다 버리는 게 낫다.
    const lat = Number(s.storLat)
    const lng = Number(s.storLon)
    if (!inKorea(lat, lng)) {
      bump('좌표 없음')
      continue
    }

    bump(info.charge === '무료' ? '완전 무료' : '조건부')
    const hours = readHours(s.storSlesTime)
    const label = squash(s.storKorNm)

    rows.push({
      prkplceNo: 'PZ-HP-' + s.storId,
      prkplceNm: label.includes('홈플러스') ? label : '홈플러스 ' + label,
      prkplceSe: '민영',
      prkplceType: '부설',
      rdnmadr: squash(s.storAddr),
      latitude: String(lat),
      longitude: String(lng),
      operDay: '매일',
      weekdayOperOpenHhmm: hours.open,
      weekdayOperColseHhmm: hours.close,
      satOperOperOpenHhmm: hours.open,
      satOperCloseHhmm: hours.close,
      holidayOperOpenHhmm: hours.open,
      holidayCloseOpenHhmm: hours.close,
      parkingchrgeInfo: info.charge,
      basicTime: String(info.basicTime),
      basicCharge: String(info.basicCharge),
      addUnitTime: '0',
      addUnitCharge: '0',
      dayCmmtkt: '0',
      spcmnt: info.note,
      institutionNm: '홈플러스',
      phoneNumber: squash(s.storTphnNo),
      pzSource: 'https://my.homeplus.co.kr/store?storId=' + s.storId,
      pzVerifiedOn: today,
    })
  }

  const payload = {
    source: '홈플러스 매장찾기',
    sourceUrl: 'https://my.homeplus.co.kr/store',
    license: '점포별 공식 주차 안내를 그대로 옮김 (요금은 안내 문구를 해석한 값)',
    fetchedOn: today,
    rows,
  }
  await writeFile(out, JSON.stringify(payload, null, 1), 'utf-8')
  console.log('저장: ' + rows.length + '곳 → ' + out)
  console.log('분류: ' + JSON.stringify(tally))
}

// 테스트가 readParking 만 가져다 쓸 수 있게, 직접 실행할 때만 수집한다.
if (process.argv[1] && process.argv[1].includes('fetch-homeplus')) {
  main().catch((err) => {
    console.error('✗ 실패:', err.message)
    process.exit(1)
  })
}
