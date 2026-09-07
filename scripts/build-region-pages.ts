/**
 * 시·군·구별 정적 랜딩 페이지를 만든다.
 *
 * 이 앱은 페이지가 하나뿐인 SPA 라 크롤러가 보는 본문이 61자("JavaScript 가 필요합니다")밖에
 * 없었다. 색인될 내용도, "종로구 무료주차장" 같은 검색어에 걸릴 표면도 없다는 뜻이다.
 * 데이터 19,975곳이 이미 정적 JSON 이니 재료는 다 있다 — 빌드 때 진짜 목록이 담긴
 * HTML 을 만들어 둔다.
 *
 * 얇은 유입용 페이지를 뿌리려는 게 아니다. 각 페이지에는 그 지역에서 실제로 요금을 받지
 * 않는 주차장의 이름·주소·무료 조건·운영시간이 들어간다. 사람이 읽어서 쓸모가 있어야
 * 검색엔진에도 값이 있다.
 *
 * vite build 가 dist 를 비우므로 반드시 그 뒤에 돌린다.
 * 사용: npx tsx scripts/build-region-pages.ts [dist경로]
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { normalizeParking } from '@/lib/normalize'
import { extractFreeRules } from '@/lib/timeRules'
import type { Parking } from '@/types/parking'
import { parseRegion, regionPath } from './lib/region.mjs'

const SITE = process.env.SITE_ORIGIN ?? 'https://parkatzero.pages.dev'
const CELLS = path.join('public', 'data', 'cells')
/** 이보다 적으면 페이지를 만들지 않는다. 내용이 얇으면 사람에게도 검색엔진에도 값이 없다. */
const MIN_LOTS = 5
/** 한 페이지에 싣는 최대 개수. 제주시는 1,400곳이 넘어 그대로 실으면 문서가 너무 커진다. */
const MAX_ROWS = 300
/*
 * 구조화 데이터에 담을 최대 개수.
 * ParkingFacility 노드 하나가 표의 한 줄보다 네 배쯤 무겁다. 300개를 다 담으면
 * 문서가 268KB 까지 부풀어 모바일 지표에 손해다. 사람이 읽는 표는 그대로 두고
 * 구조화 데이터만 줄인다 — 검색엔진에는 앞쪽 100개로도 이 페이지가 무엇인지 충분하다.
 */
const MAX_LD = 100

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

interface Lot {
  p: Parking
  freeLabel: string
  /** 조건 없이 늘 0원인가 */
  always: boolean
}

interface Region {
  sido: string
  sgg: string
  lots: Lot[]
}

