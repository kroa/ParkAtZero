#!/usr/bin/env node
/**
 * 전국 지자체 주차장 조례의 [별표] 주차요금표에서 <요일·시간에 따라 요금을 받지 않는다>는
 * 조항을 캐낸다.
 *
 * ── 왜 별표인가 ────────────────────────────────────────────
 * 조례 본문에는 쓸 만한 게 없다. 표본 40곳을 훑어 보니 요일·무료를 함께 말하는 문장이
 * 4곳뿐이었고 그마저 전부 '군수가 필요하다고 인정하는 경우 개방할 수 있다' 같은 재량
 * 조항이었다. 실제로 요금을 언제 받고 언제 안 받는지는 [별표] 주차요금표의 <비고>에 있다.
 *
 * ── 왜 어려웠나 ────────────────────────────────────────────
 * 별표는 조례 XML 안이 비어 있고(별표내용 0자), law.go.kr 의 별표 뷰어는 자바스크립트
 * 껍데기만 준다. 파일은 한글 문서(.hwp/.hwpx)로만 받을 수 있다. 그래서 scripts/lib/hwp.mjs
 * 에 복합문서·ZIP 을 직접 읽는 추출기를 두었다.
 *
 * ── 자동으로 규칙까지 만들지 않는 이유 ──────────────────────
 * 조례 문장은 세 갈래다.
 *   확정  "공휴일에는 주차요금을 무료로 한다"          → 규칙으로 쓸 수 있다
 *   원칙  "무료로 함을 원칙으로 하되 … 유료로 할 수 있다" → 지자체 안내로 확인해야 한다
 *   재량  "무료로 운영할 수 있다"                      → 근거가 못 된다
 * 셋을 구분하지 않고 적용하면 유료 주차장을 무료라고 안내하게 된다. 그래서 이 스크립트는
 * 분류해서 <찾은 것>만 내놓고, 규칙 승격은 사람이 확인한 뒤 institution-rules.json 에 옮긴다.
 *
 * 사용: node scripts/fetch-ordinance-rules.mjs [출력경로]
 */
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { documentToText } from './lib/hwp.mjs'

const API = 'http://www.law.go.kr/DRF'
const OC = 'test'
const DEFAULT_OUT = path.join('public', 'data', 'ordinance-findings.json')
const CELLS = path.join('public', 'data', 'cells')

const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function retry(fn, times = 3) {
  for (let i = 0; i < times; i++) {
    try {
      const v = await fn()
      if (v) return v
    } catch {
      /* 다시 */
    }
    await sleep(400 * (i + 1))
  }
  return null
}
const getText = (u) => retry(async () => (await fetch(u)).text())
const getBuf = (u) =>
  retry(async () => {
    const r = await fetch(u)
    return r.ok ? Buffer.from(await r.arrayBuffer()) : null
  })

const grab = (b, t) => {
  const m = new RegExp('<' + t + '>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</' + t + '>').exec(b)
  return m ? squash(m[1].replace(/<[^>]+>/g, '')) : ''
}

/** 1) 전국 주차요금 별표 목록. 지자체마다 가장 최근 시행분만 남긴다. */
export async function listFeeTables() {
  const byOrg = new Map()
  for (let page = 1; page <= 8; page++) {
    const xml = await getText(
      `${API}/lawSearch.do?OC=${OC}&target=ordinbyl&type=XML&display=100&page=${page}` +
        `&query=${encodeURIComponent('주차요금')}`,
    )
    if (!xml) break
    const items = [...xml.matchAll(/<ordinbyl id="\d+">([\s\S]*?)<\/ordinbyl>/g)].map((m) => m[1])
    for (const b of items) {
      const org = grab(b, '전체기관명')
      const name = grab(b, '별표명')
      // 주차요금표가 아닌 별표(감면신청서 따위)는 거른다.
      if (!/주차\s*요금|주차장.*사용료/.test(name)) continue
      const file = grab(b, '별표서식파일링크').replace(/&amp;/g, '&')
      if (!file) continue
      const date = grab(b, '자치법규시행일자')
      const prev = byOrg.get(org)
      if (!prev || date > prev.date) {
        byOrg.set(org, {
          org,
          bylName: name,
          date,
          seq: grab(b, '별표일련번호'),
          url: file.startsWith('http') ? file : 'http://www.law.go.kr' + file,
          ordinName: grab(b, '관련자치법규명'),
        })
      }
    }
    if (items.length < 100) break
    await sleep(150)
  }
  return [...byOrg.values()]
}

/*
 * 요금을 안 받는 때를 말하는 문장.
 * 표 안의 '최초 10분 무료' 같은 요금 칸에 걸리지 않도록 요일·시간대 말이 앞에 와야 한다.
 */
const TRIGGER =
  /(일요일|공휴일|대체공휴일|토요일|주말|명절|야간|심야|휴무일)[^.。]{0,60}?(무료|면제|징수하지|받지\s*아니|받지\s*않|부과하지)/

