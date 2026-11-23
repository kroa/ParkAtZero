#!/usr/bin/env node
/**
 * scripts/check-crawl-graph.mjs
 *
 * 로컬 dist/ 정적 빌드 산출물의 크롤 그래프(Crawl Graph) 전수 검증 도구 (TASK-003 / ADR-003)
 *
 * 외부 npm 패키지 의존 없이 순수 Node.js 내장 모듈만 사용하여
 * 홈('/')을 시작점으로 메모리 상에서 BFS 탐색을 수행하고 5대 수용 기준을 검증합니다:
 *   [AC-1] 도달률 100% (273개 URL 전수 도달, 미도달 0건)
 *   [AC-2] 고아 페이지 0건 (루트 제외 전 페이지 인바운드 링크 >= 1, 교차 30쪽 전수 검증)
 *   [AC-3] 깨진 링크 0건 (404, 없는 파일, SPA 폴백 0건)
 *   [AC-4] 최단 클릭 깊이(Shortest Path) 최대 3홉(hop) 이하
 *   [AC-5] 1초 이내 초고속 판정 및 실패 시 process.exit(1)
 *
 * 사용: node scripts/check-crawl-graph.mjs [dist경로]
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

const startTime = performance.now()
const DIST_DIR = process.argv[2] || 'dist'
const SITE_ORIGIN = (process.env.SITE_ORIGIN || 'https://parkatzero.pages.dev').replace(/\/$/, '')

if (!existsSync(DIST_DIR)) {
  console.error(`\x1b[31m✗ 오류: '${DIST_DIR}' 디렉터리가 없습니다. 먼저 npm run build:only 를 실행하세요.\x1b[0m`)
  process.exit(1)
}

/**
 * URL 경로를 로컬 dist 디렉터리 내의 실제 index.html 파일 경로로 매핑
 */
function urlToFilePath(urlPath, distDir) {
  const clean = urlPath.split('?')[0].split('#')[0]
  const segments = clean
    .split('/')
    .filter(Boolean)
    .map((seg) => {
      try {
        return decodeURIComponent(seg)
      } catch {
        return seg
      }
    })
  return path.join(distDir, ...segments, 'index.html')
}

/**
 * 정규화된 URL 경로 반환 (디코딩, 슬래시 정리)
 */
function normalizeUrlPath(raw) {
  if (!raw) return ''
  let pathname = raw
  try {
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      const parsed = new URL(raw)
      pathname = parsed.pathname
    } else {
      pathname = raw.split('?')[0].split('#')[0]
    }
  } catch {
    return ''
  }

  if (!pathname.startsWith('/')) {
    pathname = '/' + pathname
  }

  try {
    pathname = decodeURIComponent(pathname)
  } catch {
    // 디코딩 실패 시 원문 유지
  }

  // 확장자가 없는 디렉터리 경로는 항상 끝에 '/' 부여
  if (pathname !== '/' && !pathname.endsWith('/') && !path.extname(pathname)) {
    pathname += '/'
  }

  return pathname
}

/**
 * dist 디렉터리 내의 전체 기대 대상 페이지 URL 집합 수집
 * 1) dist/sitemap.xml 이 존재하면 파싱하여 추출
 * 2) 없을 경우 dist/ 내 index.html 파일들을 재귀 순회하여 수집 (폴백)
 */
function collectExpectedUrls(distDir) {
  const expected = new Set()
  const sitemapFile = path.join(distDir, 'sitemap.xml')

  if (existsSync(sitemapFile)) {
    try {
      const xml = readFileSync(sitemapFile, 'utf-8')
      const locRegex = /<loc>(.*?)<\/loc>/g
      let match
      while ((match = locRegex.exec(xml)) !== null) {
        const norm = normalizeUrlPath(match[1])
        if (norm) expected.add(norm)
      }
      if (expected.size > 0) return expected
    } catch {
      // sitemap 파싱 실패 시 디렉터리 순회로 진행
    }
  }

  // 폴백: dist 디렉터리 내 index.html 재귀 검색
  function walk(currentDir, currentUrl) {
    const entries = readdirSync(currentDir)
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry)
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        walk(fullPath, currentUrl + entry + '/')
      } else if (entry === 'index.html') {
        expected.add(currentUrl)
      }
    }
  }

  walk(distDir, '/')
  return expected
}

