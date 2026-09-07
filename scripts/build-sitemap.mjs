#!/usr/bin/env node
/**
 * sitemap.xml 을 만든다.
 *
 * robots.txt 가 /sitemap.xml 을 가리키는데 그 파일이 없었다. Cloudflare Pages 는
 * 없는 경로에 SPA 폴백(index.html)을 돌려주므로 200 + HTML 이 나가고, 크롤러는
 * XML 인 줄 알고 받았다가 파싱에 실패한다. 404 보다 나쁘다 — 사이트맵이 있는 줄 알고
 * 계속 다시 받아 가기 때문이다.
 *
 * vite build 가 dist 를 비우므로 반드시 그 뒤에 돌려야 한다.
 *
 * 사용: node scripts/build-sitemap.mjs [dist경로]
 */
import path from 'node:path'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'

const DEFAULT_DIST = 'dist'
const SITE = process.env.SITE_ORIGIN || 'https://parkatzero.pages.dev'

/**
 * 페이지마다 마지막으로 내용이 바뀐 날을 적어 두는 곳.
 *
 * 저장소에 커밋해서 다음 빌드가 이어받는다. 없으면 전부 오늘로 잡히는데,
 * 그래도 틀린 날짜를 적는 것보다는 낫다.
 */
const STATE_FILE = path.join('scripts', 'data', 'page-lastmod.json')

const xmlEscape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c])

/** 경로의 한글을 URL 로 안전하게 바꾼다. 이미 인코딩된 것은 건드리지 않는다. */
export function toUrl(origin, p) {
  const encoded = p
    .split('/')
    .map((seg) => (seg && !/%[0-9A-Fa-f]{2}/.test(seg) ? encodeURIComponent(seg) : seg))
    .join('/')
  return origin.replace(/\/$/, '') + encoded
}

/** { path, lastmod?, changefreq?, priority? } 목록 → sitemap XML */
export function buildSitemap(entries, origin = SITE) {
  const body = entries
    .map((e) => {
      const parts = ['    <loc>' + xmlEscape(toUrl(origin, e.path)) + '</loc>']
      if (e.lastmod) parts.push('    <lastmod>' + e.lastmod + '</lastmod>')
      if (e.changefreq) parts.push('    <changefreq>' + e.changefreq + '</changefreq>')
      if (e.priority) parts.push('    <priority>' + e.priority + '</priority>')
      return '  <url>\n' + parts.join('\n') + '\n  </url>'
    })
    .join('\n')
  const ns = 'http://www.sitemaps.org/schemas/sitemap/0.9'
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="' + ns + '">\n' + body + '\n</urlset>\n'
}

/**
 * 오늘 날짜. toISOString 은 UTC 라 한국 기준 밤 9시 이후에 하루가 밀린다.
 * 빌드는 TZ=Asia/Seoul 로 돈다(deploy.yml). 실행 환경의 날짜를 그대로 쓴다.
 */
function today(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate())
}

/**
 * 내용 비교에서 번들 파일명의 해시를 지운다.
 *
 * 홈은 /assets/index-C9lZ94BB.js 처럼 해시가 박힌 파일명을 참조한다. 이 해시는 빌드
 * 환경에 따라 달라져서, 첫 배포에서 정적 페이지 272쪽은 모두 그대로였는데 홈만 날짜가
 * 올라갔다. 사람이 보는 내용은 하나도 안 바뀌었는데 매 배포마다 <오늘 바뀜>이 된다.
 * 파일명에서 해시 부분만 빼고 비교한다 — 번들 내용이 정말 바뀌면 그건 앱이 바뀐
 * 것이고, 그때는 홈 HTML 의 다른 곳(주입된 소개문·집계 숫자)도 함께 바뀐다.
 */
const normalize = (html) => html.replace(/\/assets\/([\w.-]+?)-[A-Za-z0-9_-]{8,}\.(js|css)/g, '/assets/$1.$2')

/**
 * 페이지가 <실제로 바뀐 날> 을 lastmod 로 채운다.
 *
 * 예전에는 데이터 기준일(2026-08-04)을 273개 주소에 그대로 붙였다. 그날 새로 만든
 * 페이지조차 한 달 전에 마지막으로 바뀌었다고 알리는 셈이라 사실과 달랐다. lastmod 가
 * 믿을 수 없으면 검색엔진은 그 값을 통째로 무시한다.
 *
 * 그래서 만들어진 HTML 의 내용 해시를 저장해 두고, 해시가 그대로면 예전 날짜를
 * 유지하고 달라졌을 때만 오늘로 올린다. 지역·상황 페이지는 인라인 CSS 로 자족적이라
 * 자산 파일명 해시를 참조하지 않는다 — 데이터와 생성기가 그대로면 바이트까지 같다.
 * (홈은 번들 파일명을 참조하므로 코드가 바뀌면 함께 올라간다. 그건 실제로 바뀐 게 맞다.)
 */
