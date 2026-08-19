import { expect, test, type Page } from '@playwright/test'
import { DATES, blockExternal, cardByName, gotoApp, setVisit, widenRadius } from './helpers'

/* ═══════════════════════════════════════════════════════════════
 *  1. Local-First 초기 로딩
 * ═══════════════════════════════════════════════════════════════ */
test.describe('초기 로딩 · Local-First', () => {
  test('외부 네트워크가 전부 막혀 있어도 목록과 지도가 뜬다', async ({ page }) => {
    await blockExternal(page)
    await page.goto('/')

    // 스켈레톤 → 실제 카드
    await expect(page.getByTestId('parking-card').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('skeleton-card')).toHaveCount(0)

    await expect(page.getByTestId('map')).toBeVisible()
    await expect(page.getByTestId('result-count')).toBeVisible()

    const count = await page.getByTestId('parking-card').count()
    expect(count).toBeGreaterThan(3)
  })

  test('두 번째 방문은 로컬 캐시에서 즉시 복원된다', async ({ page }) => {
    await gotoApp(page)

    const cached = await page.evaluate(() => localStorage.getItem('pz.parkings.v1'))
    expect(cached).toBeTruthy()
    expect(JSON.parse(cached as string).parkings.length).toBeGreaterThan(10)

    // 시드 JSON 요청까지 막아도 캐시만으로 살아나야 한다.
    await page.route('**/data/parkings.sample.json', (r) => r.abort())
    await page.reload()
    await expect(page.getByTestId('parking-card').first()).toBeVisible()
  })

  test('예시 데이터로 동작할 때는 그 사실이 화면에 드러난다', async ({ page }) => {
    // 시연용으로 지어낸 요금을 공공데이터인 것처럼 보여주면 사용자가 그대로 믿고 차를 몬다.
    await gotoApp(page)

    await expect(page.getByTestId('sample-notice')).toBeVisible()
    await expect(page.getByTestId('sample-notice')).toContainText('예시 데이터')

    await page.getByTestId('parking-card').first().click()
    const panel = page.getByTestId('detail-panel')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('예시 데이터입니다')
    // 예시 데이터에 공공데이터포털 출처를 달면 안 된다.
    await expect(panel).not.toContainText('데이터 기준일')
  })

  test('주차장마다 상태 뱃지가 하나씩 붙는다', async ({ page }) => {
    await gotoApp(page)

    const first = page.getByTestId('parking-card').first()
    const badge = first.getByTestId('status-badge')
    await expect(badge).toBeVisible()

    const status = await first.getAttribute('data-status')
    expect(['free', 'conditional', 'paid', 'closed', 'unknown']).toContain(status)
  })
})

/* ═══════════════════════════════════════════════════════════════
 *  2. 방문 시간대별 무료 판별 — 이 앱의 핵심 기능
 * ═══════════════════════════════════════════════════════════════ */