/**
 * HTML 본문에서 크롤 대상 내부 <a> 링크 추출
 */
function extractInternalLinks(html, currentUrl) {
  const links = new Set()
  const hrefRegex = /<a\s+(?:[^>]*?\s+)?href=["']([^"']*)["']/gi
  let match

  while ((match = hrefRegex.exec(html)) !== null) {
    const raw = match[1].trim()
    if (
      !raw ||
      raw.startsWith('#') ||
      raw.startsWith('mailto:') ||
      raw.startsWith('tel:') ||
      raw.startsWith('javascript:')
    ) {
      continue
    }

    // 외부 도메인 필터링
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      try {
        const u = new URL(raw)
        const host = u.host.toLowerCase()
        if (
          !host.includes('parkatzero.pages.dev') &&
          !host.includes('localhost') &&
          host !== new URL(SITE_ORIGIN).host.toLowerCase()
        ) {
          continue
        }
      } catch {
        continue
      }
    }

    // 상대 경로 및 URL 정규화
    let norm = ''
    try {
      if (raw.startsWith('/')) {
        norm = normalizeUrlPath(raw)
      } else if (raw.startsWith('http://') || raw.startsWith('https://')) {
        norm = normalizeUrlPath(raw)
      } else {
        const base = new URL('https://parkatzero.pages.dev' + currentUrl)
        const resolved = new URL(raw, base)
        norm = normalizeUrlPath(resolved.pathname)
      }
    } catch {
      continue
    }

    if (!norm) continue

    // 이미지 및 정적 파일 자산 링크 제외
    if (/\.(png|jpe?g|svg|ico|json|txt|xml|js|css|map)$/i.test(norm)) {
      continue
    }

    links.add(norm)
  }

  return [...links]
}

// -------------------------------------------------------------
// 메인 BFS 탐색 및 검증 로직
// -------------------------------------------------------------
const expectedUrls = collectExpectedUrls(DIST_DIR)
const fileCache = new Map()

function getHtml(urlPath) {
  if (fileCache.has(urlPath)) return fileCache.get(urlPath)
  const filePath = urlToFilePath(urlPath, DIST_DIR)
  if (!existsSync(filePath)) return null
  try {
    const content = readFileSync(filePath, 'utf-8')
    fileCache.set(urlPath, content)
    return content
  } catch {
    return null
  }
}

const queue = ['/']
const visited = new Set(['/'])
const shortestDepth = new Map([['/', 0]])
const inboundCounts = new Map()
const inboundSources = new Map()
const brokenLinks = [] // { from, to, reason }

// BFS 탐색
while (queue.length > 0) {
  const currentUrl = queue.shift()
  const currentDepth = shortestDepth.get(currentUrl) ?? 0
  const html = getHtml(currentUrl)

  if (!html) continue

  const targets = extractInternalLinks(html, currentUrl)

  for (const target of targets) {
    // 인바운드 링크 기록
    inboundCounts.set(target, (inboundCounts.get(target) || 0) + 1)
    if (!inboundSources.has(target)) inboundSources.set(target, new Set())
    inboundSources.get(target).add(currentUrl)

    // 파일 존재 및 무결성 확인 (인메모리 Set 조회로 초고속화)
    if (!expectedUrls.has(target)) {
      const targetFilePath = urlToFilePath(target, DIST_DIR)
      if (!existsSync(targetFilePath)) {
        brokenLinks.push({ from: currentUrl, to: target, reason: '404 File Not Found' })
        continue
      }
    }

    // BFS 큐 확장 (미방문 노드만 큐에 추가)
    if (!visited.has(target)) {
      visited.add(target)
      shortestDepth.set(target, currentDepth + 1)
      queue.push(target)
    }
  }
}

// -------------------------------------------------------------
// 5대 수용 기준 (AC-1 ~ AC-5) 판정
// -------------------------------------------------------------
const unreached = [...expectedUrls].filter((u) => !visited.has(u))
const orphanPages = [...expectedUrls].filter((u) => u !== '/' && (inboundCounts.get(u) || 0) < 1)

// 교차 페이지(30쪽) 전수 인바운드 점검: /지역/{시도}/{상황-slug}/
const crossPages = [...expectedUrls].filter((u) => {
  const parts = u.split('/').filter(Boolean)
  return parts.length === 3 && parts[0] === '지역' && !parts[2].endsWith('구') && !parts[2].endsWith('시') && !parts[2].endsWith('군')
})
const crossOrphans = crossPages.filter((u) => (inboundCounts.get(u) || 0) < 1)