async function resolveLastmod(dist, entries, stamp, complete) {
  let prev = {}
  if (existsSync(STATE_FILE)) {
    try {
      prev = JSON.parse(await readFile(STATE_FILE, 'utf-8'))
    } catch {
      /* 못 읽으면 전부 오늘로 */
    }
  }

  const next = {}
  let changed = 0
  for (const e of entries) {
    const file = path.join(dist, ...e.path.split('/').filter(Boolean), 'index.html')
    let hash = ''
    if (existsSync(file)) hash = createHash('sha256').update(normalize(await readFile(file, 'utf-8'))).digest('hex').slice(0, 16)

    const before = prev[e.path]
    if (before && before.hash === hash && /^\d{4}-\d{2}-\d{2}$/.test(String(before.lastmod))) {
      e.lastmod = before.lastmod
    } else {
      e.lastmod = stamp
      changed++
    }
    next[e.path] = { hash, lastmod: e.lastmod }
  }

  /*
   * 지역 페이지 목록이 없는 부분 빌드에서는 기준선을 건드리지 않는다.
   *
   * build-sitemap 을 단독으로 돌리면 entries 가 홈 하나뿐이라, 그대로 쓰면 273개짜리
   * 기준선이 1개로 덮어써진다. 그러면 다음 빌드가 272개를 <처음 보는 페이지>로 여겨
   * 전부 오늘 바뀐 것으로 표시한다. 실제로 한 번 당했다.
   */
  if (complete) {
    await mkdir(path.dirname(STATE_FILE), { recursive: true })
    await writeFile(STATE_FILE, JSON.stringify(next, null, 1) + '\n', 'utf-8')
  } else {
    console.log('  · 부분 빌드라 page-lastmod.json 은 그대로 둡니다')
  }

  /*
   * 기준선이 있는데 하나도 안 맞으면 내용이 정말 다 바뀐 게 아니라 빌드 환경이
   * 다른 것이다(예: Node 판이 달라 숫자 표기가 달라짐). 그대로 두면 배포할 때마다
   * 273개 전부 "오늘 바뀜"이라고 알리게 되고, 그러면 lastmod 를 아예 안 쓰느니만
   * 못하다. 조용히 지나가지 않고 알린다.
   */
  const hadBaseline = Object.keys(prev).length > 0
  if (hadBaseline && changed === entries.length && entries.length > 1) {
    console.warn(
      '  ! 기준선이 있는데 ' + changed + '개가 모두 바뀐 것으로 잡혔습니다.\n' +
        '    빌드 환경이 달라 해시가 어긋났을 수 있습니다. scripts/data/page-lastmod.json 을\n' +
        '    같은 환경에서 다시 만들어 커밋하세요.',
    )
  }
  return changed
}

async function main() {
  const dist = process.argv[2] || DEFAULT_DIST
  if (!existsSync(dist)) throw new Error(dist + ' 이 없습니다. vite build 뒤에 실행하세요.')

  const entries = [{ path: '/', changefreq: 'daily', priority: '1.0' }]

  /*
   * 지역 페이지가 있으면 함께 싣는다. 2단계에서 build-region-pages 가 만들어 두는
   * 목록 파일을 읽는다. 아직 없으면 첫 페이지만 싣는다.
   */
  const listFile = path.join(dist, 'region-pages.json')
  const complete = existsSync(listFile)
  if (complete) {
    const pages = JSON.parse(await readFile(listFile, 'utf-8'))
    for (const p of pages) entries.push({ path: p.path, changefreq: 'weekly', priority: p.priority ?? '0.7' })
    // 목록은 사이트맵을 만들려고 주고받는 쪽지다. 배포물에 남길 이유가 없다.
    await rm(listFile, { force: true })
  }

  const stamp = today()
  const changed = await resolveLastmod(dist, entries, stamp, complete)

  const xml = buildSitemap(entries)
  await writeFile(path.join(dist, 'sitemap.xml'), xml, 'utf-8')
  console.log(
    'sitemap.xml: ' + entries.length + '개 주소 · ' +
      (changed === 0 ? '바뀐 내용 없음 (lastmod 유지)' : '바뀐 ' + changed + '개에 lastmod ' + stamp),
  )
}

if (process.argv[1] && process.argv[1].includes('build-sitemap')) {
  main().catch((err) => {
    console.error('✗ 실패:', err.message)
    process.exit(1)
  })
}