/** 문장을 확정·원칙·재량으로 가른다. */
export function classify(sentence) {
  const s = squash(sentence)

  // 단서를 달고 뒤집을 여지를 남긴 문장. '무료로 하되 … 조정할 수 있다' 가 여기다.
  if (/하되|원칙으로|다만|제외/.test(s) && /할\s*수\s*있다/.test(s)) return '원칙'

  // 단서 없이 통째로 재량인 문장. '일요일은 무료로 운영할 수 있다'.
  if (/(무료|면제)[^.。]{0,20}(할\s*수\s*있다)/.test(s)) return '재량'

  /*
   * 못을 박은 문장만 규칙이 될 수 있다.
   *
   * 어미가 생각보다 다양하다. '면제하며'(하동군) · '무료로 개방한다'(강진군) ·
   * '무료 운영한다'(아산·예산, 조사 '로' 가 없다) 를 빠뜨려 확정 넷을 원칙으로
   * 떨어뜨리고 있었다. 놓치는 쪽은 안전하지만 그만큼 규칙을 못 만든다.
   */
  if (
    /(무료로?\s*(한다|운영한다|운영하며|개방한다|개방하며|함)|징수하지\s*아니|받지\s*아니한다|부과하지\s*아니|면제한다|면제하며)/.test(
      s,
    )
  ) {
    return '확정'
  }

  // 어느 쪽인지 모르면 확정으로 올리지 않는다 — 유료를 무료로 안내하는 쪽이 훨씬 나쁘다.
  return '원칙'
}

/** 문장에서 어떤 요일·시간이 무료인지 뽑는다. */
export function readScope(sentence) {
  const s = squash(sentence)
  const days = []
  if (/일요일/.test(s)) days.push('일요일')
  if (/공휴일/.test(s)) days.push('공휴일')
  if (/토요일/.test(s)) days.push('토요일')
  if (/휴무일/.test(s)) days.push('휴무일')
  const night = /야간|심야/.test(s)
  const span = /(\d{1,2})\s*[:시]\s*(\d{0,2})\s*[~∼-]\s*(\d{1,2})\s*[:시]/.exec(s)
  return {
    days,
    night,
    daySpan: span ? span[1].padStart(2, '0') + (span[2] || '00') + '-' + span[3].padStart(2, '0') + '00' : '',
  }
}

/**
 * 데이터에 실제로 있는 관리기관 이름 중 이 지자체 것으로 보이는 것들.
 *
 * '시·군·구' 를 떼면 안 된다. '양구군' 에서 '양구' 만 남기면 '인천 계양구 시설관리공단'
 * 이 걸린다. 꼬리를 붙인 채로 맞춘다.
 * 이름이 짧아 흔한 것('중구'·'남구' 등)은 시도 이름까지 함께 있어야 인정한다.
 */
/** 지자체가 주차장을 맡기는 기관 이름의 꼬리. '의왕도시공사' 처럼 시·군·구가 빠진다. */
const ORG_TAIL = /^(도시공사|도시관리공사|시설관리공단|시설공단|도시개발공사|공사|공단)/

export function matchInstitutions(org, known) {
  const words = squash(org).split(' ')
  const town = words[words.length - 1]
  if (!town || town.length < 2) return []
  const sido = words.length > 1 ? words[0].replace(/(특별자치도|특별자치시|광역시|특별시|도)$/, '') : ''
  const ambiguous = town.length <= 2
  // '의왕시' → '의왕'. 산하 기관 이름에는 시·군·구가 빠져 있다.
  const bare = town.replace(/(시|군|구)$/, '')

  return [...known].filter((k) => {
    if (k.includes(town)) {
      if (ambiguous && sido && !k.includes(sido)) return false
      return true
    }
    /*
     * 산하 기관도 잡는다. '경기도 의왕시' 의 주차장이 데이터에는 '의왕도시공사' 로 들어와 있어
     * '의왕시' 로만 찾으면 55곳을 통째로 놓쳤다. 안산도시공사 75곳·양주도시공사 17곳도 같다.
     *
     * 다만 이름 가운데서 찾으면 안 된다 — '남양주도시공사' 가 '양주' 로 걸린다.
     * 낱말이 그 이름으로 <시작>하고 바로 뒤에 기관 꼬리가 붙을 때만 인정한다.
     */
    if (bare.length < 2 || bare === town) return false
    return k.split(' ').some((seg) => seg.startsWith(bare) && ORG_TAIL.test(seg.slice(bare.length)))
  })
}

/**
 * 표에서 뜯겨 나온 숫자 덩어리를 걸러 낸다.
 *
 * 요금표는 마침표가 거의 없어 문장 자르기가 통하지 않는다. 그대로 두면
 * '1급지 무료 600 300 9,000 80,000 …' 같은 요금 칸이 조항으로 올라온다.
 * 서술어로 끝맺고 숫자가 지나치게 많지 않은 것만 문장으로 인정한다.
 */