test.describe('시간대별 무료 판별', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
    await widenRadius(page)
  })

  test('평일 낮에는 유료, 저녁 19시 이후에는 무료로 바뀐다 (마포구청)', async ({ page }) => {
    await setVisit(page, DATES.weekday, '14:00', 120)
    await expect(await cardByName(page, '마포구청')).toHaveAttribute('data-status', 'paid')

    await setVisit(page, DATES.weekday, '20:00', 120)
    await expect(await cardByName(page, '마포구청')).toHaveAttribute('data-status', 'free')
  })

  test('공휴일 무료 주차장은 추석 당일에 초록으로 바뀐다 (강남구청)', async ({ page }) => {
    await setVisit(page, DATES.weekday, '14:00', 120)
    await expect(await cardByName(page, '강남구청')).toHaveAttribute('data-status', 'paid')

    await setVisit(page, DATES.holiday, '14:00', 120)
    await expect(await cardByName(page, '강남구청')).toHaveAttribute('data-status', 'free')
  })

  test('주말 무료 주차장은 토요일에만 초록이다 (이태원)', async ({ page }) => {
    await setVisit(page, DATES.weekday, '14:00', 120)
    await expect(await cardByName(page, '이태원')).toHaveAttribute('data-status', 'paid')

    await setVisit(page, DATES.saturday, '14:00', 120)
    await expect(await cardByName(page, '이태원')).toHaveAttribute('data-status', 'free')
  })

  test('주차 시간을 늘리면 무료가 조건부로 내려간다 (여의도한강공원)', async ({ page }) => {
    await setVisit(page, DATES.weekday, '14:00', 30)
    const card = await cardByName(page, '여의도한강공원')
    await expect(card).toHaveAttribute('data-status', 'conditional')
    await expect(card.getByTestId('card-cost')).toHaveText('0원')

    await setVisit(page, DATES.weekday, '14:00', 120)
    await expect(card).toHaveAttribute('data-status', 'conditional')
    await expect(card.getByTestId('card-cost')).toHaveText('2,700원')
  })

  test('운영시간 밖이면 회색 "운영 종료"로 표시된다 (강남구청 평일 23시)', async ({ page }) => {
    await setVisit(page, DATES.weekday, '23:00', 120)
    await expect(await cardByName(page, '강남구청')).toHaveAttribute('data-status', 'closed')
  })

  test('방문 시각을 바꾸면 무료 개수 요약이 함께 갱신된다', async ({ page }) => {
    await setVisit(page, DATES.weekday, '14:00', 120)
    const dayText = await page.getByTestId('result-count').innerText()

    await setVisit(page, DATES.weekday, '21:00', 120)
    const nightText = await page.getByTestId('result-count').innerText()

    expect(nightText).not.toEqual(dayText)

    const freeAtNight = Number(nightText.match(/^(\d+)/)?.[1] ?? 0)
    const freeAtDay = Number(dayText.match(/^(\d+)/)?.[1] ?? 0)
    // 야간·심야 무료 주차장이 여럿이라 밤에 무료가 더 많아야 한다.
    expect(freeAtNight).toBeGreaterThan(freeAtDay)
  })
})

/* ═══════════════════════════════════════════════════════════════
 *  3. 검색
 * ═══════════════════════════════════════════════════════════════ */
test.describe('검색', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
  })

  test('지역명을 입력하면 자동완성이 뜨고 선택 시 지도가 이동한다', async ({ page }) => {
    await page.getByTestId('search-input').fill('홍대')

    const suggestions = page.getByTestId('search-suggestions')
    await expect(suggestions).toBeVisible()

    const landmark = page.getByTestId('suggestion-item').filter({ hasText: '홍대입구역' }).first()
    await expect(landmark).toBeVisible()
    await landmark.click()

    await expect(suggestions).toBeHidden()
    await expect(page.getByTestId('parking-card').first()).toBeVisible()
  })

  test('주차장 이름으로 목록이 좁혀진다', async ({ page }) => {
    await widenRadius(page)
    await page.getByTestId('search-input').fill('여의도')

    // 검색어는 디바운스를 거치므로 '모든 카드가 걸러진 상태'가 될 때까지 기다린다.
    // 입력 직후 스냅샷을 찍으면 필터 적용 전 목록을 보게 된다.
    await expect
      .poll(async () => {
        const names = await page.getByTestId('card-name').allInnerTexts()
        return names.length > 0 && names.every((n) => n.includes('여의도'))
      })
      .toBe(true)
  })

  test('검색 결과가 없으면 빈 상태와 초기화 버튼이 나온다', async ({ page }) => {
    await page.getByTestId('search-input').fill('존재하지않는주차장이름zzz')
    await expect(page.getByTestId('empty-state')).toBeVisible()

    await page.getByTestId('reset-filters').click()
    await expect(page.getByTestId('parking-card').first()).toBeVisible()
  })

  test('검색어 지우기 버튼이 동작한다', async ({ page }) => {
    const input = page.getByTestId('search-input')
    await input.fill('강남')
    await page.getByTestId('search-clear').click()
    await expect(input).toHaveValue('')
  })
})

/* ═══════════════════════════════════════════════════════════════
 *  4. 필터
 * ═══════════════════════════════════════════════════════════════ */
