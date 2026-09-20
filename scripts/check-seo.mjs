#!/usr/bin/env node
/**
 * 배포된 사이트의 검색 노출 배관을 점검한다.
 *
 * 데이터를 갱신하고 다시 배포할 때마다 사이트맵·소유확인 태그·지역 페이지가 그대로
 * 살아 있는지 확인할 곳이 필요하다. 검색 콘솔은 며칠 뒤에야 결과를 보여 주므로,
 * 그 전에 우리 쪽 잘못을 먼저 걸러 낸다.
 *
 * 검색엔진이 <색인을 했는지> 는 여기서 알 수 없다. 그건 콘솔에서 봐야 한다.
 * 이 스크립트가 보는 것은 <색인할 수 있게 해 뒀는지> 다.
 *
 * 사용: node scripts/check-seo.mjs [사이트주소]
 */
const SITE = (process.argv[2] || process.env.SITE_ORIGIN || 'https://parkatzero.pages.dev').replace(/\/$/, '')
const BOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
/** 개별 주소를 몇 개씩 동시에 확인할지. 너무 높이면 상대 서버에 부담이 된다. */
const CONC = 12

let failed = 0
const ok = (cond, label, detail = '') => {
  if (!cond) failed++
  console.log('  ' + (cond ? '✓' : '✗') + ' ' + label + (detail ? ' — ' + detail : ''))
}

const get = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': BOT } })
  return { status: res.status, type: res.headers.get('content-type') ?? '', body: await res.text() }
}