/** 운영시간을 사람이 읽는 문장으로. */
function hoursLabel(p: Parking): string {
  const fmt = (r: Parking['hours']['weekday']) => {
    if (!r) return '미운영'
    if (r.allDay) return '24시간'
    const hh = (m: number) => String(Math.floor((m % 1440) / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')
    return hh(r.open) + '~' + hh(r.close)
  }
  const w = fmt(p.hours.weekday)
  const s = fmt(p.hours.saturday)
  const h = fmt(p.hours.holiday)
  if (w === s && s === h) return w === '미운영' ? '운영시간 정보 없음' : '매일 ' + w
  return '평일 ' + w + ' · 토 ' + s + ' · 공휴일 ' + h
}

/** 왜 무료인지 한 줄로. 없으면 빈 문자열. */
function freeLabelOf(p: Parking): { label: string; always: boolean } {
  if (p.chargeType === '무료') return { label: '상시 무료', always: true }
  const rules = extractFreeRules(p)
  if (rules.length === 0) return { label: '', always: false }
  const always = rules.some((r) => r.kind === 'always')
  return { label: rules.map((r) => r.label).join(' · '), always }
}

async function collect(): Promise<{ regions: Map<string, Region>; referenceDate: string; totalLots: number }> {
  const regions = new Map<string, Region>()
  let referenceDate = ''
  let totalLots = 0

  for (const f of await readdir(CELLS)) {
    if (f.startsWith('holiday.') || !f.endsWith('.json')) continue
    const cell = JSON.parse(await readFile(path.join(CELLS, f), 'utf-8'))
    for (const raw of cell.data ?? []) {
      const ref = String(raw.referenceDate ?? '')
      if (ref > referenceDate) referenceDate = ref

      const region = parseRegion(raw.rdnmadr || raw.lnmadr)
      if (!region) continue
      const p = normalizeParking(raw, 0)
      if (!p) continue
      totalLots++

      const { label, always } = freeLabelOf(p)
      if (!label) continue // 무료 요소가 없는 곳은 이 페이지의 주제가 아니다

      const key = region.sido + '|' + region.sgg
      if (!regions.has(key)) regions.set(key, { sido: region.sido, sgg: region.sgg, lots: [] })
      regions.get(key)!.lots.push({ p, freeLabel: label, always })
    }
  }
  return { regions, referenceDate: referenceDate || new Date().toISOString().slice(0, 10), totalLots }
}

const STYLE = `
:root{--ink:#111827;--mute:#6b7280;--line:#e5e7eb;--free:#059669;--bg:#fff}
@media(prefers-color-scheme:dark){:root{--ink:#e5e7eb;--mute:#9ca3af;--line:#374151;--free:#34d399;--bg:#0b0f14}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:24px 20px 64px}
a{color:inherit}
h1{font-size:26px;line-height:1.3;margin:8px 0 4px}
h2{font-size:19px;margin:36px 0 10px;padding-top:16px;border-top:1px solid var(--line)}
.lead{color:var(--mute);margin:0 0 8px}
.cta{display:inline-block;margin:16px 0;padding:11px 18px;border-radius:10px;background:var(--free);color:#fff;text-decoration:none;font-weight:700}
table{width:100%;border-collapse:collapse;margin:8px 0 4px;font-size:14px}
th,td{text-align:left;padding:9px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--mute);font-weight:600;white-space:nowrap}
.free{color:var(--free);font-weight:700}
.warn{color:#b45309;font-weight:600}
@media(prefers-color-scheme:dark){.warn{color:#fbbf24}}
.nm{font-weight:600}
.links{margin:10px 0 0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:8px 14px}
.links a{color:var(--mute);text-decoration:none;font-size:14px}
.links a:hover{color:var(--ink);text-decoration:underline}
footer{margin-top:44px;padding-top:16px;border-top:1px solid var(--line);color:var(--mute);font-size:13px}
.scroll{overflow-x:auto}
`

/**
 * JSON-LD 를 <script> 로 감싼다.
 * 본문에 </script> 가 섞여 들어가 문서를 깨뜨리지 않도록 슬래시를 이스케이프한다.
 */
function jsonLd(data: unknown): string {
  return '\n<script type="application/ld+json">' + JSON.stringify(data).replace(/</g, '\\u003c') + '</script>'
}

/** 빵부스러기 — 검색결과에 경로가 함께 노출된다. */
function breadcrumb(trail: Array<{ name: string; path: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t.name,
      item: SITE + t.path,
    })),
  }
}

/*
 * 운영시간을 schema.org 형식으로.
 * 평일 칸은 월~금, 토요일 칸은 토요일, 공휴일 칸은 일요일과 공휴일에 대응한다
 * — 이 앱의 요일 구분(weekday/saturday/holiday)이 원래 그런 뜻이다.
 */
const DAY_MAP: Record<string, string[]> = {
  weekday: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  saturday: ['Saturday'],
  holiday: ['Sunday', 'PublicHolidays'],
}

