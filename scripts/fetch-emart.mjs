#!/usr/bin/env node
/**
 * 이마트·트레이더스·스타필드마켓의 주차 정보를 공식 점포 안내에서 받아 온다.
 *
 *   node scripts/fetch-emart.mjs [출력경로]
 *
 * 왜 필요한가
 *   「전국주차장정보표준데이터」는 사실상 공영 데이터다(민영 913곳, 그마저 유료 주차빌딩
 *   위주). 대형마트 부설주차장은 브랜드 이름으로 훑어도 48건뿐인데 그중 대부분은
 *   '이마트 앞' 같은 매장 옆 공영 노상이지 매장 자체 주차장이 아니다.
 *
 * 왜 브랜드 단위로 못 박지 않는가
 *   같은 이마트인데 점포마다 다르다. 여주·파주점은 전액 무료, 구로점은 30분 무료 뒤
 *   10분당 1,000원, 목동점은 최초 20분 2,000원이다. 점포별 안내를 그대로 옮겨야 한다.
 *
 * 출처: 이마트 점포 안내 (eapp.emart.com/branch/view.do?id={점포번호})
 *   목록은 store.emart.com/branch/listAll.do 에서 받는다. 노브랜드·에브리데이는
 *   "주차 안내 내용을 준비하고 있습니다" 만 나오므로 제외한다.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const LIST_URL = 'https://store.emart.com/branch/listAll.do'
const VIEW_URL = 'https://eapp.emart.com/branch/view.do?id='
const DEFAULT_OUT = path.join('public', 'data', 'emart.json')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'

/** 주차장이 있는 대형 점포만. 소형 점포는 안내 자체가 없다. */
const KEEP = (name) => /^이마트 /.test(name) || /^트레이더스/.test(name) || /^스타필드마켓/.test(name)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const won = (s) => Number(String(s).replace(/[^0-9]/g, '')) || 0
const toMin = (n, unit) => (/시간/.test(unit) ? n * 60 : n)

/*
 * 구매 조건이 붙은 조각은 요금 계산의 근거가 아니다.
 * "1만원 이상 구매시 2시간 무료" 를 기본 무료시간으로 읽으면 아무것도 사지 않아도
 * 공짜라고 알려 주게 된다. 숫자 안의 쉼표를 지켜야 하므로 쉼표로는 자르지 않는다.
 */
const COND = /구매|영수증|쇼핑\s*금액|[0-9,]+\s*(?:만|천)?\s*원\s*이상|이상\s*시|이상시|이상\s*~|숙박|월정기|정기권|할인|강좌|수강|문화센터|관람|대관|회원|멤버십/
const MONEY = /[0-9,]+\s*(?:만|천)?\s*원/
const PAID = /유료|징수|정산/

function feeText(t) {
  return String(t || '')
    .replace(/■\s*주차장\s*관리업체[\s\S]*/, '')
    .replace(/■\s*주차장\s*특이사항[\s\S]*/, '')
    .replace(/■\s*주차운영시간[\s\S]*/, '')
    .replace(/■\s*주차장\s*요금기준|■\s*주차장\s*이용안내|■\s*주차요금/g, '')
    .trim()
}

function withoutCondition(t) {
  return t.split(/\s\/\s|\n|·/).filter((p) => !COND.test(p)).join(' / ')
}

