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

async function collect(): Promise<{ regions: Map<string, Region>; referenceDate: string }> {
  const regions = new Map<string, Region>()
  let referenceDate = ''

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

      const { label, always } = freeLabelOf(p)
      if (!label) continue // 무료 요소가 없는 곳은 이 페이지의 주제가 아니다

      const key = region.sido + '|' + region.sgg
      if (!regions.has(key)) regions.set(key, { sido: region.sido, sgg: region.sgg, lots: [] })
      regions.get(key)!.lots.push({ p, freeLabel: label, always })
    }
  }
  return { regions, referenceDate: referenceDate || new Date().toISOString().slice(0, 10) }
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
  return shell({
    title: `${name} 무료 주차장 ${r.lots.length}곳 — ${r.sido} | 0원 주차`,
    description: desc,
    canonical: SITE + regionPath(r.sido, r.sgg),
    h1: `${where} 무료 주차장`,
    body,
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

async function main() {
  const dist = process.argv[2] ?? 'dist'
  if (!existsSync(dist)) throw new Error(dist + ' 이 없습니다. vite build 뒤에 실행하세요.')

  const { regions, referenceDate } = await collect()

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
    await write(regionPath(sido, ''), sidoPage(sido, rs, referenceDate), '0.8')
    for (const r of rs) await write(regionPath(r.sido, r.sgg), regionPage(r, rs, referenceDate), '0.7')
  }

  await writeFile(path.join(dist, 'region-pages.json'), JSON.stringify(written, null, 1), 'utf-8')
  const totalLots = kept.reduce((s, r) => s + r.lots.length, 0)
  console.log(
    '지역 페이지 ' + written.length + '개 (시도 ' + bySido.size + ' · 시군구 ' + kept.length + ')' +
      ' · 실린 주차장 ' + totalLots + '곳 · ' + MIN_LOTS + '곳 미만이라 건너뛴 지역 ' + dropped + '개',
  )
}

main().catch((err) => {
  console.error('✗ 실패:', err.message)
  process.exit(1)
})
