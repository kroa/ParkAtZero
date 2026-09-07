#!/usr/bin/env node
/**
 * 공유용 미리보기 이미지(Open Graph)를 만든다.
 *
 * index.html 이 /og.svg 를 가리키고 있었는데 그 파일은 존재한 적이 없다.
 * 없는 경로에는 Cloudflare 가 index.html 을 돌려주므로 200 + text/html 이 나가고,
 * 카카오톡·페이스북은 이미지를 못 찾아 미리보기를 비운 채 링크만 보여 준다.
 * 커뮤니티에 공유해서 사람을 데려오려는데 카드가 밋밋하면 클릭이 안 눌린다.
 *
 * SVG 는 애초에 답이 아니다 — 주요 SNS 는 og:image 로 SVG 를 지원하지 않는다.
 * 그래서 HTML 을 브라우저로 찍어 PNG 로 만든다(1200×630, OG 권장 규격).
 *
 * 숫자는 만들 때마다 데이터에서 새로 읽는다. 손으로 적으면 곧 낡는다.
 *
 * ── 빌드 사슬에 넣지 않는다 ────────────────────────────────
 * 이 스크립트는 Playwright 브라우저가 필요한데 배포 워크플로에는 설치 단계가 없다.
 * 넣었더니 배포가 세 커밋 연속 조용히 실패했다(사이트는 옛 버전 그대로였다).
 * 결과물 public/og.png 를 저장소에 두고 vite 가 그대로 복사하게 한다.
 * 숫자가 크게 달라졌을 때만 `npm run seo:og` 로 다시 만들어 커밋한다.
 *
 * 사용: npm run seo:og   (기본 출력 public/)
 */
import path from 'node:path'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const CELLS = path.join('public', 'data', 'cells')
const DEFAULT_OUT = 'public'

/** 데이터에서 표시할 숫자를 센다. 요금 판정까지 하지 않고 개수만 본다. */
async function stats() {
  let total = 0
  let free = 0
  let referenceDate = ''
  if (!existsSync(CELLS)) return { total: 0, free: 0, referenceDate: '' }
  for (const f of await readdir(CELLS)) {
    if (f.startsWith('holiday.') || !f.endsWith('.json')) continue
    for (const r of JSON.parse(await readFile(path.join(CELLS, f), 'utf-8')).data ?? []) {
      total++
      const charge = String(r.parkingchrgeInfo ?? '').trim()
      const note = String(r.spcmnt ?? '')
      if (charge === '무료' || /무료|면제/.test(note)) free++
      const ref = String(r.referenceDate ?? '')
      if (ref > referenceDate) referenceDate = ref
    }
  }
  return { total, free, referenceDate }
}

const n = (x) => x.toLocaleString('ko-KR')

/** 1200×630 카드. 시스템 폰트만 쓴다 — 빌드에서 웹폰트를 기다리면 깨질 위험이 있다. */
function cardHtml({ total, free, referenceDate }) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1200px;height:630px;display:flex;flex-direction:column;justify-content:center;
  padding:0 84px;font-family:"Malgun Gothic","맑은 고딕",system-ui,sans-serif;
  background:linear-gradient(135deg,#ecfdf5 0%,#f8fafc 55%,#ffffff 100%);color:#0f172a;position:relative}
.mark{display:flex;align-items:center;gap:16px;margin-bottom:28px}
.logo{width:64px;height:64px;border-radius:16px;background:linear-gradient(135deg,#34d399,#059669);
  color:#fff;font-size:38px;font-weight:800;display:flex;align-items:center;justify-content:center}
.brand{font-size:26px;font-weight:700;color:#059669;letter-spacing:-0.01em}
h1{font-size:74px;line-height:1.12;font-weight:800;letter-spacing:-0.03em;margin-bottom:22px}
h1 em{font-style:normal;color:#059669}
p{font-size:30px;line-height:1.5;color:#475569;margin-bottom:40px}
.stats{display:flex;gap:52px}
.stat b{display:block;font-size:46px;font-weight:800;letter-spacing:-0.02em}
.stat span{font-size:21px;color:#64748b}
.foot{position:absolute;right:84px;bottom:56px;text-align:right;font-size:20px;color:#94a3b8}
.bar{position:absolute;left:0;top:0;width:14px;height:100%;background:linear-gradient(180deg,#34d399,#059669)}
</style></head><body>
<div class="bar"></div>
<div class="mark"><div class="logo">P</div><div class="brand">ParkAtZero</div></div>
<h1>지금 이 시간에<br><em>0원</em>인 주차장만</h1>
<p>방문할 시간을 고르면, 그때 요금을 받지 않는 곳만 보여줍니다.</p>
<div class="stats">
  <div class="stat"><b>${n(total)}곳</b><span>전국 주차장</span></div>
  <div class="stat"><b style="color:#059669">${n(free)}곳</b><span>무료 요소가 있는 곳</span></div>
</div>
<div class="foot">parkatzero.pages.dev${referenceDate ? '<br>데이터 기준 ' + referenceDate : ''}</div>
</body></html>`
}

async function main() {
  const outDir = process.argv[2] || DEFAULT_OUT
  const s = await stats()
  console.log('숫자: 전국 ' + n(s.total) + ' · 무료 요소 ' + n(s.free) + ' · 기준 ' + (s.referenceDate || '(없음)'))

  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
    await page.setContent(cardHtml(s), { waitUntil: 'load' })
    const png = await page.screenshot({ type: 'png' })
    const file = path.join(outDir, 'og.png')
    await writeFile(file, png)
    console.log('저장: ' + file + ' (' + Math.round(png.length / 1024) + 'KB)')
  } finally {
    await browser.close()
  }
}

if (process.argv[1] && process.argv[1].includes('build-og-image')) {
  main().catch((err) => {
    console.error('✗ 실패:', err.message)
    process.exit(1)
  })
}