function parseFee(raw) {
  const t = feeText(raw)
  if (!t) return { kind: 'none' }
  const plain = withoutCondition(t)
  const plainLines = plain.split(/\s\/\s|\n/)
  const rateRe = /(?:추가|초과)?\s*\d{1,3}\s*분\s*(?:당|단위)?\s*[:\-–]?\s*[0-9,]+\s*원/

  if (/무료/.test(plain) && !MONEY.test(plain) && !PAID.test(plain)) return { kind: 'free' }

  const basic = /(?:최초|기본)\s*(\d{1,3})\s*(분|시간)\s*[:\-–]?\s*([0-9,]+)\s*원/.exec(plain)
  /*
   * 무료회차 시간은 요금이 적힌 줄에서 먼저 찾는다.
   *
   * "[문화센터 이용시] / - 4시간 무료" 처럼 조건이 앞 줄에 있고 혜택만 뒷줄에 남는
   * 안내가 흔해서, 아무 줄에서나 "N시간 무료" 를 집으면 기본 무료시간을 부풀린다
   * (순천점 30분 → 4시간). 요금과 같은 줄, 그다음 '회차/초과' 표현, 그래도 없으면
   * 마지막으로 조건 없는 줄의 표현 순으로 본다.
   */
  const graceIn = (s) =>
    /무료\s*회차[^0-9]{0,12}(\d{1,3})\s*(분|시간)/.exec(s) ||
    /(\d{1,3})\s*(분|시간)\s*[^가-힣0-9]{0,4}(?:무료\s*)?회차/.exec(s) ||
    /(\d{1,3})\s*(분|시간)\s*초과/.exec(s) ||
    /(\d{1,3})\s*(분|시간)\s*내?\s*출차\s*시\s*무료/.exec(s) ||
    /(?:최초|기본)\s*(\d{1,3})\s*(분|시간)\s*[^가-힣0-9]{0,4}(?:무료|이내)/.exec(s) ||
    /(\d{1,3})\s*(분|시간)\s*(?:이내\s*)?무료/.exec(s)

  const rateLine = plainLines.find((l) => rateRe.test(l)) ?? ''
  const churnLine = plainLines.find((l) => /회차|초과/.test(l)) ?? ''
  const grace = graceIn(rateLine) || graceIn(churnLine) || graceIn(plain)

  const rate =
    /(?:추가|초과)\s*(\d{1,3})\s*분\s*(?:당|단위)?\s*[:\-–]?\s*([0-9,]+)\s*원/.exec(plain) ||
    /(\d{1,3})\s*분\s*(?:당|단위)\s*[:\-–]?\s*([0-9,]+)\s*원/.exec(plain) ||
    /기본\s*(\d{1,3})\s*분\s*[:\-–]\s*([0-9,]+)\s*원/.exec(plain)
  const dayMax = /(?:일\s*최대|1일\s*최대|일일\s*최대|최대)\s*(?:요금)?\s*[:\-–]?\s*([0-9,]{4,})\s*원/.exec(plain)

  if (basic && won(basic[3]) > 0) {
    return {
      kind: 'metered',
      basicTime: toMin(Number(basic[1]), basic[2]),
      basicCharge: won(basic[3]),
      addTime: rate ? Number(rate[1]) : 0,
      addCharge: rate ? won(rate[2]) : 0,
      dayTicket: dayMax ? won(dayMax[1]) : 0,
    }
  }
  if (rate) {
    return {
      kind: 'metered',
      basicTime: grace ? toMin(Number(grace[1]), grace[2] ?? '분') : 0,
      basicCharge: 0,
      addTime: Number(rate[1]),
      addCharge: won(rate[2]),
      dayTicket: dayMax ? won(dayMax[1]) : 0,
    }
  }
  return { kind: 'paid' }
}

/*
 * 안내문을 특기사항으로 옮긴다.
 *
 * 조건과 혜택이 서로 다른 줄에 적힌 경우가 흔하다.
 *   "1만원/3만원/5만원 이상 구매시" / "1시간/2시간/3시간 무료"
 * 이걸 줄 단위로 넘기면 뒤 줄만 보고 누구나 무료라고 읽는다. 조건어가 하나라도
 * 섞인 안내문은 통째로 한 문장으로 합치고 앞에 조건임을 밝혀, 앱이 무료 규칙이
 * 아니라 조건부 안내로 다루게 한다. 요금은 이미 위에서 칸으로 뽑아 두었다.
 */
function describeNote(parking) {
  const t = feeText(parking).replace(/\s+/g, ' ').trim()
  if (!t) return ''
  if (!COND.test(t)) return t.slice(0, 220)
  return ('구매·이용 조건이 붙은 안내 — ' + t.replace(/\s*\/\s*/g, ', ')).slice(0, 220)
}


function toLines(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]*>/g, '\n')
    .split('\n')
    .map((s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim())
    .filter(Boolean)
}

const hhmm = (v) => {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(String(v ?? '').trim())
  return m ? m[1].padStart(2, '0') + m[2] : ''
}

