#!/usr/bin/env node
/**
 * 롯데쇼핑 지점(백화점·아울렛·몰·프리미엄아울렛)의 주차 정보를 공식 지점안내에서 받아 온다.
 *
 *   node scripts/fetch-lotte.mjs [출력경로]
 *
 * 왜 필요한가
 *   「전국주차장정보표준데이터」는 사실상 공영 데이터라 유통 매장 부설주차장이 빠져 있다.
 *
 * 왜 브랜드 단위로 못 박지 않는가
 *   지점마다 다르다. 파주·김해·고양·군산·여수·진주점은 영업시간 내 전액 무료인데,
 *   서울역점은 최초 30분이 3,500원이고 잠실점은 구매금액별로만 무료가 붙는다.
 *   검색으로는 "롯데프리미엄아울렛은 최초 30분 3,000원" 이라는 글이 많이 나오지만
 *   공식 지점안내는 파주점을 "영업시간 내 무료" 로 적고 있다. 지점 안내가 기준이다.
 *
 * 출처: 롯데쇼핑 지점안내 (lotteshopping.com/store/main?cstrCd=…)
 */
import { existsSync, mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const SEED = 'https://www.lotteshopping.com/store/main?cstrCd=0339'
const VIEW = 'https://www.lotteshopping.com/store/main?cstrCd='
const DEFAULT_OUT = path.join('public', 'data', 'lotte.json')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const won = (s) => Number(String(s).replace(/[^0-9]/g, '')) || 0
const toMin = (n, u) => (/시간/.test(u) ? n * 60 : n)

function toLines(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]*>/g, '\n')
    .split('\n')
    .map((s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&gt;/g, '>').trim())
    .filter(Boolean)
}

/*
 * 요금부와 조건부를 나눈다.
 *
 * "구매금액별 무료주차" 뒤는 조건이다. 섞어서 넘기면 "50,000원 : 1시간" 이
 * 기본 무료시간으로 읽혀 아무것도 사지 않아도 공짜라고 알려 주게 된다.
 */
function splitParking(lines, start) {
  const stop = ['주차장 이용 유의사항', '고객주차장 진/출입 안내', '교통 이용안내', '주차 가능 대수']
  const body = []
  for (let k = start; k < lines.length; k++) {
    if (stop.includes(lines[k])) break
    body.push(lines[k])
  }
  const text = body.join(' / ')
  const m = /구매\s*금액\s*별\s*무료\s*주차|구매금액별/.exec(text)
  if (!m) return { fee: text, perk: '' }
  return { fee: text.slice(0, m.index).trim(), perk: text.slice(m.index).trim() }
}

/**
 * 요금 문구를 요금 칸으로 옮긴다. 읽지 못하면 금액을 지어내지 않고 비워 둔다.
 */
function parseFee(feeText) {
  const t = feeText.replace(/\s*\/\s*/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t) return { kind: 'none' }

  // "영업시간 내 : 무료", "상시 : 무료" — 조건 없는 전액 무료
  if (/(?:영업시간\s*내|상시|전일|종일)\s*[:：]?\s*무료/.test(t) && !/[0-9,]+\s*원/.test(t)) {
    return { kind: 'free' }
  }

  // "최초 30분 : 1,000원", "입차 후 30분까지 : 3,000원"
  const basicPaid =
    /(?:최초|기본|입차\s*후)\s*(\d{1,3})\s*(분|시간)[^:：]{0,6}[:：]\s*([0-9,]+)\s*원/.exec(t)
  // "최초 30분 : 무료", "30분 이내 : 무료", "30분(무료)후"
  const grace =
    /(?:최초|기본)\s*(\d{1,3})\s*(분|시간)[^:：]{0,12}[:：]\s*무료/.exec(t) ||
    /(\d{1,3})\s*(분|시간)\s*(?:이내|까지)\s*[:：]?\s*무료/.exec(t) ||
    /(\d{1,3})\s*(분|시간)\s*\(\s*무료\s*\)/.exec(t)
  // "초과 10분당 : 1,000원", "추가 10분당 : 1,000원", "30분 이후 10분당 : 1,000원", "주차 10분당 : 1,000원"
  const rate = /(\d{1,3})\s*분\s*당\s*[:：]?\s*([0-9,]+)\s*원/.exec(t)

  if (basicPaid && won(basicPaid[3]) > 0) {
    return {
      kind: 'metered',
      basicTime: toMin(Number(basicPaid[1]), basicPaid[2]),
      basicCharge: won(basicPaid[3]),
      addTime: rate ? Number(rate[1]) : 0,
      addCharge: rate ? won(rate[2]) : 0,
    }
  }
  if (rate) {
    return {
      kind: 'metered',
      basicTime: grace ? toMin(Number(grace[1]), grace[2]) : 0,
      basicCharge: 0,
      addTime: Number(rate[1]),
      addCharge: won(rate[2]),
    }
  }
  return { kind: 'paid' }
}

