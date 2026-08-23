#!/usr/bin/env node
/**
 * 현대백화점그룹 아울렛·백화점의 주차 정보를 지점별 공식 안내에서 받아 온다.
 *
 *   node scripts/fetch-outlets.mjs [출력경로]
 *
 * 왜 필요한가
 *   「전국주차장정보표준데이터」는 사실상 공영 데이터라 유통 매장 부설주차장이 통째로
 *   빠져 있다. 그런데 아울렛·백화점 주차는 "1만원 이상 구매 시 1시간 무료" 처럼
 *   구매 조건이 본질이라, 조건을 빼고 요금만 적으면 실제와 동떨어진다.
 *   그래서 요금부와 조건부를 나눠 담는다 — 요금은 요금 칸에, 조건은 특기사항에.
 *
 * 왜 브랜드 단위로 못 박지 않는가
 *   지점마다 다르다. 대전점은 평일 무료인데 김포점은 10분당 1,000원이고,
 *   가산점은 30분 무료 뒤 10분당 500원, 대구점은 기본 30분이 아예 500원이다.
 *
 * 출처: 현대백화점 지점안내 (ehyundai.com/newPortal/outlet/DP/WC/WC000000_V.do?branchCd=…)
 */
import { existsSync, mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const SEED = 'https://www.ehyundai.com/newPortal/outlet/DP/WC/WC000000_V.do?branchCd=B00172000'
const VIEW = 'https://www.ehyundai.com/newPortal/outlet/DP/WC/WC000000_V.do?branchCd='
const DEFAULT_OUT = path.join('public', 'data', 'outlets.json')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const won = (s) => Number(String(s).replace(/[^0-9]/g, '')) || 0
const toMin = (n, u) => (/시간/.test(u) ? n * 60 : n)

function toLines(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]*>/g, '\n')
    .split('\n')
    .map((s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#039;/g, "'").trim())
    .filter(Boolean)
}

/*
 * 요금부와 조건부를 나눈다.
 *
 * 안내는 늘 "주차요금 … / 상품금액별 무료 주차 안내 …" 순서다. 앞부분은 누구에게나
 * 적용되는 요금이고 뒷부분은 구매 조건이다. 섞어서 넘기면 "1만원 이상 1시간 무료" 가
 * 기본 무료시간으로 읽혀, 아무것도 사지 않아도 공짜라고 알려 주게 된다.
 */
function splitParking(text) {
  const t = String(text || '')
    .replace(/^주차요금\s*\/\s*/, '')
    .replace(/문의전화[\s\S]*/, '')
    .replace(/지하철\s*이용[\s\S]*/, '')
    .replace(/버스\s*이용[\s\S]*/, '')
    .trim()
  const m = /상품\s*금액\s*별\s*무료\s*주차\s*안내|상품금액별\s*무료\s*주차/.exec(t)
  if (!m) return { fee: t, perk: '' }
  return { fee: t.slice(0, m.index).trim(), perk: t.slice(m.index + m[0].length).replace(/^\s*\/\s*/, '').trim() }
}

/**
 * 요금부에서 기본시간·기본요금·단위시간·단위요금을 읽는다.
 * 읽지 못하면 금액을 지어내지 않고 비워 둔다.
 */
function parseFee(feeText, perkText) {
  const t = feeText.replace(/\s+/g, ' ')
  if (!t) return { kind: 'none' }

  /*
   * 지점에 따라 요금이 조건부 문단에 섞여 있다 — 송도점은 "주말 및 공휴일(*주중 무료개방)"
   * 과 "(10분 당 1,000원)" 이 모두 그쪽에 있다. 단위요금과 요일 무료는 어느 문단에
   * 적혀 있든 사실이므로 함께 본다. 다만 무료 시간은 구매 조건일 수 있어 요금 문단에서만 읽는다.
   */
  const all = (feeText + ' / ' + (perkText || '')).replace(/\s+/g, ' ')

  /*
   * 무료 시간은 구매 조건이 아닌 줄에서만 읽는다.
   * 커넥트현대 청주는 요금 문단 자체가 "1만원 이상 구매 시 1시간 무료" 로 시작해서,
   * 그대로 읽으면 아무것도 사지 않아도 1시간 공짜라고 알려 준다.
   */
  const COND = /구매|영수증|[0-9,]+\s*(?:만|천)?\s*원\s*이상|이상\s*시|강좌|수강|관람|대관|회원|이용\s*시|식당가|키즈카페|우수\s*고객/
  const plain = all.split(/,|\s\/\s/).filter((p) => !COND.test(p)).join(' ')

  // "평일 : 무료", "주중 무료개방" — 요일에 따라 갈리는 곳
  const weekdayFree = /(?:평일|주중)\s*[:：]?\s*무료(?:개방)?/.test(all)

  // "기본 30분 500원" 처럼 기본 시간에 값이 붙는 경우
  const basicPaid = /(?:최초|기본)\s*(\d{1,3})\s*(분|시간)\s*[:\-–]?\s*([0-9,]+)\s*원/.exec(t)
  // "최초 30분 무료", "기본 무료 주차 30분", "30분 무료"
  // 조건 없는 무료 시간은 '최초/기본 N분' 형태로만 적힌다. 그 밖의 'N시간 무료' 는
  // 전부 구매·이용 조건이 붙은 혜택이라 기본값으로 삼으면 안 된다.
  const grace =
    /회차\s*(\d{1,3})\s*(분|시간)\s*무료/.exec(plain) ||
    /(\d{1,3})\s*(분|시간)\s*(?:이내\s*)?무료\s*회차/.exec(plain) ||
    /(?:최초|기본)\s*(?:무료\s*주차\s*)?(\d{1,3})\s*(분|시간)\s*(?:무료|이내)/.exec(plain) ||
    /(?:최초|기본)\s*무료\s*주차\s*(\d{1,3})\s*(분|시간)/.exec(plain)
  // "초과 10분 당 1,000원", "매 10분당 1,000원", "10분당 500원", "10분 초과당 200원"
  const rate =
    /(?:초과|매)?\s*(\d{1,3})\s*분\s*(?:당|초과당)\s*[:\-–]?\s*([0-9,]+)\s*원/.exec(all) ||
    /(?:초과|매)?\s*(\d{1,3})\s*분\s*(?:당|초과당)\s*[:\-–]?\s*([0-9,]+)\s*원/.exec(t) ||
    /(\d{1,3})\s*분\s*초과\s*당\s*([0-9,]+)\s*원/.exec(t)

  if (basicPaid && won(basicPaid[3]) > 0) {
    return {
      kind: 'metered',
      weekdayFree,
      basicTime: toMin(Number(basicPaid[1]), basicPaid[2]),
      basicCharge: won(basicPaid[3]),
      addTime: rate ? Number(rate[1]) : 0,
      addCharge: rate ? won(rate[2]) : 0,
    }
  }
  if (rate) {
    return {
      kind: 'metered',
      weekdayFree,
      basicTime: grace ? toMin(Number(grace[1]), grace[2]) : 0,
      basicCharge: 0,
      addTime: Number(rate[1]),
      addCharge: won(rate[2]),
    }
  }
  if (weekdayFree) return { kind: 'weekday-free', weekdayFree: true }
  return { kind: 'paid' }
}

async function main() {
  const out = process.argv[2] ?? DEFAULT_OUT
  const cache = path.join('node_modules', '.cache', 'parkatzero-outlets')
  if (!existsSync(cache)) mkdirSync(cache, { recursive: true })

  const seedRes = await fetch(SEED, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) })
  const seed = await seedRes.text()
  const codes = [...new Set([...seed.matchAll(/branchCd=(B\d+)/g)].map((m) => m[1]))]
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
      await sleep(800)
    }

    // 다음지도 마커 title 이 가장 깨끗한 지점명이다.
    const name = (html.match(/title:\s*'([^']{3,40})'/) || [])[1] ?? ''
    const lat = (html.match(/var xPoint = '([0-9.]+)'/) || [])[1]
    const lng = (html.match(/var yPoint = '([0-9.]+)'/) || [])[1]
    if (!name || !lat || !lng) continue
    // 해외 지점은 통화가 다르다.
    if (/엔|円/.test(html.slice(0, 200000))) {
      const L0 = toLines(html)
      if (L0.some((s) => /[0-9]\s*엔/.test(s))) continue
    }

    const L = toLines(html)
    const addrIdx = L.indexOf('주소')
    const addr = addrIdx >= 0 ? (L[addrIdx + 1] || '').replace(/^:\s*/, '').replace(/\s+/g, ' ').trim() : ''
    const tel = (html.match(/대표전화[\s\S]{0,60}?(1[0-9]{3}-[0-9]{4}|0[0-9]{1,2}-[0-9]{3,4}-[0-9]{4})/) || [])[1] ?? ''

    const pIdx = L.indexOf('주차장 이용안내')
    const raw = pIdx >= 0 ? L.slice(pIdx + 1, pIdx + 26).join(' / ') : ''
    const { fee: feeText, perk } = splitParking(raw)
    const fee = parseFee(feeText, perk)
    tally[fee.kind] = (tally[fee.kind] || 0) + 1

    /*
     * 특기사항 구성.
     *
     * 요금 문구를 그대로 넘기면 "최초 30분(평일), 1시간(주말) 무료" 같은 표현이
     * '평일·주말 종일 무료' 로 부풀려진다. 요금은 이미 위에서 칸으로 뽑아 두었으므로,
     * 규칙으로 삼을 것은 애매하지 않은 것만 따로 적고 나머지 안내문은 한 덩어리로
     * 묶어 조건부로 넘긴다. 앱이 조건부 혜택으로 알아보고 요금에 섞지 않는다.
     */
    const clauses = []
    if (fee.weekdayFree) clauses.push('평일 무료')
    const info = [feeText, perk].filter(Boolean).join(' / ').replace(/\s*\/\s*/g, ', ').replace(/\s+/g, ' ').trim()
    if (info) clauses.push('주차 안내(구매 조건 포함) — ' + info)

    rows.push({
      prkplceNo: 'PZ-HDS-' + code,
      prkplceNm: /^현대|^더현대|^커넥트/.test(name) ? name : '현대백화점 ' + name,
      prkplceSe: '민영',
      prkplceType: '부설',
      rdnmadr: addr,
      latitude: lat,
      longitude: lng,
      operDay: '매일',
      parkingchrgeInfo: fee.kind === 'weekday-free' ? '혼합' : '유료',
      basicTime: String(fee.basicTime ?? 0),
      basicCharge: String(fee.basicCharge ?? 0),
      addUnitTime: String(fee.addTime ?? 0),
      addUnitCharge: String(fee.addCharge ?? 0),
      spcmnt: clauses.join(' / ').slice(0, 240),
      institutionNm: '현대백화점',
      phoneNumber: tel,
      pzSource: VIEW + code,
      pzVerifiedOn: new Date().toISOString().slice(0, 10),
    })
  }

  await writeFile(
    out,
    JSON.stringify(
      {
        source: '현대백화점 지점안내',
        sourceUrl: 'https://www.ehyundai.com/',
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