export function looksLikeSentence(s) {
  const t = squash(s)
  if (t.length < 12 || t.length > 300) return false
  if (!/(한다|운영한다|하되|있다|아니다|아니한다|없다|본다|말한다)[.\s]*$|(한다|있다|아니한다)[,.]/.test(t)) {
    return false
  }
  /*
   * 숫자 비율은 보조 잣대일 뿐이다. 표 칸은 위의 서술어 조건에서 이미 걸린다.
   * 너무 조이면 '11월∼3월 09:00∼19:30 ※ 야간, 일요일, 공휴일은 무료로 운영한다' 처럼
   * 시간이 여럿 적힌 멀쩡한 조항까지 떨어져 나간다(밀양시가 그랬다).
   */
  const digits = (t.match(/[0-9]/g) ?? []).length
  return digits / t.length < 0.35
}

async function main() {
  const out = process.argv[2] || DEFAULT_OUT
  const today = new Date().toISOString().slice(0, 10)

  // 데이터에 실제로 쓰이는 관리기관 이름을 모아 둔다 — 규칙이 붙을 자리가 있는지 보려는 것.
  const known = new Map()
  if (existsSync(CELLS)) {
    for (const f of readdirSync(CELLS)) {
      if (f.startsWith('holiday.')) continue
      for (const r of JSON.parse(await readFile(path.join(CELLS, f), 'utf-8')).data ?? []) {
        const k = squash(r.institutionNm)
        if (k) known.set(k, (known.get(k) ?? 0) + 1)
      }
    }
  }
  console.log('데이터의 관리기관 이름 ' + known.size + '종')

  const tables = await listFeeTables()
  console.log('전국 주차요금 별표: ' + tables.length + '곳')

  const findings = []
  const stat = { 내려받기실패: 0, 추출실패: 0, 조항없음: 0, 확정: 0, 원칙: 0, 재량: 0 }
  let done = 0

  for (const t of tables) {
    done++
    const buf = await getBuf(t.url)
    if (!buf) {
      stat.내려받기실패++
      continue
    }
    let text = ''
    try {
      text = documentToText(buf)
    } catch {
      stat.추출실패++
      continue
    }
    const flat = squash(text.replace(/[​﻿]/g, ''))

    const seen = new Set()
    const hits = []
    for (const m of flat.matchAll(new RegExp(TRIGGER, 'g'))) {
      const at = m.index ?? 0
      // 문장 단위로 끊어 앞뒤 맥락(단서 조항)을 함께 담는다.
      const start = Math.max(0, flat.lastIndexOf('.', at - 1) + 1)
      const end = flat.indexOf('.', at + m[0].length)
      const sentence = squash(flat.slice(start, end === -1 ? at + 200 : end + 1))
      if (seen.has(sentence) || !looksLikeSentence(sentence)) continue
      seen.add(sentence)
      const kind = classify(sentence)
      stat[kind]++
      hits.push({ 분류: kind, 범위: readScope(sentence), 원문: sentence.slice(0, 400) })
    }
    if (hits.length === 0) {
      stat.조항없음++
    } else {
      const inst = matchInstitutions(t.org, known.keys())
      findings.push({
        기관: t.org,
        조례: t.ordinName,
        별표: t.bylName.slice(0, 60),
        시행일자: t.date,
        데이터관리기관: inst.map((k) => k + '(' + known.get(k) + '곳)'),
        조항: hits.slice(0, 6),
        출처: 'https://www.law.go.kr/LSW/flDownload.do?flSeq=' + (/flSeq=(\d+)/.exec(t.url)?.[1] ?? ''),
      })
    }
    if (done % 25 === 0) console.log('  …' + done + '/' + tables.length + ' ' + JSON.stringify(stat))
    await sleep(80)
  }

  findings.sort((a, b) => (a.기관 < b.기관 ? -1 : 1))
  await writeFile(
    out,
    JSON.stringify(
      {
        source: '국가법령정보센터 자치법규 — 주차장 조례 [별표] 주차요금표',
        sourceUrl: 'https://www.law.go.kr/DRF/lawSearch.do?target=ordinbyl',
        note: '분류가 확정인 것만 규칙으로 승격할 수 있다. 원칙·재량은 지자체 안내로 따로 확인해야 한다.',
        fetchedOn: today,
        stat,
        findings,
      },
      null,
      1,
    ),
    'utf-8',
  )
  console.log('\n최종: ' + JSON.stringify(stat))
  console.log('조항이 잡힌 지자체 ' + findings.length + '곳 → ' + out)
}

if (process.argv[1] && process.argv[1].includes('fetch-ordinance-rules')) {
  main().catch((err) => {
    console.error('✗ 실패:', err.message)
    process.exit(1)
  })
}
