import { expect, test } from '@playwright/test'
import { blockExternal } from './helpers'

/**
 * 개발 서버 전용 스모크 (`npm run dev` 를 켜 둔 상태에서 `npm run test:dev`).
 *
 * 프로덕션 빌드에는 React StrictMode 의 이펙트 이중 실행이 없다.
 * 그래서 "마운트 → 정리 → 재마운트" 에서만 드러나는 결함 —
 * 정리 단계의 abort() 로 취소된 요청이 재시도되지 않아 목록이 영영 비는 문제 같은 것 —
 * 은 기본 E2E 로는 절대 잡히지 않는다. 이 파일이 그 사각지대를 덮는다.
 *
 * CI 에서는 돌지 않는다(서버를 띄우지 않으므로). 로컬에서 UI 를 만지기 전 한 번 돌리면 된다.
 */
test.describe('개발 서버 스모크', () => {
  // dev 서버가 꺼져 있으면 실패가 아니라 건너뛴다 — 이 스펙은 개발 중 보조 수단이다.
  test.beforeAll(async ({ browserName }, testInfo) => {
    void browserName
    const url = testInfo.project.use.baseURL
    try {
      await fetch(url as string, { signal: AbortSignal.timeout(2000) })
    } catch {
      test.skip(true, 'dev 서버가 없습니다. `npm run dev` 를 먼저 실행하세요.')
    }
  })

  test('StrictMode 이중 마운트 후에도 목록·지도·요약이 모두 살아 있다', async ({ page }) => {
    const problems: string[] = []
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
    page.on('console', (m) => {
      if (m.type() !== 'error') return
      const text = m.text()
      // 타일/광고 차단으로 생기는 네트워크 오류는 의도된 것이라 걸러낸다.
      if (/ERR_FAILED|Failed to fetch|Failed to load resource/i.test(text)) return
      problems.push('console: ' + text.slice(0, 200))
    })

    await blockExternal(page)
    await page.goto('/')

    // ① 데이터가 실제로 도착했는가 (이중 마운트로 요청이 유실되면 여기서 걸린다)
    await expect(page.getByTestId('parking-card').first()).toBeVisible({ timeout: 20_000 })
    expect(await page.getByTestId('parking-card').count()).toBeGreaterThan(3)

    // ② 지도와 마커도 이중 마운트를 견뎠는가
    await expect(page.getByTestId('map')).toBeVisible()
    await expect(page.getByTestId('map-marker').first()).toBeVisible({ timeout: 20_000 })

    // ③ 요약·스켈레톤 상태가 정상 종료됐는가
    await expect(page.getByTestId('result-count')).toBeVisible()
    await expect(page.getByTestId('skeleton-card')).toHaveCount(0)
    await expect(page.getByTestId('empty-state')).toHaveCount(0)

    expect(problems, '개발 모드 콘솔 오류').toEqual([])
  })

  test('상호작용 한 바퀴가 개발 모드에서도 동작한다', async ({ page }) => {
    await blockExternal(page)
    await page.goto('/')
    await expect(page.getByTestId('parking-card').first()).toBeVisible({ timeout: 20_000 })

    await page.getByTestId('parking-card').first().click()
    await expect(page.getByTestId('detail-panel')).toBeVisible()
    await expect(page.getByTestId('navi-kakao')).toBeVisible()
    await page.getByTestId('detail-close').click()

    await page.getByTestId('theme-toggle').click()
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBeDefined()

    await page.getByTestId('filter-free').click()
    const statuses = await page
      .getByTestId('parking-card')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-status')))
    for (const s of statuses) expect(s).toBe('free')
  })
})