test.describe('필터', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
    await widenRadius(page)
    await setVisit(page, DATES.weekday, '14:00', 120)
  })

  test('"0원만" 필터를 켜면 초록 카드만 남는다', async ({ page }) => {
    await page.getByTestId('filter-free').click()

    const cards = page.getByTestId('parking-card')
    await expect(cards.first()).toBeVisible()

    const statuses = await cards.evaluateAll((els) => els.map((el) => el.getAttribute('data-status')))
    expect(statuses.length).toBeGreaterThan(0)
    expect(new Set(statuses)).toEqual(new Set(['free']))
  })

  test('"조건부 포함" 필터는 초록과 주황만 남긴다', async ({ page }) => {
    await page.getByTestId('filter-conditional').click()

    const cards = page.getByTestId('parking-card')
    await expect(cards.first()).toBeVisible()

    const statuses = await cards.evaluateAll((els) => els.map((el) => el.getAttribute('data-status')))
    for (const s of statuses) expect(['free', 'conditional']).toContain(s)
    expect(statuses).toContain('conditional')
  })

  test('반경을 좁히면 결과 수가 줄어든다', async ({ page }) => {
    // 목록은 스크롤에 따라 점진적으로 그려지므로 DOM 카드 수로 세면 안 된다.
    // 요약 줄의 총 개수를 본다.
    const total = async () => {
      const text = await page.getByTestId('result-count').innerText()
      return Number(text.match(/\/\s*(\d+)\s*곳/)?.[1] ?? -1)
    }
    const wide = await total()
    expect(wide).toBeGreaterThan(0)

    await page.getByTestId('filter-radius').selectOption('1')
    await expect.poll(total).toBeLessThan(wide)
  })

  test('요금순 정렬은 가장 싼 곳을 맨 위에 둔다', async ({ page }) => {
    await page.getByTestId('filter-sort').selectOption('cost')
    await expect(page.getByTestId('parking-card').first()).toBeVisible()
    await expect(page.getByTestId('parking-card').first().getByTestId('card-cost')).toHaveText('0원')
  })
})

/* ═══════════════════════════════════════════════════════════════
 *  5. 카드 선택 · 상세 · 1-Tap 길안내
 * ═══════════════════════════════════════════════════════════════ */
test.describe('상세 패널과 길안내', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
    await widenRadius(page)
    await setVisit(page, DATES.weekday, '14:00', 120)
  })

  test('카드를 누르면 선택 표시가 붙고 상세 패널이 열린다', async ({ page }) => {
    const card = page.getByTestId('parking-card').first()
    const name = await card.getByTestId('card-name').innerText()

    await card.click()

    await expect(page.getByTestId('detail-panel')).toBeVisible()
    await expect(page.getByTestId('detail-panel')).toContainText(name)
    await expect(page.getByTestId('detail-cost')).toBeVisible()
    await expect(page.getByTestId('detail-reasons')).toBeVisible()
  })

  test('상세 패널에 4개 길안내 앱 링크가 모두 있고 좌표가 정확하다', async ({ page }) => {
    await (await cardByName(page, '서울광장')).click()
    const panel = page.getByTestId('detail-panel')
    await expect(panel).toBeVisible()

    const kakao = await page.getByTestId('navi-kakao').getAttribute('href')
    const naver = await page.getByTestId('navi-naver').getAttribute('href')
    const tmap = await page.getByTestId('navi-tmap').getAttribute('href')
    const google = await page.getByTestId('navi-google').getAttribute('href')

    expect(kakao).toContain('map.kakao.com/link/to/')
    expect(kakao).toContain('37.5663')
    expect(naver).toContain('map.naver.com')
    expect(naver).toContain('126.9779')
    expect(tmap).toContain('goalx=126.9779')
    expect(google).toContain('google.com/maps/dir/')
    expect(google).toContain('destination=37.5663,126.9779')
    expect(google).toContain('travelmode=driving')
  })

  test('카드를 눌러도 거리 기준점과 결과 목록은 그대로다', async ({ page }) => {
    // 지도만 이동해야 한다. 기준점까지 함께 옮기면 모든 거리가 0m 이 되고
    // 반경 안에 드는 주차장 목록까지 통째로 바뀐다.
    const card = page.getByTestId('parking-card').first()
    const distanceBefore = await card.innerText()
    const countBefore = await page.getByTestId('result-count').innerText()

    await card.click()
    await expect(page.getByTestId('detail-panel')).toBeVisible()

    expect(await page.getByTestId('parking-card').first().innerText()).toEqual(distanceBefore)
    expect(await page.getByTestId('result-count').innerText()).toEqual(countBefore)
    await expect(page.getByTestId('detail-panel')).not.toContainText('· 0m ·')
  })

  test('상세 패널을 닫으면 선택이 해제된다', async ({ page }) => {
    await page.getByTestId('parking-card').first().click()
    await expect(page.getByTestId('detail-panel')).toBeVisible()

    await page.getByTestId('detail-close').click()
    await expect(page.getByTestId('detail-panel')).toBeHidden()
  })

  test('운영시간·요금 체계가 상세에 표기된다', async ({ page }) => {
    await (await cardByName(page, '서울광장')).click()
    const panel = page.getByTestId('detail-panel')

    await expect(panel).toContainText('운영시간')
    await expect(panel).toContainText('07:00 ~ 22:00')
    await expect(panel).toContainText('기본 30분 1,200원')
    await expect(panel).toContainText('추가 10분당 400원')
  })
})