async function main() {
  const out = process.argv[2] ?? DEFAULT_OUT
  const cache = path.join('node_modules', '.cache', 'parkatzero-lotte')
  if (!existsSync(cache)) mkdirSync(cache, { recursive: true })

  const seedRes = await fetch(SEED, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) })
  const seed = await seedRes.text()
  const codes = [...new Set([...seed.matchAll(/cstrCd=([0-9A-Za-z]+)/g)].map((m) => m[1]))]
  if (codes.length === 0) {
    console.error('✗ 지점 코드를 찾지 못했습니다. 페이지 구조가 바뀌었을 수 있습니다.')
    process.exit(1)
  }
  console.log('지점 코드: ' + codes.length + '개')

  const rows = []
  const tally = {}
  for (const code of codes) {
    const file = path.join(cache, code + '.html')
    let html
    if (existsSync(file)) html = await readFile(file, 'utf-8')
    else {
      try {
        const res = await fetch(VIEW + code, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) })
        html = await res.text()
        await writeFile(file, html, 'utf-8')
      } catch (e) {
        console.error('  ✗ ' + code + ': ' + e.message)
        continue
      }
      await sleep(700)
    }

    const L = toLines(html)
    const i = L.indexOf('주차장 이용안내')
    if (i < 0) continue

    // 주소 줄은 시·군·구와 번지 숫자를 함께 갖는다. 제목과 헷갈리지 않게.
    const addrLine = L.slice(i, i + 8).find((s) => /(시|군|구)\s/.test(s) && /[0-9]/.test(s) && s.length > 12) ?? ''
    const nameMatch = /((?:롯데|타임빌라스)[가-힣A-Za-z0-9 ]*?점)\s*$/.exec(addrLine)
    // 주소 줄 끝에 이름이 없는 지점은 주차 안내문에서 찾는다("롯데백화점 잠실점 주차장 입구").
    /*
     * 주소 줄 끝에 이름이 없는 지점은 주차 안내문에서 찾는다("롯데백화점 잠실점 주차장 입구").
     * 페이지 전체를 뒤지면 상단 네비게이션의 "롯데백화점 본점" 이 먼저 걸려
     * 19곳이 전부 본점이 된다. 반드시 주차 구역 안에서만 찾는다.
     */
    const zone = L.slice(i, i + 60).join(' / ')
    const alt = /((?:롯데|에비뉴엘|타임빌라스)[가-힣A-Za-z0-9 ]*?점)\s*주차장\s*입구/.exec(zone)
    const name = (nameMatch ? nameMatch[1] : alt ? alt[1] : '').trim()
    const addr = (nameMatch ? addrLine.slice(0, addrLine.lastIndexOf(nameMatch[1])) : addrLine).trim()
    if (!name || !addr) continue

    const coords = [...html.matchAll(/3[3-8]\.\d{4,}|1[23]\d\.\d{4,}/g)].map((m) => m[0])
    const lat = coords.find((c) => Number(c) < 40)
    const lng = coords.find((c) => Number(c) > 100)
    if (!lat || !lng) continue

    /*
     * 첫 번째 요금 블록이 본 주차장이다.
     * 뒤쪽에 임시주차장·제휴주차장 안내가 또 붙는 지점이 있는데, 그걸 집으면
     * 본점처럼 "입차 후 30분까지 3,000원" 인 곳이 "영업시간 내 무료" 로 뒤집힌다.
     */
    const fi = L.indexOf('주차요금')
    if (fi < 0) continue
    const { fee: feeText, perk } = splitParking(L, fi + 1)
    const fee = parseFee(feeText)
    tally[fee.kind] = (tally[fee.kind] || 0) + 1

    const hours = /주차가능\s*시간\s*[:：]?\s*(\d{1,2}):(\d{2})\s*~\s*(\d{1,2}):(\d{2})/.exec(html)
    const open = hours ? hours[1].padStart(2, '0') + hours[2] : ''
    const close = hours ? hours[3].padStart(2, '0') + hours[4] : ''
    const tel = (html.match(/0[0-9]{1,2}-[0-9]{3,4}-[0-9]{4}/) || [])[0] ?? ''

    /*
     * 요금 문구는 규칙으로 넘기지 않는다 — 이미 칸으로 뽑아 두었고, 그대로 넘기면
     * "최초 30분 : 무료" 같은 표현이 요일·조건과 섞여 부풀려진다.
     * 조건이 있으면 한 덩어리로 묶어 조건부임을 밝힌다.
     */
    const info = [feeText, perk].filter(Boolean).join(' / ').replace(/\s*\/\s*/g, ', ').replace(/\s+/g, ' ').trim()
    const spcmnt = perk ? '주차 안내(구매 조건 포함) — ' + info : info

    rows.push({
      prkplceNo: 'PZ-LOT-' + code,
      prkplceNm: name,
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
      spcmnt: spcmnt.slice(0, 240),
      institutionNm: '롯데쇼핑',
      phoneNumber: tel,
      pzSource: VIEW + code,
      pzVerifiedOn: new Date().toISOString().slice(0, 10),
    })
  }

  await writeFile(
    out,
    JSON.stringify(
      {
        source: '롯데쇼핑 지점안내',
        sourceUrl: 'https://www.lotteshopping.com/',
        license: '지점별 공식 안내를 그대로 옮김 (요금은 안내 문구를 해석한 값)',
        fetchedOn: new Date().toISOString().slice(0, 10),
        rows,
      },
      null,
      1,
    ),
    'utf-8',
  )
  console.log('저장: ' + rows.length + '곳 → ' + out)
  console.log('요금 해석: ' + JSON.stringify(tally))
}

main().catch((err) => {
  console.error('✗ 실패:', err.message)
  process.exit(1)
})
