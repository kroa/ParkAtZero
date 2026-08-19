import type { Page, Route } from '@playwright/test'
import { expect } from '@playwright/test'

/** 검증에 쓰는 고정 날짜 — 공휴일 테이블(holidays.ts)과 맞춰 두었다. */
export const DATES = {
  /** 화요일 (평일) */
  weekday: '2026-09-15',
  /** 토요일 */
  saturday: '2026-09-19',
  /** 추석 당일 (공휴일) */
  holiday: '2026-09-25',
} as const

/**
 * 외부 네트워크를 전부 차단한다.
 *
 * - 지도 타일: 실제 배포에서는 CARTO 를 쓰지만 테스트는 오프라인이어야 재현 가능하다.
 *   타일이 없어도 지도 컨테이너와 마커는 그대로 렌더된다.
 * - 광고: Ezoic 스크립트가 붙으면 레이아웃/타이밍이 흔들린다. VITE_ADS_ENABLED=false 로
 *   이미 꺼져 있지만, 혹시 모를 서드파티 호출까지 여기서 막아 '안심 모킹'을 완성한다.
 */
export async function blockExternal(page: Page): Promise<void> {
  const kill = (route: Route) => route.abort()

  await page.route('**/basemaps.cartocdn.com/**', kill)
  await page.route('**/*.tile.openstreetmap.org/**', kill)
  await page.route(/ezoic|ezojs|gatekeeperconsent|doubleclick|googlesyndication|googletagservices/i, kill)
  await page.route('**/cdn.jsdelivr.net/**', kill)
}

/** 첫 카드가 그려질 때까지 대기 — Local-First 라 네트워크 없이도 즉시 떠야 한다. */
export async function gotoApp(page: Page): Promise<void> {
  await blockExternal(page)
  await page.goto('/')
  await expect(page.getByTestId('parking-card').first()).toBeVisible({ timeout: 15_000 })
}

/** 모바일에서는 시간 선택기가 접혀 있으므로 필요 시 펼친다. */
async function ensureTimePickerOpen(page: Page): Promise<boolean> {
  const toggle = page.getByTestId('time-toggle')
  if ((await toggle.count()) === 0) return false
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
    await expect(page.getByTestId('date-input')).toBeVisible()
  }
  return true
}

export async function setVisit(
  page: Page,
  date: string,
  time: string,
  durationMin?: number,
): Promise<void> {
  const collapsible = await ensureTimePickerOpen(page)

  await page.getByTestId('date-input').fill(date)
  await page.getByTestId('time-input').fill(time)
  if (durationMin) await page.getByTestId('duration-' + durationMin).click()

  if (collapsible) await page.getByTestId('time-toggle').click()

  // 상태 반영(디바운스 없음)을 기다린다.
  await expect(page.getByTestId('result-count')).toBeVisible()
}

/**
 * 이름으로 카드 하나를 집는다.
 *
 * 목록은 20장씩 점진적으로 그려지므로 뒤쪽 주차장은 DOM 에 없다.
 * 검색으로 먼저 좁혀 확실히 화면에 올린 뒤 집는다(사용자가 하는 동작과도 같다).
 */
export async function cardByName(page: Page, name: string) {
  const input = page.getByTestId('search-input')
  if ((await input.inputValue()) !== name) {
    await input.fill(name)
    // 자동완성 드롭다운을 닫는다. 모바일에서는 이게 열린 채로 남아 시간 토글 버튼을 가린다.
    await input.press('Escape')
    await expect(page.getByTestId('search-suggestions')).toBeHidden()
  }

  const card = page.getByTestId('parking-card').filter({ hasText: name }).first()
  await expect(card).toBeVisible()
  return card
}

/** 목록에 그 이름의 카드가 나올 때까지 필터를 넓힌다(반경 20km). */
export async function widenRadius(page: Page): Promise<void> {
  await page.getByTestId('filter-radius').selectOption('20')
}

export async function statusOf(page: Page, name: string): Promise<string | null> {
  const card = await cardByName(page, name)
  return card.getAttribute('data-status')
}