/* ═══════════════════════════════════════════════════════════════
 *  6. 지도
 * ═══════════════════════════════════════════════════════════════ */
test.describe('지도', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
    await widenRadius(page)
    await setVisit(page, DATES.weekday, '14:00', 120)
  })

  test('결과 개수만큼 마커가 그려진다', async ({ page }) => {
    const markers = page.getByTestId('map-marker')
    await expect(markers.first()).toBeVisible({ timeout: 15_000 })
    expect(await markers.count()).toBeGreaterThan(3)
  })

  test('마커 색상은 카드 상태와 같은 값을 쓴다', async ({ page }) => {
    await page.getByTestId('filter-free').click()
    await expect(page.getByTestId('map-marker').first()).toBeVisible()

    const statuses = await page
      .getByTestId('map-marker')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-status')))
    expect(new Set(statuses)).toEqual(new Set(['free']))
  })

  test('마커를 누르면 그 주차장의 상세가 열린다', async ({ page }) => {
    await expect(page.getByTestId('map-marker').first()).toBeVisible({ timeout: 15_000 })

    const id = await clickVisibleMarker(page)

    await expect(page.getByTestId('detail-panel')).toBeVisible()
    await expect(page.getByTestId('detail-panel')).toHaveAttribute('data-parking-id', id)
  })

  test('내 위치 버튼을 누르면 현재 위치 표시가 나타난다', async ({ page }) => {
    await page.getByTestId('gps-button').click()
    await expect(page.getByTestId('user-dot')).toBeVisible({ timeout: 10_000 })
  })
})

/* ═══════════════════════════════════════════════════════════════
 *  7. 테마
 * ═══════════════════════════════════════════════════════════════ */
test.describe('다크 / 라이트 모드', () => {
  test('토글이 html.dark 클래스와 localStorage 를 함께 바꾼다', async ({ page }) => {
    await gotoApp(page)

    const before = await page.evaluate(() => document.documentElement.classList.contains('dark'))
    await page.getByTestId('theme-toggle').click()

    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(!before)

    const stored = await page.evaluate(() => localStorage.getItem('pz.theme'))
    expect(stored).toBe(before ? 'light' : 'dark')
  })
})

/* ═══════════════════════════════════════════════════════════════
 *  8. 광고 슬롯 — 레이아웃을 해치지 않는지
 * ═══════════════════════════════════════════════════════════════ */
test.describe('Ezoic 광고 영역', () => {
  test('광고가 꺼져 있어도 자리와 스켈레톤이 유지된다 (CLS 방지)', async ({ page }) => {
    await gotoApp(page)
    await widenRadius(page)

    const slot = page.getByTestId('ad-slot').first()
    await expect(slot).toBeVisible()
    await expect(slot).toHaveAttribute('data-ad-active', 'false')
    await expect(slot.getByTestId('ad-skeleton')).toBeVisible()

    const box = await slot.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(80)
  })

  test('광고가 늦게 채워져도 목록 카드 위치가 밀리지 않는다', async ({ page }) => {
    await gotoApp(page)
    await widenRadius(page)

    const firstCard = page.getByTestId('parking-card').first()
    const before = await firstCard.boundingBox()

    // 광고 로딩 시간을 흉내 낸 뒤 위치를 다시 잰다.
    await page.waitForTimeout(1200)
    const after = await firstCard.boundingBox()

    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(2)
  })
})