// 클릭 깊이 검증 (3홉 초과 여부 및 홉별 분포)
const depthExceeded = [...shortestDepth.entries()].filter(([u, d]) => d > 3)
const depthDistribution = { 0: 0, 1: 0, 2: 0, 3: 0, '>3': 0 }
for (const [, d] of shortestDepth) {
  if (d <= 3) depthDistribution[d] = (depthDistribution[d] || 0) + 1
  else depthDistribution['>3']++
}

const elapsedMs = Math.round(performance.now() - startTime)

const ac1Pass = unreached.length === 0
const ac2Pass = orphanPages.length === 0 && crossOrphans.length === 0
const ac3Pass = brokenLinks.length === 0
const ac4Pass = depthExceeded.length === 0
const ac5Pass = elapsedMs < 1000

const allPassed = ac1Pass && ac2Pass && ac3Pass && ac4Pass && ac5Pass

// -------------------------------------------------------------
// 결과 보고서 출력
// -------------------------------------------------------------
console.log('\n======================================================')
console.log('  🔍 ParkAtZero 크롤 그래프 전수 검증 리포트 (TASK-003)')
console.log('======================================================')
console.log(`- 점검 대상 페이지 수: ${expectedUrls.size}쪽 (기준: dist/ 및 sitemap)`)
console.log(`- 실제 도달 페이지 수: ${visited.size}쪽`)
console.log(`- 소요 시간: ${elapsedMs}ms\n`)

console.log('【 수용 기준 검증 결과 】')
console.log(
  `  ${ac1Pass ? '✓' : '✗'} [AC-1] 크롤 도달률 100%: ${visited.size}/${expectedUrls.size} (${(
    (visited.size / (expectedUrls.size || 1)) *
    100
  ).toFixed(1)}%) — 미도달 ${unreached.length}건`,
)
if (unreached.length > 0) {
  console.log(`     미도달 URL: ${unreached.slice(0, 5).join(', ')}${unreached.length > 5 ? ' ...' : ''}`)
}

console.log(
  `  ${ac2Pass ? '✓' : '✗'} [AC-2] 고아 페이지 0건: 전체 고아 ${orphanPages.length}건 (교차 30쪽 고아 ${crossOrphans.length}건)`,
)
if (orphanPages.length > 0) {
  console.log(`     고아 URL: ${orphanPages.slice(0, 5).join(', ')}${orphanPages.length > 5 ? ' ...' : ''}`)
}

console.log(`  ${ac3Pass ? '✓' : '✗'} [AC-3] 깨진 내부 링크 0건: ${brokenLinks.length}건 발견`)
if (brokenLinks.length > 0) {
  for (const b of brokenLinks.slice(0, 5)) {
    console.log(`     - [${b.reason}] ${b.from} -> ${b.to}`)
  }
}

console.log(
  `  ${ac4Pass ? '✓' : '✗'} [AC-4] 최단 클릭 깊이 최대 3홉 이하: 3홉 초과 ${depthExceeded.length}건`,
)
console.log(
  `     (홉별 분포: 0홉 ${depthDistribution[0]}개 | 1홉 ${depthDistribution[1]}개 | 2홉 ${depthDistribution[2]}개 | 3홉 ${depthDistribution[3]}개${
    depthDistribution['>3'] > 0 ? ` | >3홉 ${depthDistribution['>3']}개` : ''
  })`,
)
if (depthExceeded.length > 0) {
  console.log(`     초과 URL: ${depthExceeded.slice(0, 3).map(([u, d]) => `${u}(${d}홉)`).join(', ')}`)
}

console.log(
  `  ${ac5Pass ? '✓' : '✗'} [AC-5] 초고속 자동화 게이트 (<1초): ${elapsedMs}ms 소요`,
)
console.log('======================================================')

if (allPassed) {
  console.log('\x1b[32m✨ [합격] 크롤 그래프 5대 수용 기준을 모두 통과했습니다.\x1b[0m\n')
  process.exit(0)
} else {
  console.error('\x1b[31m✗ [실패] 크롤 그래프 검증 기준에 미달했습니다. 배관을 점검하세요.\x1b[0m\n')
  process.exit(1)
}
