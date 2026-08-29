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
import { readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const DEFAULT_DIST = 'dist'
const SITE = process.env.SITE_ORIGIN || 'https://parkatzero.pages.dev'

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

/** 데이터 기준일을 lastmod 로 쓴다. 없으면 오늘. */
async function referenceDate() {
  const idx = path.join('public', 'data', 'cell-index.json')
  if (existsSync(idx)) {
    try {
      const j = JSON.parse(await readFile(idx, 'utf-8'))
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(j.referenceDate))) return j.referenceDate
    } catch {
      /* 기본값으로 */
    }
  }
  return new Date().toISOString().slice(0, 10)
}

async function main() {
  const dist = process.argv[2] || DEFAULT_DIST
  if (!existsSync(dist)) throw new Error(dist + ' 이 없습니다. vite build 뒤에 실행하세요.')

  const lastmod = await referenceDate()
  const entries = [{ path: '/', lastmod, changefreq: 'daily', priority: '1.0' }]

  /*
   * 지역 페이지가 있으면 함께 싣는다. 2단계에서 build-region-pages 가 만들어 두는
   * 목록 파일을 읽는다. 아직 없으면 첫 페이지만 싣는다.
   */
  const listFile = path.join(dist, 'region-pages.json')
  if (existsSync(listFile)) {
    const pages = JSON.parse(await readFile(listFile, 'utf-8'))
    for (const p of pages) entries.push({ path: p.path, lastmod, changefreq: 'weekly', priority: p.priority ?? '0.7' })
    // 목록은 사이트맵을 만들려고 주고받는 쪽지다. 배포물에 남길 이유가 없다.
    await rm(listFile, { force: true })
  }

  const xml = buildSitemap(entries)
  await writeFile(path.join(dist, 'sitemap.xml'), xml, 'utf-8')
  console.log('sitemap.xml: ' + entries.length + '개 주소 (lastmod ' + lastmod + ')')
}

if (process.argv[1] && process.argv[1].includes('build-sitemap')) {
  main().catch((err) => {
    console.error('✗ 실패:', err.message)
    process.exit(1)
  })
}