/* ═══════════════════════════════════════════════════════════════
 *  9. 모바일 전용 — 바텀 시트
 * ═══════════════════════════════════════════════════════════════ */
test.describe('모바일 바텀 시트', () => {
  test.skip(({ isMobile }) => !isMobile, '모바일 뷰포트 전용')

  test('손잡이를 탭하면 시트가 펼쳐지고 다시 접힌다', async ({ page }) => {
    await gotoApp(page)

    const sheet = page.getByTestId('bottom-sheet')
    await expect(sheet).toHaveAttribute('data-snap', 'half')

    await page.getByTestId('sheet-handle').click()
    await expect(sheet).toHaveAttribute('data-snap', 'full')

    await page.getByTestId('sheet-handle').click()
    await expect(sheet).toHaveAttribute('data-snap', 'peek')
  })

  test('위로 스와이프하면 시트가 확장된다', async ({ page }) => {
    await gotoApp(page)
    const sheet = page.getByTestId('bottom-sheet')
    const handle = page.getByTestId('sheet-handle')

    const box = await handle.boundingBox()
    expect(box).not.toBeNull()

    await dragBy(page, box!.x + box!.width / 2, box!.y + box!.height / 2, 0, -320)
    await expect(sheet).toHaveAttribute('data-snap', 'full')
  })

  test('카드를 누르면 상세 시트가 위로 올라온다', async ({ page }) => {
    await gotoApp(page)
    await page.getByTestId('parking-card').first().click()
    await expect(page.getByTestId('detail-panel')).toBeVisible()
    await expect(page.getByTestId('navi-kakao')).toBeVisible()
  })
})

/* ═══════════════════════════════════════════════════════════════
 * 10. 판정 로직 단위 검증 — 실제 배포 번들의 순수 함수를 그대로 호출한다
 * ═══════════════════════════════════════════════════════════════ */