async function main() {
  const out = process.argv[2] ?? DEFAULT_OUT
  const cache = path.join('node_modules', '.cache', 'parkatzero-emart')
  if (!existsSync(cache)) mkdirSync(cache, { recursive: true })

  const listRes = await fetch(LIST_URL, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'X-Requested-With': 'XMLHttpRequest',
      Referer: 'https://store.emart.com/branch/list.do',
    },
    signal: AbortSignal.timeout(30000),
  })
  const list = (await listRes.json()).branchList ?? []
  const targets = list.filter((b) => KEEP(b.jijumName))
  if (targets.length === 0) {
    console.error('✗ 대상 점포가 없습니다. 목록 구조가 바뀌었을 수 있습니다.')
    process.exit(1)
  }
  console.log('대상 점포: ' + targets.length + '곳 (전체 ' + list.length + ')')

  const rows = []
  const tally = {}
  for (const b of targets) {
    const file = path.join(cache, b.jijumId + '.html')
    let html
    if (existsSync(file)) html = await readFile(file, 'utf-8')
    else {
      try {
        const res = await fetch(VIEW_URL + b.jijumId, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(25000),
        })
        html = await res.text()
        await writeFile(file, html, 'utf-8')
      } catch (e) {
        console.error('  ✗ ' + b.jijumName + ': ' + e.message)
        continue
      }
      await sleep(700)
    }

    const lines = toLines(html)
    const coords = [...html.matchAll(/3[3-8]\.\d{5,}|1[23]\d\.\d{5,}/g)].map((m) => m[0])
    const lat = coords.find((c) => Number(c) < 40)
    const lng = coords.find((c) => Number(c) > 100)
    if (!lat || !lng) continue

    const roadIdx = lines.indexOf('도로명')
    const addr = roadIdx >= 0 ? lines[roadIdx + 1] : ''
    const hoursIdx = lines.indexOf('영업시간')
    const storeHours = hoursIdx >= 0 ? lines[hoursIdx + 1] : ''
    const tel = (html.match(/0[0-9]{1,2}-[0-9]{3,4}-[0-9]{4}/) || [])[0] ?? ''

    // '주차정보' 는 탭 제목과 본문에 두 번 나온다. 두 번째 이후가 본문이다.
    const first = lines.indexOf('주차정보')
    const second = lines.indexOf('주차정보', first + 1)
    const parking = (second >= 0 ? lines.slice(second + 1) : [])
      .slice(0, 14)
      .filter((s) => !/^층별안내$|^\d+F$|^B\d+F$|^주차장$/.test(s))
      .join(' / ')
    if (!parking || /준비하고 있습니다/.test(parking)) continue

    // 주차 운영시간이 따로 적혀 있으면 그것을, 없으면 매장 영업시간을 쓴다.
    const parkHours = /(?:주차운영시간|주차장\s*이용시간|운영시간)\s*[:\-–]?\s*(\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})/.exec(parking)
    const storeRange = /(\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})/.exec(storeHours)
    const range = parkHours ?? storeRange
    const open = range ? hhmm(range[1]) : ''
    const close = range ? hhmm(range[2]) : ''

    const fee = parseFee(parking)
    tally[fee.kind] = (tally[fee.kind] || 0) + 1

    rows.push({
      prkplceNo: 'PZ-EMT-' + b.jijumId,
      prkplceNm: b.jijumName,
      prkplceSe: '민영',
      prkplceType: '부설',
      rdnmadr: addr,
      latitude: lat,
      longitude: lng,
      operDay: '매일',
      weekdayOperOpenHhmm: open,
      weekdayOperColseHhmm: close,
      satOperOperOpenHhmm: open,
      satOperCloseHhmm: close,
      holidayOperOpenHhmm: open,
      holidayCloseOpenHhmm: close,
      parkingchrgeInfo: fee.kind === 'free' ? '무료' : '유료',
      basicTime: String(fee.basicTime ?? 0),
      basicCharge: String(fee.basicCharge ?? 0),
      addUnitTime: String(fee.addTime ?? 0),
      addUnitCharge: String(fee.addCharge ?? 0),
      dayCmmtkt: String(fee.dayTicket ?? 0),
      spcmnt: describeNote(parking),
      institutionNm: '이마트',
      phoneNumber: tel,
      pzSource: VIEW_URL + b.jijumId,
      pzVerifiedOn: new Date().toISOString().slice(0, 10),
    })
  }

  const payload = {
    source: '이마트 점포 안내',
    sourceUrl: 'https://store.emart.com/branch/list.do',
    license: '점포별 공식 안내를 그대로 옮김 (요금은 안내 문구를 해석한 값)',
    fetchedOn: new Date().toISOString().slice(0, 10),
    rows,
  }
  await writeFile(out, JSON.stringify(payload, null, 1), 'utf-8')
  console.log('저장: ' + rows.length + '곳 → ' + out)
  console.log('요금 해석: ' + JSON.stringify(tally))
}

main().catch((err) => {
  console.error('✗ 실패:', err.message)
  process.exit(1)
})