async function main() {
  console.log('점검 대상: ' + SITE + '\n')

  /* 1) 홈 — 소유확인 태그와 크롤 경로 */
  console.log('홈')
  const home = await get(SITE + '/')
  ok(home.status === 200, '응답 200', 'HTTP ' + home.status)
  ok(/name="google-site-verification"/.test(home.body), 'Google 소유확인 태그')
  ok(/name="naver-site-verification"/.test(home.body), '네이버 소유확인 태그')
  ok(/application\/ld\+json/.test(home.body), '구조화 데이터(WebApplication)')
  // <noscript> 안의 지역 목록 링크가 크롤러에게 유일한 내부 경로다.
  ok(/href="\/지역\/"/.test(home.body), '지역 목록으로 가는 크롤 가능한 링크')
  ok(!/<meta[^>]+name="robots"[^>]+noindex/i.test(home.body), 'noindex 없음')

  /* 2) robots.txt */
  console.log('\nrobots.txt')
  const robots = await get(SITE + '/robots.txt')
  ok(robots.status === 200 && robots.body.length < 2000, '응답 200', String(robots.body.trim().length) + 'B')
  ok(/Sitemap:\s*\S+sitemap\.xml/i.test(robots.body), 'Sitemap 줄 있음')
  ok(!/Disallow:\s*\/\s*$/m.test(robots.body), '전체 차단 아님')

  /* 3) sitemap.xml */
  console.log('\nsitemap.xml')
  const sm = await get(SITE + '/sitemap.xml')
  ok(sm.status === 200, '응답 200', 'HTTP ' + sm.status)
  ok(/xml/.test(sm.type), 'XML 로 응답', sm.type)
  // 없는 파일에 SPA 폴백이 오면 200 + HTML 이라 조용히 통과한다. 내용을 봐야 안다.
  ok(!/<!doctype html>/i.test(sm.body), 'SPA 폴백이 아님')

  const urls = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim())
  ok(urls.length > 1, '주소 ' + urls.length + '개', urls.length > 50_000 ? '상한 초과!' : '')
  const dup = urls.filter((u, i) => urls.indexOf(u) !== i)
  ok(dup.length === 0, '중복 주소 없음', dup.length ? dup.length + '건: ' + dup[0] : '')
  ok(
    urls.every((u) => u.startsWith(SITE + '/')),
    '모두 같은 호스트',
  )
  const lastmods = [...sm.body.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1].trim())
  ok(
    lastmods.every((d) => /^\d{4}-\d{2}-\d{2}(T[\d:+\-.Z]+)?$/.test(d)),
    'lastmod 형식',
  )

  /*
   * 3.5) 흔한 오타 경로가 HTML 을 돌려주지 않는가.
   *
   * Search Console 에 /sitemaps.xml (복수) 로 제출된 항목이 열흘 동안 "가져올 수 없음"
   * 으로 남아 있었다. 그 경로는 SPA 폴백 때문에 200 + HTML 을 돌려주고 있었고, 화면만
   * 봐서는 무엇이 잘못됐는지 알 수 없었다. 오타를 진짜 사이트맵으로 넘기게 해 뒀으니
   * 그게 살아 있는지 확인한다.
   */
  console.log('\n오타 경로')
  for (const wrong of ['/sitemaps.xml', '/sitemap_index.xml']) {
    const r = await get(SITE + wrong)
    ok(
      r.status === 200 && /xml/.test(r.type) && !/<!doctype html>/i.test(r.body),
      wrong + ' 이 사이트맵으로 이어짐',
      'HTTP ' + r.status + ' ' + r.type,
    )
  }

  /*
   * 3.6) 없는 경로가 404 를 돌려주는가.
   *
   * Cloudflare Pages 는 최상위 404.html 이 없으면 없는 경로에 index.html 을 200 으로
   * 돌려준다. 실제로 /지역/없는지역/ 같은 주소가 전부 200 + HTML 이었다. 검색엔진은
   * 이것을 soft 404 로 보고, 90일에 40회밖에 안 되는 크롤을 없는 주소에 쓴다.
   */
  console.log('\n없는 경로')
  for (const missing of ['/zzz-does-not-exist-check', '/지역/없는지역/']) {
    const r = await get(SITE + missing)
    ok(r.status === 404, missing + ' 가 404 를 돌려줌', 'HTTP ' + r.status)
  }

  /* 4) IndexNow 키 */
  console.log('\nIndexNow')
  const keyName = /\/([0-9a-f]{8,128})\.txt/.exec(robots.body)?.[1]
  const { readdir, readFile } = await import('node:fs/promises')
  let key = keyName
  if (!key) {
    for (const f of await readdir('public')) {
      const m = /^([0-9a-f]{8,128})\.txt$/.exec(f)
      if (m) key = m[1]
    }
  }
  if (key) {
    const kf = await get(SITE + '/' + key + '.txt')
    ok(kf.status === 200 && kf.body.trim() === key, '키 파일이 배포돼 있음', key.slice(0, 8) + '…')
    void readFile
  } else {
    ok(false, 'public/ 에서 키 파일을 찾지 못함')
  }

  /*
   * 4.5) 로컬 빌드와 배포본이 같은가.
   *
   * 배포가 조용히 실패할 수 있다. 실제로 og 이미지 생성에 브라우저가 필요한데
   * 배포 워크플로에는 설치 단계가 없어 세 커밋 연속 실패했고, 사이트는 옛 버전
   * 그대로였는데 아무 신호도 없었다. 개수를 맞춰 보면 바로 드러난다.
   */
  console.log('\n로컬 빌드와 대조')
  const localSitemap = 'dist/sitemap.xml'
  const { readFile: rf } = await import('node:fs/promises')
  const { existsSync: ex } = await import('node:fs')
  if (ex(localSitemap)) {
    const localXml = await rf(localSitemap, 'utf-8')
    const localCount = (localXml.match(/<loc>/g) ?? []).length
    ok(
      localCount === urls.length,
      '배포본이 최신 빌드와 같음',
      '로컬 ' + localCount + ' / 배포 ' + urls.length + (localCount === urls.length ? '' : ' — 배포가 아직 안 됐거나 실패했습니다'),
    )
  } else {
    console.log('  · dist/sitemap.xml 이 없어 건너뜁니다 (npm run build:only 먼저)')
  }

  /*
   * 사이트맵 개수만으로는 부족하다.
   *
   * 실제로 데이터만 고친 커밋 두 개가 배포되지 않았는데 이 검사는 통과했다.
   * 주소 수가 273 으로 그대로였기 때문이다. 배포본은 망원시장 노상을 1면으로,
   * 로컬은 17면으로 들고 있었는데도 "최신 빌드와 같음" 이라고 말했다.
   *
   * 격자 색인은 칸 파일 이름에 내용 해시가 들어 있어, 데이터가 한 곳만 바뀌어도
   * 값이 달라진다. 그걸 대조하면 이번 같은 실패가 바로 드러난다.
   */
  const localIndex = 'dist/data/cell-index.json'
  if (ex(localIndex)) {
    const local = JSON.parse(await rf(localIndex, 'utf-8'))
    const live = await get(SITE + '/data/cell-index.json')
    let remote = null
    try {
      remote = JSON.parse(live.body)
    } catch {
      /* 아래에서 실패로 잡는다 */
    }
    const names = (idx) =>
      Object.values(idx?.cells ?? {})
        .map((c) => String(c?.file ?? ''))
        .sort()
        .join(',')
    const same = remote !== null && names(local) === names(remote)
    ok(
      same,
      '배포본 데이터가 최신 빌드와 같음',
      same
        ? Object.keys(local?.cells ?? {}).length + '칸 일치'
        : '격자 내용이 다릅니다 — 배포가 안 됐거나 실패했습니다',
    )
  }

  /* 5) 사이트맵의 모든 주소가 실제로 열리는지 */
  console.log('\n주소 전수 확인 (' + urls.length + '개)')
  const bad = []
  const noBeacon = []
  let good = 0
  for (let i = 0; i < urls.length; i += CONC) {
    await Promise.all(
      urls.slice(i, i + CONC).map(async (u) => {
        try {
          const r = await get(u)
          /*
           * 지역 페이지 자리에 SPA 폴백이 오면 200 이라도 실패다.
           * 파일이 사라졌는데 Cloudflare 가 index.html 을 대신 주는 상황을 잡는다.
           */
          const fallback = /JavaScript 가 필요합니다/.test(r.body) && !/무료 주차장/.test(r.body)
          if (r.status === 200 && (u === SITE + '/' || !fallback)) good++
          else bad.push(u.replace(SITE, '') + ' → ' + r.status + (fallback ? ' (SPA 폴백)' : ''))
          if (r.status === 200 && !/cloudflareinsights/.test(r.body)) noBeacon.push(u.replace(SITE, ''))
        } catch (e) {
          bad.push(u.replace(SITE, '') + ' → ' + String(e.message).slice(0, 40))
        }
      }),
    )
  }
  ok(bad.length === 0, good + '/' + urls.length + ' 정상 응답')
  for (const b of bad.slice(0, 10)) console.log('      ' + b)

  /*
   * 방문자 집계 스크립트가 빠진 페이지.
   *
   * 처음에 정적 페이지 272쪽에 전부 빠져 있어서 검색으로 들어온 방문이 한 명도 세지지
   * 않았다. 대시보드 숫자가 0 이면 유입이 없는 건지 집계가 안 되는 건지 구분할 수
   * 없으므로, 숫자를 믿기 전에 여기서 먼저 확인한다.
   */
  ok(
    noBeacon.length === 0,
    '방문자 집계 스크립트 ' + (urls.length - noBeacon.length) + '/' + urls.length + '쪽',
    noBeacon.length ? '빠짐 예: ' + decodeURIComponent(noBeacon[0]) : '',
  )

  console.log('\n' + (failed === 0 ? '모두 정상' : '문제 ' + failed + '건'))
  console.log('색인 여부는 여기서 알 수 없습니다 — Search Console·서치어드바이저에서 확인하세요.')
  process.exitCode = failed === 0 ? 0 : 1
}

main().catch((err) => {
  console.error('✗ 실패:', err.message)
  process.exit(1)
})