test.describe('시간 판별 로직', () => {
  test.skip(({ isMobile }) => Boolean(isMobile), '로직 검증은 데스크톱 프로젝트에서 한 번만')

  test('경계 조건들이 모두 기대한 상태를 낸다', async ({ page }) => {
    await gotoApp(page)
    await expect.poll(() => page.evaluate(() => Boolean(window.__parkatzero))).toBe(true)

    const cases = [
      { id: 'PZ-SEO-002', iso: '2026-09-15T14:00:00', dur: 120, status: 'free', cost: 0, why: '무료 주차장' },
      { id: 'PZ-SEO-004', iso: '2026-09-15T14:00:00', dur: 120, status: 'paid', cost: 3600, why: '평일 낮' },
      { id: 'PZ-SEO-004', iso: '2026-09-15T20:00:00', dur: 120, status: 'free', cost: 0, why: '19시 이후 무료' },
      { id: 'PZ-SEO-004', iso: '2026-09-25T14:00:00', dur: 120, status: 'free', cost: 0, why: '공휴일 무료' },
      { id: 'PZ-SEO-003', iso: '2026-09-15T14:00:00', dur: 30, status: 'conditional', cost: 0, why: '최초 30분 무료' },
      { id: 'PZ-SEO-003', iso: '2026-09-15T14:00:00', dur: 120, status: 'conditional', cost: 2700, why: '30분 초과분 과금' },
      { id: 'PZ-SEO-007', iso: '2026-09-15T14:00:00', dur: 60, status: 'conditional', cost: 0, why: '최초 1시간 무료' },
      { id: 'PZ-SEO-007', iso: '2026-09-15T14:00:00', dur: 120, status: 'conditional', cost: 3000, why: '1시간 초과분' },
      { id: 'PZ-SEO-008', iso: '2026-09-15T22:30:00', dur: 120, status: 'closed', cost: 0, why: '운영시간 외' },
      { id: 'PZ-SEO-009', iso: '2026-09-25T12:00:00', dur: 120, status: 'closed', cost: 0, why: '공휴일 미운영' },
      { id: 'PZ-SEO-010', iso: '2026-09-15T21:00:00', dur: 120, status: 'free', cost: 0, why: '야간 무료' },
      { id: 'PZ-SEO-011', iso: '2026-09-15T14:00:00', dur: 120, status: 'paid', cost: 4600, why: '경차만 무료 → 일반은 유료' },
      { id: 'PZ-SEO-016', iso: '2026-09-15T02:00:00', dur: 120, status: 'free', cost: 0, why: '20시~08시 무료(자정 넘김)' },
      { id: 'PZ-SEO-018', iso: '2026-09-19T14:00:00', dur: 120, status: 'free', cost: 0, why: '토요일 무료' },
      { id: 'PZ-SEO-018', iso: '2026-09-25T14:00:00', dur: 120, status: 'free', cost: 0, why: '공휴일 무료' },
      { id: 'PZ-SEO-018', iso: '2026-09-15T14:00:00', dur: 120, status: 'paid', cost: 2000, why: '평일은 유료' },
    ]

    const actual = await page.evaluate(async (input) => {
      const bridge = window.__parkatzero!
      const payload = await fetch('/data/parkings.sample.json').then((r) => r.json())
      const parkings = bridge.normalizeAll(payload)
      const byId = new Map(parkings.map((p) => [p.id, p]))

      return input.map((c) => {
        const parking = byId.get(c.id)
        if (!parking) return { ...c, actualStatus: 'MISSING', actualCost: null }
        const result = bridge.evaluate(parking, c.iso, c.dur) as { status: string; cost: number | null }
        return { ...c, actualStatus: result.status, actualCost: result.cost }
      })
    }, cases)

    for (const row of actual) {
      expect(
        { status: row.actualStatus, cost: row.actualCost },
        row.id + ' @ ' + row.iso + ' (' + row.dur + '분) — ' + row.why,
      ).toEqual({ status: row.status, cost: row.cost })
    }
  })

  test('특기사항에서 무료 규칙을 정확히 뽑아낸다', async ({ page }) => {
    await gotoApp(page)
    await expect.poll(() => page.evaluate(() => Boolean(window.__parkatzero))).toBe(true)

    const rules = await page.evaluate(() => {
      const bridge = window.__parkatzero!
      const base = {
        id: 'x',
        name: 'x',
        type: '노외',
        ownership: '공영',
        address: 'x',
        lat: 37.5,
        lng: 127,
        capacity: 10,
        chargeType: '유료' as const,
        hours: { weekday: null, saturday: null, holiday: null },
        fee: { basicTime: 30, basicCharge: 1000, addTime: 10, addCharge: 300 },
      }
      const notes = [
        '평일 19시 이후 무료 개방, 공휴일 무료',
        '토요일 및 공휴일 무료',
        '20시~08시 무료 개방',
        '최초 30분 무료. 이후 10분당 300원',
        '경차 및 저공해차량 무료, 장애인 차량 면제',
        '야간 무료 개방',
        '24시간 무료 개방 구간',
      ]
      return notes.map((note) => ({
        note,
        rules: bridge.extractFreeRules({ ...base, note }).map((r) => r.kind + '|' + r.label),
      }))
    })

    const byNote = Object.fromEntries(rules.map((r) => [r.note, r.rules]))

    // "평일 19시 이후 무료" 가 "평일 전일 무료" 로 확장되면 안 된다.
    expect(byNote['평일 19시 이후 무료 개방, 공휴일 무료']).toEqual([
      'window|19:00 이후 무료',
      'dayType|공휴일 무료',
    ])
    expect(byNote['토요일 및 공휴일 무료']).toEqual(['dayType|토요일·공휴일 무료'])
    expect(byNote['20시~08시 무료 개방']).toEqual(['window|20:00~08:00 무료'])
    expect(byNote['최초 30분 무료. 이후 10분당 300원']).toEqual(['grace|최초 30분 무료'])
    expect(byNote['경차 및 저공해차량 무료, 장애인 차량 면제']).toEqual([
      'targeted|경차 무료',
      'targeted|저공해 무료',
      'targeted|장애인 무료',
    ])
    expect(byNote['야간 무료 개방']).toEqual(['window|야간 무료(20:00~08:00 추정)'])
    // "24시간 무료"를 '최초 24시간 무료'(grace)로 읽으면 상세에 엉뚱한 근거가 붙는다.
    expect(byNote['24시간 무료 개방 구간']).toEqual(['always|상시 무료'])
  })

  test('공공데이터 원본 필드를 그대로 정규화한다', async ({ page }) => {
    await gotoApp(page)
    await expect.poll(() => page.evaluate(() => Boolean(window.__parkatzero))).toBe(true)

    const normalized = await page.evaluate(() => {
      const bridge = window.__parkatzero!
      return bridge.normalize(
        {
          prkplceNo: 'TEST-1',
          prkplceNm: '테스트 주차장',
          prkplceSe: '공영',
          prkplceType: '노상',
          rdnmadr: '서울특별시 중구 세종대로 110',
          prkcmprt: '42',
          operDay: '평일+토요일',
          weekdayOperOpenHhmm: '0900',
          // 원본 스펙의 오타(Colse)를 그대로 지원해야 한다.
          weekdayOperColseHhmm: '1800',
          satOperOperOpenHhmm: '0900',
          satOperCloseHhmm: '1500',
          holidayOperOpenHhmm: '',
          holidayCloseHhmm: '',
          parkingchrgeInfo: '유료',
          basicTime: '30',
          basicCharge: '1000',
          addUnitTime: '10',
          addUnitCharge: '500',
          latitude: '37.5663',
          longitude: '126.9779',
        },
        0,
      )
    })

    expect(normalized).toMatchObject({
      id: 'TEST-1',
      name: '테스트 주차장',
      ownership: '공영',
      type: '노상',
      capacity: 42,
      chargeType: '유료',
    })
    expect(normalized?.hours.weekday).toEqual({ open: 540, close: 1080, allDay: false })
    expect(normalized?.hours.holiday).toBeNull()
    expect(normalized?.fee).toMatchObject({ basicTime: 30, basicCharge: 1000, addTime: 10, addCharge: 500 })
  })

  test('좌표가 없거나 국내 범위를 벗어난 레코드는 걸러진다', async ({ page }) => {
    await gotoApp(page)
    await expect.poll(() => page.evaluate(() => Boolean(window.__parkatzero))).toBe(true)

    const count = await page.evaluate(() => {
      const bridge = window.__parkatzero!
      return bridge.normalizeAll({
        data: [
          { prkplceNm: '좌표 없음', latitude: '', longitude: '' },
          { prkplceNm: '해외 좌표', latitude: '48.85', longitude: '2.35' },
          { prkplceNm: '정상', latitude: '37.5', longitude: '127.0', parkingchrgeInfo: '무료' },
        ],
      }).length
    })

    expect(count).toBe(1)
  })
})