function openingHours(p: Parking) {
  const out: Array<Record<string, unknown>> = []
  for (const key of ['weekday', 'saturday', 'holiday'] as const) {
    const r = p.hours[key]
    if (!r) continue
    const hh = (m: number) =>
      String(Math.floor((m % 1440) / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')
    out.push({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: DAY_MAP[key],
      opens: r.allDay ? '00:00' : hh(r.open),
      closes: r.allDay ? '23:59' : hh(r.close),
    })
  }
  return out
}

function parkingFacility(l: Lot, sido: string, sgg: string) {
  const node: Record<string, unknown> = {
    '@type': 'ParkingFacility',
    name: l.p.name,
    address: {
      '@type': 'PostalAddress',
      addressCountry: 'KR',
      addressRegion: sido,
      addressLocality: sgg || sido,
      streetAddress: l.p.address,
    },
    geo: { '@type': 'GeoCoordinates', latitude: l.p.lat, longitude: l.p.lng },
  }
  /*
   * isAccessibleForFree 는 조건 없이 늘 공짜일 때만 붙인다.
   * '토요일만 무료' 인 곳에 이걸 달면 검색결과가 언제나 무료라고 말하게 된다.
   */
  if (l.always && !l.p.restriction) node.isAccessibleForFree = true
  if (l.p.capacity > 0) node.maximumAttendeeCapacity = l.p.capacity
  const hours = openingHours(l.p)
  if (hours.length > 0) node.openingHoursSpecification = hours
  return node
}

function shell(opts: {
  title: string
  description: string
  canonical: string
  h1: string
  body: string
  extraHead?: string
}): string {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
<link rel="canonical" href="${esc(opts.canonical)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(opts.title)}">
<meta property="og:description" content="${esc(opts.description)}">
<meta property="og:url" content="${esc(opts.canonical)}">
<meta property="og:site_name" content="ParkAtZero">
<meta property="og:locale" content="ko_KR">
<!--
  공유 미리보기 이미지. 없으면 카카오톡·커뮤니티에 붙였을 때 카드가 비어 링크만 나온다.
  지역마다 따로 만들지 않고 하나를 함께 쓴다 — 제목·설명이 이미 지역별로 다르므로
  카드에서 구분이 되고, 217장을 만들면 배포물만 무거워진다.
-->
<meta property="og:image" content="${SITE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg">
<style>${STYLE}</style>${opts.extraHead ?? ''}
</head>
<body><div class="wrap">
<p class="lead"><a href="/">0원 주차</a> › <a href="/지역/">지역별</a></p>
<h1>${esc(opts.h1)}</h1>
${opts.body}
<footer>
출처: 공공데이터포털 「전국주차장정보표준데이터」 외 · 공공누리 제1유형.<br>
요금·운영시간은 관리기관 고시를 따르며 현장과 다를 수 있습니다. 방문 전 확인하세요.
</footer>
</div></body></html>
`
}

function regionPage(r: Region, siblings: Region[], referenceDate: string): string {
  const sorted = [...r.lots].sort((a, b) => {
    if (a.always !== b.always) return a.always ? -1 : 1
    return a.p.name.localeCompare(b.p.name, 'ko')
  })
  const shown = sorted.slice(0, MAX_ROWS)
  const alwaysCount = r.lots.filter((l) => l.always).length
  const condCount = r.lots.length - alwaysCount
  const where = r.sgg ? r.sido + ' ' + r.sgg : r.sido
  const name = r.sgg || r.sido

  const center = shown.length
    ? {
        lat: shown.reduce((s, l) => s + l.p.lat, 0) / shown.length,
        lng: shown.reduce((s, l) => s + l.p.lng, 0) / shown.length,
      }
    : null

  /*
   * 이용 제한을 반드시 같이 보여 준다.
   * '관광버스 전용 주차장' 이 요금은 0원이라고 그냥 '무료'로 실리면, 승용차로 찾아간
   * 사람은 대지도 못하고 돌아온다. 무료라고 잘못 안내하는 것과 다를 바 없다.
   */
  const rows = shown
    .map(
      (l) => `<tr>
<td class="nm">${esc(l.p.name)}</td>
<td class="${l.always ? 'free' : ''}">${esc(l.freeLabel)}</td>
<td>${l.p.restriction ? '<span class="warn">' + esc(l.p.restriction) + '</span>' : '누구나'}</td>
<td>${esc(hoursLabel(l.p))}</td>
<td>${esc(l.p.address)}</td>
</tr>`,
    )
    .join('\n')

  const restricted = r.lots.filter((l) => l.p.restriction).length

  const sibs = siblings
    .filter((s) => s.sgg !== r.sgg)
    .sort((a, b) => a.sgg.localeCompare(b.sgg, 'ko'))
    .map((s) => `<li><a href="${regionPath(s.sido, s.sgg)}">${esc(s.sgg)}</a></li>`)
    .join('')

  const desc =
    `${where}에서 주차요금을 받지 않는 주차장 ${r.lots.length}곳. ` +
    `상시 무료 ${alwaysCount}곳, 시간·요일에 따라 무료인 곳 ${condCount}곳. 이름·주소·무료 조건·운영시간을 정리했습니다.`

  const body = `
<p class="lead">${esc(desc)}</p>
${center ? `<a class="cta" href="/?lat=${center.lat.toFixed(5)}&amp;lng=${center.lng.toFixed(5)}&amp;z=13">지도에서 지금 무료인 곳 보기</a>` : ''}

<h2>${esc(name)}의 무료 주차장 ${r.lots.length}곳</h2>
${r.lots.length > shown.length ? `<p class="lead">이 가운데 ${shown.length}곳을 싣습니다. 나머지는 지도에서 볼 수 있습니다.</p>` : ''}
${restricted ? `<p class="lead">${restricted}곳은 버스·거주자 등 이용 대상이 정해져 있습니다. 아래 <b>이용</b> 칸을 확인하세요.</p>` : ''}
<div class="scroll"><table>
<thead><tr><th>주차장</th><th>무료 조건</th><th>이용</th><th>운영시간</th><th>주소</th></tr></thead>
<tbody>
${rows}
</tbody></table></div>

${sibs ? `<h2>${esc(r.sido)}의 다른 지역</h2><ul class="links">${sibs}</ul>` : ''}
<p class="lead" style="margin-top:24px">데이터 기준 ${esc(referenceDate)}</p>
`
  const ld =
    jsonLd(
      breadcrumb([
        { name: '0원 주차', path: '/' },
        { name: '지역별', path: '/지역/' },
        { name: r.sido, path: regionPath(r.sido, '') },
        { name: name, path: regionPath(r.sido, r.sgg) },
      ]),
    ) +
    jsonLd({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: `${where} 무료 주차장`,
      numberOfItems: Math.min(shown.length, MAX_LD),
      itemListElement: shown.slice(0, MAX_LD).map((l, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: parkingFacility(l, r.sido, r.sgg),
      })),
    })

  return shell({
    // 세종처럼 시군구가 없는 곳은 name 과 sido 가 같아 '세종 — 세종' 이 된다.
    title:
      name === r.sido
        ? `${name} 무료 주차장 ${r.lots.length}곳 | 0원 주차`
        : `${name} 무료 주차장 ${r.lots.length}곳 — ${r.sido} | 0원 주차`,
    description: desc,
    canonical: SITE + regionPath(r.sido, r.sgg),
    h1: `${where} 무료 주차장`,
    body,
    extraHead: ld,
  })
}

function sidoPage(sido: string, regions: Region[], referenceDate: string): string {
  const total = regions.reduce((s, r) => s + r.lots.length, 0)
  const items = [...regions]
    .sort((a, b) => b.lots.length - a.lots.length)
    .map((r) => `<li><a href="${regionPath(r.sido, r.sgg)}">${esc(r.sgg || r.sido)} (${r.lots.length}곳)</a></li>`)
    .join('')
  const desc = `${sido}에서 주차요금을 받지 않는 주차장 ${total}곳을 시·군·구별로 정리했습니다.`
  return shell({
    title: `${sido} 무료 주차장 ${total}곳 | 0원 주차`,
    description: desc,
    canonical: SITE + regionPath(sido, ''),
    h1: `${sido} 무료 주차장`,
    extraHead: jsonLd(
      breadcrumb([
        { name: '0원 주차', path: '/' },
        { name: '지역별', path: '/지역/' },
        { name: sido, path: regionPath(sido, '') },
      ]),
    ),
    body: `<p class="lead">${esc(desc)}</p><h2>시·군·구</h2><ul class="links">${items}</ul>
<p class="lead" style="margin-top:24px">데이터 기준 ${esc(referenceDate)}</p>`,
  })
}

function indexPage(bySido: Map<string, Region[]>, referenceDate: string): string {
  const total = [...bySido.values()].flat().reduce((s, r) => s + r.lots.length, 0)
  const items = [...bySido.entries()]
    .map(([sido, rs]) => ({ sido, n: rs.reduce((s, r) => s + r.lots.length, 0) }))
    .sort((a, b) => b.n - a.n)
    .map((x) => `<li><a href="${regionPath(x.sido, '')}">${esc(x.sido)} (${x.n}곳)</a></li>`)
    .join('')
  const desc = `전국에서 주차요금을 받지 않는 주차장 ${total}곳을 지역별로 정리했습니다.`
  return shell({
    title: `지역별 무료 주차장 — 전국 ${total}곳 | 0원 주차`,
    description: desc,
    canonical: SITE + '/지역/',
    h1: '지역별 무료 주차장',
    body: `<p class="lead">${esc(desc)}</p><h2>시·도</h2><ul class="links">${items}</ul>
<p class="lead" style="margin-top:24px">데이터 기준 ${esc(referenceDate)}</p>`,
  })
}

/**
 * 홈(index.html)의 #root 안에 들어갈 정적 소개.
 *
 * 앱은 자바스크립트로 그려져서 크롤러가 보는 본문이 <noscript> 몇 줄뿐이었다.
 * React 는 첫 렌더에서 #root 를 비우므로, 여기에 글을 넣어 두면 사용자에게는 앱이
 * 보이고 자바스크립트를 실행하지 않는 크롤러에게는 이 글이 보인다.
 *
 * 숫자는 데이터에서 뽑는다 — 손으로 적으면 다음 갱신에 바로 낡는다.
 */
function homeStatic(bySido: Map<string, Region[]>, totalLots: number, freeLots: number, referenceDate: string): string {
  const sidoLinks = [...bySido.entries()]
    .map(([sido, rs]) => ({ sido, n: rs.reduce((s, r) => s + r.lots.length, 0) }))
    .sort((a, b) => b.n - a.n)
    .map((x) => `<li><a href="${regionPath(x.sido, '')}">${esc(x.sido)} ${x.n}곳</a></li>`)
    .join('')

  return `<div class="pz-static" style="max-width:820px;margin:0 auto;padding:28px 20px 56px;font:16px/1.7 system-ui,-apple-system,'Segoe UI',sans-serif">
<h1 style="font-size:26px;line-height:1.3;margin:0 0 10px">0원 주차 — 지금 무료로 댈 수 있는 주차장</h1>
<p style="margin:0 0 14px">방문할 날짜와 시간을 고르면 <b>그 시간에 요금을 받지 않는 주차장만</b> 골라 보여줍니다. 회원가입도, 앱 설치도 필요 없습니다.</p>
<p style="margin:0 0 14px">전국 공영·민영 주차장 <b>${totalLots.toLocaleString('ko-KR')}곳</b>을 담고 있으며, 그중 <b>${freeLots.toLocaleString('ko-KR')}곳</b>은 시간대나 요일에 따라 요금을 받지 않습니다. 데이터 기준일 ${esc(referenceDate)}.</p>

<h2 style="font-size:19px;margin:28px 0 8px">어떻게 판단하나요</h2>
<p style="margin:0 0 10px">'무료'라고 적힌 것만 모으지 않습니다. 주차장마다 요일별 운영시간과 요금표를 읽어 <b>방문하려는 그 시각에 실제로 0원인지</b> 계산합니다.</p>
<ul style="margin:0 0 10px;padding-left:20px">
<li>노상주차장은 징수시간이 끝나면 요금을 받지 않습니다 — 그 시간대를 따로 계산합니다.</li>
<li>일요일·공휴일 무료는 한국천문연구원 특일 정보의 공휴일표로 판단합니다. 대체공휴일도 포함합니다.</li>
<li>지자체 조례의 주차요금표에 적힌 야간·공휴일 면제 조항을 반영합니다.</li>
<li>'최초 30분 무료'처럼 조건이 붙은 곳과 관광버스·거주자 전용처럼 이용 대상이 정해진 곳은 따로 구분해 표시합니다.</li>
</ul>

<h2 style="font-size:19px;margin:28px 0 8px">지역별로 보기</h2>
<ul style="margin:0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:8px 16px">${sidoLinks}</ul>
<p style="margin:12px 0 0"><a href="/지역/">전체 지역 목록 보기</a></p>

<p style="margin:28px 0 0;color:#6b7280;font-size:13px">
출처: 공공데이터포털 「전국주차장정보표준데이터」, 서울 열린데이터광장, 지자체 조례 및 관리기관 안내 · 공공누리 제1유형.<br>
요금·운영시간은 관리기관 고시를 따르며 현장과 다를 수 있습니다. 방문 전 확인하세요.
</p>
</div>`
}

async function main() {
  const dist = process.argv[2] ?? 'dist'
  if (!existsSync(dist)) throw new Error(dist + ' 이 없습니다. vite build 뒤에 실행하세요.')

  const { regions, referenceDate, totalLots } = await collect()

  const kept = [...regions.values()].filter((r) => r.lots.length >= MIN_LOTS)
  const dropped = regions.size - kept.length
  const bySido = new Map<string, Region[]>()
  for (const r of kept) {
    if (!bySido.has(r.sido)) bySido.set(r.sido, [])
    bySido.get(r.sido)!.push(r)
  }

  const written: Array<{ path: string; priority: string }> = []
  const write = async (p: string, html: string, priority: string) => {
    const dir = path.join(dist, ...p.split('/').filter(Boolean))
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'index.html'), html, 'utf-8')
    written.push({ path: p, priority })
  }

  await write('/지역/', indexPage(bySido, referenceDate), '0.9')
  for (const [sido, rs] of bySido) {
    /*
     * 세종특별자치시는 아래에 시·군·구가 없다. 그래서 시도 페이지와 지역 페이지의
     * 경로가 /지역/세종특별자치시/ 로 똑같아져 사이트맵에 같은 주소가 두 번 실렸다.
     * 이럴 때는 목차 격인 시도 페이지를 건너뛴다 — 주차장 목록이 든 쪽이 쓸모 있다.
     */
    const collides = rs.some((r) => r.sgg === '')
    if (!collides) await write(regionPath(sido, ''), sidoPage(sido, rs, referenceDate), '0.8')
    for (const r of rs) await write(regionPath(r.sido, r.sgg), regionPage(r, rs, referenceDate), '0.7')
  }

  /*
   * 홈의 자리 표시를 실제 글로 바꾼다. 자리 표시가 없으면(구조가 바뀌었으면) 조용히
   * 넘어가지 않고 알린다 — 모르는 사이에 홈이 다시 빈 페이지가 되면 안 된다.
   */
  const indexFile = path.join(dist, 'index.html')
  const freeLots = [...regions.values()].reduce((s, r) => s + r.lots.length, 0)
  const html = await readFile(indexFile, 'utf-8')
  if (html.includes('<!--HOME_STATIC-->')) {
    await writeFile(
      indexFile,
      html.replace('<!--HOME_STATIC-->', homeStatic(bySido, totalLots, freeLots, referenceDate)),
      'utf-8',
    )
    console.log('홈 정적 소개 주입: 전국 ' + totalLots + '곳 / 무료 요소 ' + freeLots + '곳')
  } else {
    console.warn('  ! index.html 에 <!--HOME_STATIC--> 자리 표시가 없습니다 — 홈은 그대로 둡니다')
  }

  await writeFile(path.join(dist, 'region-pages.json'), JSON.stringify(written, null, 1), 'utf-8')
  const listedLots = kept.reduce((s, r) => s + r.lots.length, 0)
  console.log(
    '지역 페이지 ' + written.length + '개 (시도 ' + bySido.size + ' · 시군구 ' + kept.length + ')' +
      ' · 실린 주차장 ' + listedLots + '곳 · ' + MIN_LOTS + '곳 미만이라 건너뛴 지역 ' + dropped + '개',
  )
}

main().catch((err) => {
  console.error('✗ 실패:', err.message)
  process.exit(1)
})