/**
 * 화면에 실제로 노출된 마커 하나를 눌러 그 id 를 돌려준다.
 *
 * 모바일에서는 바텀 시트가 지도 아래쪽을 덮고 있어 DOM 상의 첫 마커가 시트에 가려질 수 있다.
 * force 클릭으로 뚫으면 실제 사용자가 못 누르는 지점을 통과시켜 버리므로,
 * 시트를 접은 뒤 elementFromPoint 로 '정말 눌리는' 마커를 골라 평범하게 클릭한다.
 */
async function clickVisibleMarker(page: Page): Promise<string> {
  const handle = page.getByTestId('sheet-handle')
  if (await handle.count()) {
    // half → full → peek 로 접어 지도 시야를 확보한다.
    await handle.click()
    await handle.click()
    await expect(page.getByTestId('bottom-sheet')).toHaveAttribute('data-snap', 'peek')
  }

  const id = await page.evaluate(() => {
    const markers = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="map-marker"]'))
    for (const el of markers) {
      const rect = el.getBoundingClientRect()
      const topMost = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      if (topMost && el.contains(topMost)) return el.getAttribute('data-parking-id')
    }
    return null
  })

  expect(id, '화면에 노출된 마커를 찾지 못했습니다').not.toBeNull()
  await page.locator('[data-testid="map-marker"][data-parking-id="' + id + '"]').click()
  return id as string
}

/** 포인터 드래그 헬퍼 — 바텀 시트 스와이프 검증용 */
async function dragBy(page: Page, x: number, y: number, dx: number, dy: number): Promise<void> {
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(x + (dx * i) / 8, y + (dy * i) / 8)
  }
  await page.mouse.up()
}
