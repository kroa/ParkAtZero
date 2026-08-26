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

  test('격자 색인이 없으면 예시 데이터로 내려간다', async ({ page }) => {
    /*
     * 실서비스는 격자 색인(cells/index.json)을 먼저 읽고 필요한 칸만 받는다.
     * 인증키 없이 띄운 환경처럼 격자가 아직 없을 때도 화면이 비면 안 된다.
     * 이 테스트 빌드는 격자를 꺼 둔 상태라 그 폴백 경로를 그대로 확인한다.
     */
    await gotoApp(page)

    await expect(page.getByTestId('sample-notice')).toBeVisible()
    expect(await page.getByTestId('parking-card').count()).toBeGreaterThan(3)
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

  test('출처 표시가 목록 하단에 붙는다', async ({ page }) => {
    // 공공누리 제1유형(출처표시)은 출처 명시가 의무다. 실수로 지워지면 라이선스 위반이 된다.
    await gotoApp(page)
    const attribution = page.getByTestId('attribution')
    await expect(attribution).toBeVisible()
    // 테스트는 예시 데이터로 도니 공공데이터 출처가 아니라 예시 고지가 떠야 한다.
    await expect(attribution).toContainText('예시 데이터')
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

  test('지역을 고르면 검색어가 비워진다', async ({ page }) => {
    // 지역 이동은 '거기로 가 보자'는 뜻이지 '이름에 그 글자가 든 곳만 보자'가 아니다.
    // 검색어가 남으면 그 동네에 주차장이 없는 것처럼 보인다.
    await page.getByTestId('search-input').fill('홍대')
    await page.getByTestId('suggestion-item').filter({ hasText: '홍대입구역' }).first().click()

    await expect(page.getByTestId('search-input')).toHaveValue('')
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

  test('필터를 켜도 칩의 전체 개수는 그대로다', async ({ page }) => {
    // 걸러진 결과로 개수를 세면 '0원만'을 켠 순간 전체 개수까지 그 값으로 바뀌어,
    // 그 지역에 주차장이 몇 곳뿐인 것처럼 보인다.
    const totalBefore = await page.getByTestId('filter-all').innerText()
    await page.getByTestId('filter-free').click()
    await expect(page.getByTestId('parking-card').first()).toBeVisible()
    expect(await page.getByTestId('filter-all').innerText()).toEqual(totalBefore)
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

  test('지도를 다른 동네로 옮기면 "이 지역에서 다시 찾기" 가 나타난다', async ({ page, isMobile }) => {
    /*
     * 결과는 언제나 기준점 반경 안에서만 고른다. 그런데 지도를 옮겨도 기준점은 그대로라,
     * 다른 동네로 밀어 보면 마커가 하나도 없어 그 지역엔 주차장이 없는 것처럼 보인다.
     * 기준점을 지도에 자동으로 붙여 버리면 카드 거리와 목록이 지도를 건드릴 때마다
     * 출렁이므로, 옮길지 말지는 사용자가 정하게 한다.
     */
    test.skip(Boolean(isMobile), '지도 드래그는 데스크톱 프로젝트에서 한 번만 확인한다')

    const here = page.getByTestId('search-here')
    await expect(page.getByTestId('map-marker').first()).toBeVisible({ timeout: 15_000 })
    // 처음에는 기준점과 지도 중심이 같으므로 뜨지 않는다.
    await expect(here).toHaveCount(0)

    const box = await page.getByTestId('map').boundingBox()
    if (!box) throw new Error('지도 영역을 찾지 못했습니다')
    const x = box.x + box.width * 0.7
    const y = box.y + box.height * 0.5
    for (let i = 0; i < 4; i++) {
      await page.mouse.move(x, y + 250)
      await page.mouse.down()
      await page.mouse.move(x, y - 250, { steps: 12 })
      await page.mouse.up()
      await page.waitForTimeout(300)
    }

    await expect(here).toBeVisible({ timeout: 10_000 })

    // 누르면 기준점이 지도 중심으로 옮겨가고, 옮겨졌으니 버튼은 사라진다.
    await here.click()
    await expect(here).toHaveCount(0, { timeout: 10_000 })
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
test.describe('지도 마커 정리', () => {
  test('라벨 마커가 상한을 다 차지해도 점은 남는다', async ({ page }) => {
    /*
     * 답이 되는 마커를 앞세우는 것까지는 맞았는데, 그것만으로 상한을 채우면 점이
     * 하나도 안 그려진다. 실제로 서대문 일대에서 라벨 마커 298개가 200칸을 다 차지해
     * 요금 미공개뿐인 홍제·홍은동 8곳이 지도에서 통째로 사라졌다 — 그 동네에
     * 주차장이 없는 것처럼 보인다.
     *
     * '여기 주차장이 있긴 하다' 는 사실은 요금을 몰라도 지워지면 안 된다.
     */
    await gotoApp(page)
    await widenRadius(page)
    // 밤에는 운영 종료가 늘어 점 대상이 많아진다.
    await setVisit(page, DATES.weekday, '23:00', 120)

    const shape = await page.getByTestId('map-marker').evaluateAll((els) => {
      let dot = 0
      let pill = 0
      for (const el of els) {
        if (el.querySelector('.pz-marker-dot')) dot++
        else pill++
      }
      return { total: els.length, dot, pill }
    })

    // 점 대상이 있는 시간대이므로 점이 하나라도 그려져야 한다.
    expect(shape.dot).toBeGreaterThan(0)
    // 라벨도 함께 남아 있어야 한다 — 점이 전부를 밀어내도 곤란하다.
    expect(shape.pill).toBeGreaterThan(0)
  })

  test('요금 미공개·운영 종료는 라벨 없이 점으로 찍는다', async ({ page }) => {
    /*
     * 이 앱은 0원 주차장을 찾는 도구다. 답이 될 수 없는 곳이 '미공개'·'종료' 글자를 달고
     * 무료 마커와 같은 크기로 지도를 덮으면 정작 초록 마커가 묻힌다.
     * 정보는 남기되(눌러서 상세를 열 수 있다) 목소리만 낮춘다.
     */
    await gotoApp(page)
    await setVisit(page, DATES.weekday, '23:00', 120)

    const markers = page.getByTestId('map-marker')
    await expect(markers.first()).toBeVisible()

    const shape = await markers.evaluateAll((els) =>
      els.map((el) => ({
        status: el.getAttribute('data-status'),
        dot: Boolean(el.querySelector('.pz-marker-dot')),
        label: el.querySelector('.pz-marker-label')?.textContent ?? null,
      })),
    )

    const quiet = shape.filter((s) => s.status === 'closed' || s.status === 'unknown')
    const loud = shape.filter((s) => s.status === 'free' || s.status === 'conditional')

    expect(quiet.length).toBeGreaterThan(0)
    for (const s of quiet) {
      expect(s.dot).toBe(true)
      expect(s.label).toBeNull()
    }

    // 무료·조건부는 그대로 라벨을 달고 있어야 한다.
    expect(loud.length).toBeGreaterThan(0)
    for (const s of loud) {
      expect(s.dot).toBe(false)
      expect(s.label).toBeTruthy()
    }
  })
})

test.describe('조건부 혜택', () => {
  test('구매 조건은 요금에서 빼되 카드와 상세에 그대로 보여 준다', async ({ page }) => {
    /*
     * "1만원 이상 구매시 2시간 무료" 는 아무것도 사지 않은 사람에게는 무료가 아니라서
     * 요금 계산에서 뺀다. 그렇다고 감춰 버리면 마트·카페 주차장에서 실제로 가장
     * 쓸모 있는 정보가 사라진다. 요금은 정직하게 매기고 조건은 따로 눈에 띄게 둔다.
     *
     * 이마트 구로점의 실제 안내를 그대로 쓴다.
     */
    await gotoApp(page)
    await widenRadius(page)
    await setVisit(page, DATES.weekday, '14:00', 120)

    // 조건이 없는 곳에는 혜택 칩이 붙지 않는다.
    const anyPerk = await page.getByTestId('card-perk').count()
    expect(anyPerk).toBeGreaterThanOrEqual(0)

    const out = await page.evaluate(() => {
      const bridge = window.__parkatzero!
      const p = {
        id: 'e',
        name: '이마트 구로점',
        type: '부설',
        ownership: '민영',
        address: '서울특별시 구로구',
        lat: 37.4844,
        lng: 126.8979,
        capacity: 0,
        chargeType: '유료' as const,
        hours: {
          weekday: { open: 600, close: 1380, allDay: false },
          saturday: { open: 600, close: 1380, allDay: false },
          holiday: { open: 600, close: 1380, allDay: false },
        },
        fee: { basicTime: 30, basicCharge: 0, addTime: 10, addCharge: 1000 },
        note: '30분 무료주차 이후 10분당 1,000원 징수, 쇼핑금액 1만원 이상시 2시간 무료주차',
      }
      const e = bridge.evaluate(p as never, '2026-09-15T14:00:00+09:00', 120) as {
        cost: number | null
        targetedRules: Array<{ target: string; label: string }>
      }
      return { cost: e.cost, perks: e.targetedRules.map((r) => r.target + '|' + r.label) }
    })

    // 요금에는 구매 혜택이 반영되지 않는다.
    expect(out.cost).toBe(9000)
    // 조건은 사라지지 않고 원문 그대로 남는다.
    expect(out.perks.length).toBeGreaterThan(0)
    expect(out.perks[0]).toContain('구매|')
    expect(out.perks.join(' ')).toContain('1만원 이상시 2시간 무료주차')
  })

  test('카드에 혜택 칩이 붙고 상세에 조건이 펼쳐진다', async ({ page }) => {
    await gotoApp(page)
    await widenRadius(page)
    await setVisit(page, DATES.weekday, '14:00', 120)

    // 예시 데이터에는 '경차 및 저공해차량 무료' 처럼 대상 한정 혜택이 있는 곳이 있다.
    const cards = page.getByTestId('parking-card')
    await expect(cards.first()).toBeVisible({ timeout: 15_000 })

    const withPerk = await cards.evaluateAll((els) =>
      els.findIndex((el) => el.querySelector('[data-testid="card-perk"]')),
    )
    test.skip(withPerk < 0, '예시 데이터에 조건부 혜택이 있는 곳이 없습니다')

    const card = cards.nth(withPerk)
    const chip = card.getByTestId('card-perk')
    await expect(chip).toBeVisible()
    // 칩은 한 줄로 줄인 문구다.
    expect((await chip.innerText()).length).toBeLessThan(20)

    await card.click()
    // 상세에는 조건 원문이 펼쳐진다.
    await expect(page.getByTestId('detail-perks')).toBeVisible()
    await expect(page.getByTestId('detail-perks')).toContainText('조건을 채우면 무료')
  })

  test('시간제 무료는 그 시간까지만 0원이고 넘기면 요금을 모른다고 한다', async ({ page }) => {
    /*
     * 홈플러스 214곳의 안내는 '무료주차 가능/1시간' 처럼 무료 시간만 있고 초과 요금이 없다.
     *
     * 1시간까지는 확실히 0원이지만, 넘긴 뒤 얼마인지는 어디에도 적혀 있지 않다.
     * 그 상태로 계속 0원이라고 하면 3시간 대고 와서 돈을 내게 된다. 모르는 건
     * 모른다고 해야 한다.
     */
    await gotoApp(page)

    const out = await page.evaluate(() => {
      const bridge = window.__parkatzero!
      const p = {
        id: 'hp',
        name: '홈플러스 개봉점',
        type: '부설',
        ownership: '민영',
        address: '서울특별시 구로구',
        lat: 37.4946,
        lng: 126.8574,
        capacity: 0,
        chargeType: '유료' as const,
        hours: {
          weekday: { open: 600, close: 1380, allDay: false },
          saturday: { open: 600, close: 1380, allDay: false },
          holiday: { open: 600, close: 1380, allDay: false },
        },
        // 무료 시간은 특기사항에만 있고 요금표는 비어 있다 — 수집기가 만드는 모양 그대로다.
        fee: { basicTime: 0, basicCharge: 0, addTime: 0, addCharge: 0 },
        note: '최초 1시간 무료',
      }
      const at = '2026-09-15T14:00:00+09:00'
      const hour = bridge.evaluate(p as never, at, 60) as { cost: number | null; status: string }
      const three = bridge.evaluate(p as never, at, 180) as { cost: number | null; status: string }
      return { hour, three }
    })

    // 1시간이면 무료 시간 안이라 0원.
    expect(out.hour.cost).toBe(0)
    // 3시간이면 초과분 요금을 모른다 — 0원으로 넘겨짚지 않는다.
    expect(out.three.cost).toBeNull()
    expect(out.three.status).toBe('unknown')
  })
})

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
      // id 에는 좌표가 꼬리로 붙는다(관리번호가 고유하지 않아서). 앞부분으로 찾는다.
      const byId = new Map(parkings.map((p) => [p.id.split('@')[0], p]))

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

  test('유료인데 금액이 비어 있으면 무료가 아니라 "정보 부족"이다', async ({ page }) => {
    /*
     * 표준데이터에는 요금정보를 '유료'로 등록해 놓고 금액 칸은 비워 둔 레코드가 많다
     * (전국 621곳). 그걸 0원으로 읽으면 돈 내야 하는 곳이 초록 '완전 무료'로 표시된다.
     * 실제로 홍제·홍은 일대가 통째로 무료로 보이는 사고가 났던 지점이라 못 박아 둔다.
     */
    await gotoApp(page)
    await expect.poll(() => page.evaluate(() => Boolean(window.__parkatzero))).toBe(true)

    const results = await page.evaluate(() => {
      const bridge = window.__parkatzero!
      const base = {
        id: 'x',
        name: '테스트',
        type: '노외',
        ownership: '공영',
        address: 'x',
        lat: 37.5,
        lng: 127,
        capacity: 10,
        hours: { weekday: null, saturday: null, holiday: null },
      }
      const cases = [
        { label: '유료 + 금액 전부 빈값', chargeType: '유료' as const, fee: { basicTime: 0, basicCharge: 0, addTime: 0, addCharge: 0 } },
        { label: '유료 + 기본시간만 있음', chargeType: '유료' as const, fee: { basicTime: 5, basicCharge: 0, addTime: 0, addCharge: 0 } },
        { label: '혼합 + 금액 빈값', chargeType: '혼합' as const, fee: { basicTime: 0, basicCharge: 0, addTime: 0, addCharge: 0 } },
        { label: '무료로 명시', chargeType: '무료' as const, fee: { basicTime: 0, basicCharge: 0, addTime: 0, addCharge: 0 } },
        { label: '유료 + 금액 있음', chargeType: '유료' as const, fee: { basicTime: 30, basicCharge: 1000, addTime: 10, addCharge: 300 } },
      ]
      return cases.map((c) => {
        const r = bridge.evaluate({ ...base, chargeType: c.chargeType, fee: c.fee }, '2026-09-15T14:00:00', 120) as {
          status: string
          cost: number | null
        }
        return { label: c.label, status: r.status, cost: r.cost }
      })
    })

    const by = Object.fromEntries(results.map((r) => [r.label, r]))
    expect(by['유료 + 금액 전부 빈값']).toMatchObject({ status: 'unknown', cost: null })
    expect(by['유료 + 기본시간만 있음']).toMatchObject({ status: 'unknown', cost: null })
    expect(by['혼합 + 금액 빈값']).toMatchObject({ status: 'unknown', cost: null })
    expect(by['무료로 명시']).toMatchObject({ status: 'free', cost: 0 })
    expect(by['유료 + 금액 있음']).toMatchObject({ status: 'paid' })
  })

  test('차종·대상 전용 주차장은 "완전 무료"가 아니다', async ({ page }) => {
    /*
     * "관광버스 전용" 2면짜리 노상 구간이 승용차 운전자에게 초록 0원으로 떴던 적이 있다
     * (탑골공원·남대문시장). 요금이 0원인 것과 내가 댈 수 있는 것은 다른 문제다.
     * 초록에서 빼야 '0원만' 필터에도 걸리지 않는다.
     */
    await gotoApp(page)
    await expect.poll(() => page.evaluate(() => Boolean(window.__parkatzero))).toBe(true)

    const results = await page.evaluate(() => {
      const bridge = window.__parkatzero!
      const base = {
        id: 'x',
        name: '테스트',
        type: '노상',
        ownership: '공영',
        address: 'x',
        lat: 37.5,
        lng: 127,
        capacity: 2,
        chargeType: '무료' as const,
        hours: { weekday: null, saturday: null, holiday: null },
        fee: { basicTime: 0, basicCharge: 0, addTime: 0, addCharge: 0 },
      }
      const notes = ['관광버스 전용', '화물차 전용', '거주자 전용', '경차 전용', '24시간 무료 개방 구간']
      return notes.map((note) => {
        const r = bridge.evaluate({ ...base, note }, '2026-09-15T14:00:00', 120) as {
          status: string
          badge: string
        }
        return { note, status: r.status, badge: r.badge }
      })
    })

    const by = Object.fromEntries(results.map((r) => [r.note, r]))
    expect(by['관광버스 전용']).toMatchObject({ status: 'conditional', badge: '관광버스 전용' })
    expect(by['화물차 전용']).toMatchObject({ status: 'conditional', badge: '화물차 전용' })
    expect(by['거주자 전용']).toMatchObject({ status: 'conditional', badge: '거주자 전용' })
    expect(by['경차 전용']).toMatchObject({ status: 'conditional', badge: '경차 전용' })
    // 제한이 없는 무료 주차장은 그대로 초록이어야 한다.
    expect(by['24시간 무료 개방 구간']).toMatchObject({ status: 'free' })
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

  test("특기사항이 '+' 로 이어져 있어도 요일 무료 규칙을 잃지 않는다", async ({ page }) => {
    /*
     * 공공데이터 특기사항은 절반이 '+' 로 항목을 잇는다(실측 1,271곳).
     * 이걸 한 문장으로 읽으면 두 방향으로 틀린다.
     *  - 앞머리의 '경차' 때문에 뒤의 요일 무료 규칙이 통째로 버려진다(74곳이 무료를 잃었다).
     *  - "무료개방(평일 야간+...)" 이 '평일 종일 무료'로 부풀려진다(24곳이 유료인데 초록이었다).
     */
    await gotoApp(page)
    await expect.poll(() => page.evaluate(() => Boolean(window.__parkatzero))).toBe(true)

    const rules = await page.evaluate(() => {
      const bridge = window.__parkatzero!
      const base = {
        id: 'x',
        name: 'x',
        type: '노상',
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
        '경차+저공해자동차 50프로 할인+장애인 및 국가유공자 차량 80프로 할인+일요일+공휴일 무료개방',
        '무료개방(평일 야간+토·일·공휴일)+주차요금(경차+장애인+독립유공자등 감면)',
        '50퍼센트감면(경차+저공해차+장애인)+무료(일요일)',
        '평일 무료+주말 1급지',
        '경차ㆍ저공해차량ㆍ장애인차량 등 50퍼센트 감면+공휴일 무료 운영',
      ]
      return notes.map((note) => ({
        note,
        rules: bridge.extractFreeRules({ ...base, note }).map((r) => r.kind + '|' + r.label),
      }))
    })

    const byNote = Object.fromEntries(rules.map((r) => [r.note, r.rules]))

    // 할인 문구에 가려 사라지던 요일 무료 규칙 (용산구 노상 6곳)
    expect(
      byNote['경차+저공해자동차 50프로 할인+장애인 및 국가유공자 차량 80프로 할인+일요일+공휴일 무료개방'],
      // '일요일' 은 요일 규칙, '공휴일' 은 요일구분 규칙으로 따로 잡힌다.
      // dayType 의 holiday 가 일요일과 공휴일을 함께 묶기 때문에 둘을 갈라 놓아야
      // 설·추석에도 무료라고 잘못 안내하지 않는다.
    ).toEqual(['dayType|공휴일 무료', 'weekdays|일요일 무료'])

    // '평일 야간' 은 종일 무료가 아니다. 공휴일만 남아야 한다 (문경시 노상 24곳).
    expect(byNote['무료개방(평일 야간+토·일·공휴일)+주차요금(경차+장애인+독립유공자등 감면)']).toEqual([
      'dayType|공휴일 무료',
    ])

    // 50퍼센트 감면은 무료가 아니다. 대상 규칙으로 잡히면 안 된다.
    expect(byNote['50퍼센트감면(경차+저공해차+장애인)+무료(일요일)']).toEqual(['weekdays|일요일 무료'])
    expect(byNote['경차ㆍ저공해차량ㆍ장애인차량 등 50퍼센트 감면+공휴일 무료 운영']).toEqual([
      'dayType|공휴일 무료',
    ])

    // "주말 1급지" 는 주말이 유료라는 뜻이다. 평일만 무료여야 한다 (과천시 노상).
    expect(byNote['평일 무료+주말 1급지']).toEqual(['dayType|평일 무료'])
  })

  test("'개방' 은 무료 신호가 아니다", async ({ page }) => {
    /*
     * "토+일+공휴일 개방" 은 그날 문을 연다는 뜻이지 공짜라는 뜻이 아니다.
     * 이걸 무료로 읽어 부천시 노상 22곳이 일요일에 초록 '완전 무료'로 나오고 있었다.
     * '무료개방' 은 여전히 무료로 읽어야 한다.
     */
    await gotoApp(page)
    await expect.poll(() => page.evaluate(() => Boolean(window.__parkatzero))).toBe(true)

    const rules = await page.evaluate(() => {
      const bridge = window.__parkatzero!
      const base = {
        id: 'x',
        name: 'x',
        type: '노상',
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
        '토+ 일+ 공휴일 개방',
        '월+공휴일개방',
        '토+일+공휴일 개방<밤 11시 주차장 폐쇄>',
        '일요일 무료개방',
        '공휴일 무료 개방',
      ]
      return notes.map((note) => ({
        note,
        rules: bridge.extractFreeRules({ ...base, note }).map((r) => r.kind + '|' + r.label),
      }))
    })
    const byNote = Object.fromEntries(rules.map((r) => [r.note, r.rules]))

    expect(byNote['토+ 일+ 공휴일 개방']).toEqual([])
    expect(byNote['월+공휴일개방']).toEqual([])
    expect(byNote['토+일+공휴일 개방<밤 11시 주차장 폐쇄>']).toEqual([])
    // '무료' 가 붙으면 그대로 무료다.
    // '일요일' 은 dayType(공휴일 묶음)이 아니라 요일 규칙으로 잡힌다.
    expect(byNote['일요일 무료개방']).toEqual(['weekdays|일요일 무료'])
    expect(byNote['공휴일 무료 개방']).toEqual(['dayType|공휴일 무료'])
  })

  test('서울 공영주차장의 공휴일 무료개방이 판정까지 이어진다', async ({ page }) => {
    /*
     * 서울시 공영주차장 API 의 요일별 유무료 라벨(SAT_CHGD_FREE_NM, LHLDY_NM)은
     * 관리되지 않아 실제와 반대로 붙어 있다.
     *
     *   여의도공원 공영주차장: API 는 LHLDY_NM='유료', SAT_CHGD_FREE_NM='무료'.
     *   서울시설공단 공식 안내는 "09:00~19:00(평일) 09:00~15:00(토요일)
     *   무료개방(공휴일)", 5분당 370원 — 정확히 반대다.
     *
     * 그래서 라벨 대신 공휴일 운영시간이 비어 있는지로 판단해 '공휴일 무료개방'을
     * 특기사항에 적는다. 그 문구가 요금 계산까지 살아 있는지 확인한다.
     * 이걸 놓치면 유료 주차장이 공휴일에도 그대로 유료로 남는다.
     */
    await gotoApp(page)

    const out = await page.evaluate(() => {
      const bridge = window.__parkatzero!
      const p = {
        id: 'yd',
        name: '여의도공원 공영주차장',
        type: '노외',
        ownership: '공영',
        address: '서울특별시 영등포구 여의동로 330',
        lat: 37.5265,
        lng: 126.9245,
        capacity: 300,
        chargeType: '유료' as const,
        hours: {
          weekday: { open: 540, close: 1140, allDay: false },
          saturday: { open: 540, close: 900, allDay: false },
          holiday: { open: 0, close: 1440, allDay: true },
        },
        fee: { basicTime: 5, basicCharge: 370, addTime: 5, addCharge: 370 },
        note: '공휴일 무료개방',
      }
      // 2026-09-15 화요일 / 2026-09-13 일요일
      const weekday = bridge.evaluate(p as never, '2026-09-15T14:00:00+09:00', 120) as { cost: number | null; status: string }
      const sunday = bridge.evaluate(p as never, '2026-09-13T14:00:00+09:00', 120) as { cost: number | null; status: string }
      return { weekday, sunday }
    })

    // 평일은 그대로 유료다 — 5분당 370원이면 2시간에 8,880원.
    expect(out.weekday.cost).toBe(8880)
    // 공휴일(일요일)은 0원.
    expect(out.sunday.cost).toBe(0)
    expect(out.sunday.status).toBe('free')
  })

  test('조례로 채운 요금표와 무료 시간대가 서로를 갉아먹지 않는다', async ({ page }) => {
    /*
     * 표준데이터에 요금이 통째로 빈 기관은 조례로 메운다. 여수시 노외주차장이 그렇다.
     *
     *   「여수시 주차장 조례」[별표 1] 노외 1급지 소형
     *     최초 1시간 무료, 초과 시 10분마다 200원, 1일 최대 5,000원
     *   여수시도시관리공단 안내
     *     "중식시간(12:00~14:00) 및 야간시간(20:00~08:00) 무료운영"
     *
     * 여기서 두 가지가 겹친다. 요금표의 '최초 1시간 0원' 과 특기사항에서 뽑은
     * '최초 1시간 무료' 가 둘 다 살아 있으면 2시간이 통째로 공짜가 된다.
     * 반대로 야간을 '운영 종료' 로 두면 무료 시간대를 적어도 회색으로 묻힌다.
     * 세 시각을 함께 확인해 어느 쪽으로도 새지 않는지 못 박는다.
     */
    await gotoApp(page)

    const out = await page.evaluate(() => {
      const bridge = window.__parkatzero!
      const p = {
        id: 'ys',
        name: '돌산공원 주차장',
        type: '노외',
        ownership: '공영',
        address: '전라남도 여수시 돌산읍',
        lat: 34.7361,
        lng: 127.7487,
        capacity: 100,
        chargeType: '유료' as const,
        // 야간이 '무료 운영' 이므로 문을 닫지 않는다 — 24시간 개방으로 덮는다.
        hours: {
          weekday: { open: 0, close: 1440, allDay: true },
          saturday: { open: 0, close: 1440, allDay: true },
          holiday: { open: 0, close: 1440, allDay: true },
        },
        fee: { basicTime: 60, basicCharge: 0, addTime: 10, addCharge: 200, dayTicket: 5000 },
        note: '12:00~14:00 무료 / 20:00~08:00 무료',
      }
      const at = (h: string) => bridge.evaluate(p as never, '2026-09-15T' + h + ':00:00+09:00', 120) as { cost: number | null; status: string }
      return { morning: at('10'), lunch: at('13'), night: at('22') }
    })

    // 10시 입차 2시간 — 최초 1시간 무료, 나머지 60분은 10분당 200원.
    // 요금표와 특기사항이 이중으로 차감되면 여기가 0원이 된다.
    expect(out.morning.cost).toBe(1200)
    // 13시 입차 2시간 — 중식 무료가 걸쳐 0원.
    expect(out.lunch.cost).toBe(0)
    // 22시 입차 2시간 — 야간 무료. '운영 종료' 가 아니라 무료여야 한다.
    expect(out.night.cost).toBe(0)
    expect(out.night.status).toBe('free')
  })

  test('00:00-00:00 은 운영요일이 빼면 24시간이 아니라 미운영이다', async ({ page }) => {
    /*
     * 00:00-00:00 은 두 가지 뜻으로 쓰인다.
     *
     * 시작과 끝이 같으면 '24시간 개방'이 표준데이터 관례다(0900-0900 이 실제로 그 뜻).
     * 그런데 지자체 상당수는 '그날은 운영하지 않는다'를 00:00-00:00 으로 적는다.
     * 성남도시개발공사 노상 66곳이 그렇다 — 운영요일은 '평일'인데 토요일·공휴일 칸이
     * 00:00-00:00 이고, 공사 안내는 "평일 09:00~18:00, 토·일·공휴일 무료개방"이다.
     *
     * 두 뜻을 가르는 신호는 운영요일이다. 그대로 두면 전국 1,369곳이 쉬는 날에도
     * 24시간 유료로 안내된다.
     */
    await gotoApp(page)

    const out = await page.evaluate(() => {
      const bridge = window.__parkatzero!
      const base = {
        prkplceNm: '성남 노상',
        prkplceSe: '공영',
        prkplceType: '노상',
        rdnmadr: '경기도 성남시',
        latitude: '37.42',
        longitude: '127.12',
        parkingchrgeInfo: '유료',
        weekdayOperOpenHhmm: '0900',
        weekdayOperColseHhmm: '1800',
        satOperOperOpenHhmm: '0000',
        satOperCloseHhmm: '0000',
        holidayOperOpenHhmm: '0000',
        holidayCloseOpenHhmm: '0000',
        basicTime: '30',
        basicCharge: '400',
        addUnitTime: '10',
        addUnitCharge: '200',
      }
      const closed = bridge.normalize({ ...base, operDay: '평일' } as never, 0)
      const always = bridge.normalize({ ...base, operDay: '매일' } as never, 1)
      const at = (p: unknown, iso: string) =>
        (bridge.evaluate(p as never, iso, 120) as { status: string; cost: number | null })
      return {
        // 2026-08-22 토요일 / 2026-08-24 월요일
        closedSat: at(closed, '2026-08-22T14:00:00+09:00'),
        closedWeekday: at(closed, '2026-08-24T14:00:00+09:00'),
        alwaysSat: at(always, '2026-08-22T14:00:00+09:00'),
      }
    })

    // 운영요일이 '평일' 이면 토요일 00:00-00:00 은 미운영 — 노상이므로 요금을 받지 않는다.
    expect(out.closedSat.status).toBe('free')
    expect(out.closedSat.cost).toBe(0)
    // 평일에는 그대로 유료. 30분 400원 + 남은 90분을 10분당 200원 = 2,200원.
    expect(out.closedWeekday.cost).toBe(2200)
    // 운영요일이 '매일' 이면 00:00-00:00 은 종래대로 24시간 개방이다.
    expect(out.alwaysSat.cost).toBe(2200)
  })

  test("'일요일 무료' 는 공휴일까지 무료로 만들지 않는다", async ({ page }) => {
    /*
     * dayType 의 'holiday' 는 일요일과 공휴일을 함께 묶는다. 그래서 '일요일 무료' 를
     * holiday 로 읽으면 설·추석에도 무료라고 안내하게 된다.
     *
     * 조례에 "일요일은 운영하지 아니한다"면서 공휴일에는 요금을 받는 지자체가 실제로 있다.
     *   부산 영도구 시행규칙: "가. 월요일부터 토요일까지 : 오전 8시부터 오후 8시까지
     *   (공휴일 포함) 나. 일요일 : 운영하지 아니함"
     * 특기사항에 '일요일' 만 적힌 주차장도 전국 90곳이다.
     */
    await gotoApp(page)

    const out = await page.evaluate(() => {
      const bridge = window.__parkatzero!
      const mk = (note: string) => ({
        id: 'x',
        name: 'x',
        type: '노상',
        ownership: '공영',
        address: '부산광역시 영도구',
        lat: 35.09,
        lng: 129.07,
        capacity: 10,
        chargeType: '유료' as const,
        hours: {
          weekday: { open: 480, close: 1200, allDay: false },
          saturday: { open: 480, close: 1200, allDay: false },
          holiday: { open: 480, close: 1200, allDay: false },
        },
        fee: { basicTime: 30, basicCharge: 500, addTime: 10, addCharge: 300 },
        note,
      })
      // 2026-08-23 일요일 / 2026-09-25 추석 당일(금요일)
      const at = (p: unknown, iso: string) =>
        (bridge.evaluate(p as never, iso, 120) as { status: string; cost: number | null })
      const sunday = mk('일요일 무료')
      const holiday = mk('공휴일 무료')
      return {
        sundayRule: bridge.extractFreeRules(sunday as never).map((r) => r.kind),
        sundayOnSun: at(sunday, '2026-08-23T14:00:00+09:00'),
        sundayOnChuseok: at(sunday, '2026-09-25T14:00:00+09:00'),
        holidayOnChuseok: at(holiday, '2026-09-25T14:00:00+09:00'),
      }
    })

    // '일요일' 은 요일 규칙으로 잡힌다 — 공휴일 묶음이 아니다.
    expect(out.sundayRule).toContain('weekdays')
    // 일요일에는 무료.
    expect(out.sundayOnSun.cost).toBe(0)
    // 추석에는 유료다. 기본 30분 500원 + 남은 90분을 10분당 300원 = 3,200원.
    // 여기가 0원이 되면 유료 주차장에 공짜라고 안내하게 된다.
    expect(out.sundayOnChuseok.cost).toBe(3200)
    // '공휴일 무료' 라고 적힌 곳은 추석에도 무료다.
    expect(out.holidayOnChuseok.cost).toBe(0)
  })

  test('명절에만 여는 주차장은 그 날짜에만 결과에 든다', async ({ page }) => {
    /*
     * 설·추석 연휴에만 개방하는 학교 운동장·공공기관 주차장이 전국에 1만 곳 있다
     * (행정안전부 「전국 명절 무료주차장 현황」).
     *
     * 평소에는 일반인이 못 대는 곳이라 연중 지도에 띄우면 '가 봤더니 막혀 있다' 가 된다.
     * 그건 요금을 틀리는 것만큼 나쁘다. 그래서 방문 날짜가 개방일일 때만 결과에 넣는다.
     */
    await gotoApp(page)

    const out = await page.evaluate(() => {
      const bridge = window.__parkatzero!
      const base = {
        type: '노외',
        ownership: '공영',
        address: '서울특별시 중구',
        lat: 37.5665,
        lng: 126.978,
        capacity: 50,
        chargeType: '무료' as const,
        hours: {
          weekday: { open: 0, close: 1440, allDay: true },
          saturday: { open: 0, close: 1440, allDay: true },
          holiday: { open: 0, close: 1440, allDay: true },
        },
        fee: { basicTime: 0, basicCharge: 0, addTime: 0, addCharge: 0 },
      }
      const lots = [
        { ...base, id: 'always', name: '상시 무료 주차장' },
        { ...base, id: 'holiday', name: '설 연휴 개방 학교', openDates: ['2026-02-16', '2026-02-17'] },
      ]
      const query = {
        keyword: '',
        durationMin: 120,
        center: { lat: 37.5665, lng: 126.978 },
        radiusKm: 10,
        status: 'all',
        ownership: 'all',
        vehicle: 'car',
        sort: 'smart',
      }
      const names = (iso: string) =>
        (bridge.run(lots as never, { ...query, visitIso: iso } as never) as { items: Array<{ id: string }> }).items
          .map((r) => r.id)
          .sort()
      return {
        onDate: names('2026-02-16T14:00:00+09:00'),
        offDate: names('2026-08-24T14:00:00+09:00'),
        dayAfter: names('2026-02-18T14:00:00+09:00'),
      }
    })

    // 개방일에는 둘 다 나온다.
    expect(out.onDate).toEqual(['always', 'holiday'])
    // 평소에는 명절 주차장이 빠진다.
    expect(out.offDate).toEqual(['always'])
    // 연휴라도 그 주차장의 개방일이 아니면 빠진다 — 날짜마다 여는 곳이 다르다.
    expect(out.dayAfter).toEqual(['always'])
  })

  test('월정기·거주자우선 구획을 이용 제한으로 읽는다', async ({ page }) => {
    /*
     * 시간 요금 칸이 비어 있어 '요금 미공개'로 분류되던 곳들이다. 사실은 금액을 모르는 게
     * 아니라 시간 단위로 파는 상품이 아예 없다. 전화해서 물어보면 댈 수 있는 곳처럼
     * 보이면 안 된다.
     */
    await gotoApp(page)
    await expect.poll(() => page.evaluate(() => Boolean(window.__parkatzero))).toBe(true)

    const out = await page.evaluate(() => {
      const bridge = window.__parkatzero!
      const pick = (extra: Record<string, unknown>) =>
        bridge.normalize(
          {
            prkplceNo: 'R',
            prkplceNm: '테스트',
            prkplceSe: '공영',
            prkplceType: '노상',
            rdnmadr: '서울특별시 도봉구 도봉로 170',
            parkingchrgeInfo: '유료',
            latitude: '37.66',
            longitude: '127.03',
            ...extra,
          },
          0,
        )?.restriction ?? null

      return {
        월정기전용: pick({ spcmnt: '월정기 전용' }),
        거주자주차제: pick({ spcmnt: '거주자주차제 전용' }),
        거주민월정기: pick({ spcmnt: '거주민 월정기 전용' }),
        거주자우선: pick({ spcmnt: '경차 50프로 할인+월야간 20000원+거주자우선주차장' }),
        주간개방: pick({ spcmnt: '주간만사용가능(야간_거주자우선주차장)' }),
        월정기금액만: pick({ monthCmmtkt: '50000', basicTime: '0', basicCharge: '0' }),
        시간요금있음: pick({ monthCmmtkt: '50000', basicTime: '30', basicCharge: '1000' }),
      }
    })

    expect(out.월정기전용).toBe('월정기 전용')
    expect(out.거주자주차제).toBe('거주자 전용')
    expect(out.거주민월정기).toBe('월정기 전용')
    expect(out.거주자우선).toBe('거주자 전용')
    // 낮에는 일반 개방하는 곳까지 막으면 안 된다.
    expect(out.주간개방).toBeNull()
    // 특기사항이 없어도 월정기 금액만 있고 시간 주차 상품이 없으면 월정기 전용이다.
    expect(out.월정기금액만).toBe('월정기 전용')
    // 시간 요금이 있으면 평범한 유료 주차장이다.
    expect(out.시간요금있음).toBeNull()
  })

  test('차종을 고르면 그 차가 댈 수 있는 곳만 남는다', async ({ page }) => {
    /*
     * 관광버스 전용 2면짜리 노상 구간이 승용차 운전자의 '조건부 무료' 목록에 섞여 있으면
     * 정작 댈 수 있는 곳이 묻힌다. 필터칩 숫자도 함께 걸러져야 한다.
     */
    await gotoApp(page)
    await expect.poll(() => page.evaluate(() => Boolean(window.__parkatzero))).toBe(true)

    const out = await page.evaluate(() => {
      const bridge = window.__parkatzero!
      const base = {
        type: '노상',
        ownership: '공영',
        address: '서울특별시 중구',
        lat: 37.5665,
        lng: 126.978,
        capacity: 10,
        chargeType: '무료' as const,
        hours: { weekday: null, saturday: null, holiday: null },
        fee: { basicTime: 0, basicCharge: 0, addTime: 0, addCharge: 0 },
      }
      const parkings = [
        { ...base, id: 'a', name: '누구나 주차장' },
        { ...base, id: 'b', name: '관광버스 자리', note: '관광버스 전용' },
        { ...base, id: 'c', name: '경차 자리', note: '경차 전용' },
        { ...base, id: 'd', name: '거주자 자리', note: '거주자주차제 전용' },
      ]
      const q = {
        keyword: '',
        durationMin: 120,
        center: { lat: 37.5665, lng: 126.978 },
        radiusKm: 5,
        status: 'all' as const,
        ownership: 'all' as const,
        sort: 'smart' as const,
        visitIso: '2026-09-15T14:00:00+09:00',
      }
      const names = (vehicle: 'car' | 'bus' | 'light' | 'any') =>
        (bridge.run(parkings, { ...q, vehicle }) as { items: Array<{ name: string }> }).items.map((i) => i.name)

      return { car: names('car'), bus: names('bus'), light: names('light'), any: names('any') }
    })

    // 기본(승용차)에서는 전용 구획이 전부 빠진다.
    expect(out.car).toEqual(['누구나 주차장'])
    // 그 차를 고르면 해당 전용 구획이 함께 나온다.
    expect(out.bus).toEqual(expect.arrayContaining(['누구나 주차장', '관광버스 자리']))
    expect(out.bus).not.toContain('경차 자리')
    expect(out.light).toEqual(expect.arrayContaining(['누구나 주차장', '경차 자리']))
    // 거주자우선은 어떤 차종을 골라도 방문자가 댈 수 없다.
    expect(out.car).not.toContain('거주자 자리')
    expect(out.bus).not.toContain('거주자 자리')
    expect(out.any).toHaveLength(4)
  })

  test('노상주차장의 운영시간 밖은 문을 닫은 게 아니라 요금을 받지 않는 것이다', async ({ page }) => {
    /*
     * 노상주차장은 도로에 그려진 주차구획이라 차단기가 없고, 요금은 조례로 정한
     * 징수시간에만 부과한다. 한국 도심에서 공짜로 대는 가장 흔한 방법인데
     * 이 앱은 그걸 전부 '운영 종료' 회색으로 묻고 있었다 — 청계천 일대 노상이
     * 토요일 15시부터 무료인데 목록에 한 곳도 뜨지 않았다.
     *
     * 노외·부설은 차단기로 실제 닫히는 곳이 섞여 있어 그대로 '운영 종료'로 둔다.
     */
    await gotoApp(page)
    await expect.poll(() => page.evaluate(() => Boolean(window.__parkatzero))).toBe(true)

    const out = await page.evaluate(() => {
      const bridge = window.__parkatzero!
      const base = {
        id: 'x',
        name: '청계N',
        ownership: '공영',
        address: '서울특별시 종로구',
        lat: 37.5696,
        lng: 126.991,
        capacity: 10,
        chargeType: '유료' as const,
        // 평일 09~19시 / 토·공휴일 09~15시 — 청계천 일대 노상의 실제 운영시간
        hours: {
          weekday: { open: 540, close: 1140, allDay: false },
          saturday: { open: 540, close: 900, allDay: false },
          holiday: { open: 540, close: 900, allDay: false },
        },
        fee: { basicTime: 30, basicCharge: 1000, addTime: 10, addCharge: 500 },
      }
      const at = (parking: Record<string, unknown>, iso: string) =>
        bridge.evaluate(parking as never, iso, 120) as {
          status: string
          headline: string
          cost: number | null
          estimated: boolean
        }

      const onStreet = { ...base, type: '노상' }
      const offStreet = { ...base, type: '노외' }
      const restricted = { ...base, type: '노상', note: '관광버스 전용' }
      const gated = { ...base, type: '노상', note: '운영시간 내 무료. 야간 차단기 통제' }

      return {
        // 토요일 20:00 — 징수시간(09~15시) 밖
        노상_운영밖: at(onStreet, '2026-08-22T20:00:00+09:00'),
        // 토요일 12:00 — 징수시간 안
        노상_운영안: at(onStreet, '2026-08-22T12:00:00+09:00'),
        // 같은 시각의 노외는 그대로 운영 종료
        노외_운영밖: at(offStreet, '2026-08-22T20:00:00+09:00'),
        // 전용 구획은 운영시간 밖이어도 일반 차량이 못 댄다
        전용_운영밖: at(restricted, '2026-08-22T20:00:00+09:00'),
        // 노상이어도 차단기로 막는 곳이 있다.
        차단기_운영밖: at(gated, '2026-08-22T20:00:00+09:00'),
      }
    })

    expect(out.노상_운영밖.status).toBe('free')
    expect(out.노상_운영밖.cost).toBe(0)
    expect(out.노상_운영밖.headline).toContain('운영시간 외')
    // 이 레코드에 적힌 값이 아니라 제도에서 온 추론이므로 '추정' 을 달아야 한다.
    expect(out.노상_운영밖.estimated).toBe(true)

    // 징수시간 안이면 그대로 유료다.
    expect(out.노상_운영안.status).toBe('paid')

    // 노외는 차단기가 있을 수 있어 판정을 바꾸지 않는다.
    expect(out.노외_운영밖.status).toBe('closed')

    // 전용 구획이 초록으로 새어 나가면 안 된다.
    expect(out.전용_운영밖.status).toBe('conditional')
    expect(out.전용_운영밖.headline).toContain('관광버스 전용')

    // '야간 차단기 통제' 처럼 물리적으로 막히는 노상은 규칙에서 뺀다.
    expect(out.차단기_운영밖.status).toBe('closed')
  })

  test('보완표에서 온 주차장은 출처를 따로 들고 다닌다', async ({ page }) => {
    /*
     * 「전국주차장정보표준데이터」는 지자체가 자율로 등록해서, 실제로 있고 이용자도 많은
     * 주차장이 통째로 빠진다(서울 25개 자치구 중 구청 청사가 등록된 곳은 10곳뿐이다).
     * 그 빈칸을 보완표(src/data/supplements.json)로 채우는데, 이 행들은 행정안전부
     * 표준데이터가 아니므로 공공누리 출처 표시를 달면 안 된다. 확인한 URL 을 그대로
     * 들고 다녀야 사용자가 직접 대조할 수 있다.
     */
    await gotoApp(page)
    await expect.poll(() => page.evaluate(() => Boolean(window.__parkatzero))).toBe(true)

    const out = await page.evaluate(() => {
      const bridge = window.__parkatzero!
      const row = {
        prkplceNo: 'PZ-SUP-TEST',
        prkplceNm: '보완 주차장',
        prkplceSe: '공영',
        prkplceType: '부설',
        rdnmadr: '서울특별시 서대문구 연희로 248',
        latitude: '37.57918',
        longitude: '126.93680',
        prkcmprt: '90',
        operDay: '평일+토요일+공휴일',
        weekdayOperOpenHhmm: '0900',
        weekdayOperColseHhmm: '1800',
        parkingchrgeInfo: '유료',
        basicTime: '30',
        basicCharge: '0',
        addUnitTime: '5',
        addUnitCharge: '500',
        spcmnt: '평일 09:00~18:00 유료(최초 30분 무료). 토요일+공휴일 무료개방',
        pzSource: 'https://example.gov/parking',
        pzVerifiedOn: '2026-08-22',
      }
      const p = bridge.normalize(row, 0)
      const at = (iso: string) =>
        (bridge.evaluate(p as never, iso, 120) as { status: string }).status
      return {
        sourceUrl: p?.sourceUrl ?? null,
        sourceVerifiedOn: p?.sourceVerifiedOn ?? null,
        평일낮: at('2026-08-19T14:00:00+09:00'),
        토요일: at('2026-08-22T14:00:00+09:00'),
        일요일: at('2026-08-23T14:00:00+09:00'),
      }
    })

    // 확인 출처가 레코드에 그대로 실려야 상세 화면이 링크를 걸 수 있다.
    expect(out.sourceUrl).toBe('https://example.gov/parking')
    expect(out.sourceVerifiedOn).toBe('2026-08-22')

    // 보완표 행도 표준데이터와 똑같은 판정 경로를 탄다.
    expect(out.평일낮).toBe('conditional')
    expect(out.토요일).toBe('free')
    expect(out.일요일).toBe('free')
  })

  test('면제시간은 시간을 빼 주는 게 아니라 그 안에 나가야 무료다', async ({ page }) => {
    /*
     * 한강공원 주차장의 EXMPTN_HR(면제시간) 은 '최초 N분 무료'(grace) 와 의미가 다르다.
     * grace 는 그 시간만큼 과금 대상에서 빼 주지만, 면제시간은 그 안에 나가면 전액
     * 무료이고 넘기면 처음부터 과금된다. 빼 주는 쪽으로 계산하면 요금을 실제보다
     * 싸게 알려 준다 — 여의도1주차장 2시간이 4,700원인데 4,400원이 된다.
     *
     * 수치는 서울 열린데이터광장 TbParkingInfoView 의 여의도1주차장 실제 값이다.
     */
    await gotoApp(page)
    await expect.poll(() => page.evaluate(() => Boolean(window.__parkatzero))).toBe(true)

    const out = await page.evaluate(() => {
      const bridge = window.__parkatzero!
      const p = {
        id: 'h',
        name: '한강공원 여의도1주차장',
        type: '노외',
        ownership: '공영',
        address: '서울특별시 영등포구 여의도동 86-5',
        lat: 37.522752,
        lng: 126.9396,
        capacity: 462,
        chargeType: '유료' as const,
        hours: {
          weekday: { open: 360, close: 1380, allDay: false },
          saturday: { open: 360, close: 1380, allDay: false },
          holiday: { open: 360, close: 1380, allDay: false },
        },
        fee: { basicTime: 30, basicCharge: 2000, addTime: 10, addCharge: 300, dayTicket: 15000 },
        note: '면제시간 10분',
      }
      const at = (dur: number) =>
        bridge.evaluate(p as never, '2026-08-22T14:00:00+09:00', dur) as {
          status: string
          cost: number | null
          headline: string
        }
      return {
        rules: bridge.extractFreeRules(p as never).map((r) => r.kind + '|' + r.label),
        분10: at(10),
        분30: at(30),
        시간2: at(120),
      }
    })

    expect(out.rules).toEqual(['exempt|10분 이내 무료'])

    // 면제시간 안이면 0원.
    expect(out.분10.status).toBe('conditional')
    expect(out.분10.cost).toBe(0)
    expect(out.분10.headline).toContain('10분 이내 무료')

    // 넘기면 처음부터 과금된다 — 10분을 빼면 안 된다.
    expect(out.분30.cost).toBe(2000)
    // 기본 30분 2,000원 + 남은 90분을 10분당 300원 = 2,000 + 2,700
    expect(out.시간2.cost).toBe(4700)
  })

  test('대형몰 부설주차장은 지점별 정책을 그대로 옮긴다', async ({ page }) => {
    /*
     * 「전국주차장정보표준데이터」는 공영이 거의 전부라(민영 913곳) 대형몰 부설주차장이
     * 통째로 빠져 있다. 그렇다고 브랜드 단위로 "스타필드는 무료" 라고 못 박으면 틀린다.
     * 같은 스타필드인데도 하남·안성·고양은 전액 무료이고 수원은 6시간 무료 뒤 유료다.
     * 지점별 공식 안내를 그대로 옮겨야 한다.
     *
     * 수치는 starfield.co.kr 각 지점 주차안내의 실제 값이다.
     */
    await gotoApp(page)
    await expect.poll(() => page.evaluate(() => Boolean(window.__parkatzero))).toBe(true)

    const out = await page.evaluate(() => {
      const bridge = window.__parkatzero!
      const mall = (extra: Record<string, unknown>) =>
        bridge.normalize(
          {
            prkplceNo: 'M',
            prkplceNm: '몰',
            prkplceSe: '민영',
            prkplceType: '부설',
            rdnmadr: '경기도',
            latitude: '37.5',
            longitude: '127.1',
            operDay: '매일',
            weekdayOperOpenHhmm: '1000',
            weekdayOperColseHhmm: '2200',
            satOperOperOpenHhmm: '1000',
            satOperCloseHhmm: '2200',
            holidayOperOpenHhmm: '1000',
            holidayCloseOpenHhmm: '2200',
            ...extra,
          },
          0,
        )
      const at = (p: unknown, iso: string, dur: number) =>
        bridge.evaluate(p as never, iso, dur) as { status: string; cost: number | null }

      // 하남·안성처럼 전액 무료인 지점
      const freeMall = mall({ parkingchrgeInfo: '무료', spcmnt: '방문객 누구나 무료' })
      // 수원처럼 최초 6시간 무료 뒤 10분당 500원인 지점
      const timedMall = mall({
        parkingchrgeInfo: '유료',
        basicTime: '360',
        basicCharge: '0',
        addUnitTime: '10',
        addUnitCharge: '500',
        dayCmmtkt: '18000',
        spcmnt: '최초 6시간 무료. 이후 10분당 500원',
      })

      return {
        무료_낮2시간: at(freeMall, '2026-09-19T14:00:00+09:00', 120),
        // 몰이 닫힌 새벽에는 무료라고 하면 안 된다.
        무료_새벽: at(freeMall, '2026-09-19T03:00:00+09:00', 120),
        조건부_2시간: at(timedMall, '2026-09-19T14:00:00+09:00', 120),
        조건부_8시간: at(timedMall, '2026-09-19T13:00:00+09:00', 480),
      }
    })

    expect(out.무료_낮2시간.status).toBe('free')
    expect(out.무료_낮2시간.cost).toBe(0)
    expect(out.무료_새벽.status).toBe('closed')

    // 6시간 안이면 0원이지만 '조건부' 다 — 더 대면 요금이 붙는다.
    expect(out.조건부_2시간.status).toBe('conditional')
    expect(out.조건부_2시간.cost).toBe(0)

    // 8시간이면 6시간 무료 + 남은 2시간을 10분당 500원 = 6,000원.
    expect(out.조건부_8시간.cost).toBe(6000)
  })

  test('구매·이용 조건이 붙은 무료는 누구나 무료가 아니다', async ({ page }) => {
    /*
     * 대형마트 주차 안내에 아주 흔한 표현이다.
     *   "30분 무료주차 이후 10분당 1,000원, 쇼핑금액 1만원 이상시 2시간 무료주차"
     * 뒤 문장을 그냥 두면 최초 2시간 무료로 읽혀, 아무것도 사지 않아도 0원이라고
     * 알려 준다. 이마트 154곳을 붙이면서 실제로 무더기로 새던 자리다.
     *
     * 조건이 붙은 절은 통째로 덮고 '조건부'로만 남긴다. 조건 없는 규칙은 그대로 산다.
     */
    await gotoApp(page)
    await expect.poll(() => page.evaluate(() => Boolean(window.__parkatzero))).toBe(true)

    const out = await page.evaluate(() => {
      const bridge = window.__parkatzero!
      const base = {
        id: 'x',
        name: 'x',
        type: '부설',
        ownership: '민영',
        address: '서울',
        lat: 37.5,
        lng: 127,
        capacity: 0,
        chargeType: '유료' as const,
        hours: { weekday: null, saturday: null, holiday: null },
        // 30분 무료 뒤 10분당 1,000원 — 이마트 구로점의 실제 요금이다.
        fee: { basicTime: 30, basicCharge: 0, addTime: 10, addCharge: 1000 },
      }
      const at = (note: string) =>
        bridge.evaluate({ ...base, note } as never, '2026-09-19T14:00:00+09:00', 120) as {
          status: string
          cost: number | null
        }
      const rules = (note: string) =>
        bridge.extractFreeRules({ ...base, note } as never).map((r) => r.kind)

      return {
        구매조건: at('30분 무료주차 이후 10분당 1,000원 징수, 쇼핑금액 1만원 이상시 2시간 무료주차'),
        구매조건규칙: rules('30분 무료주차 이후 10분당 1,000원 징수, 쇼핑금액 1만원 이상시 2시간 무료주차'),
        강좌조건: at('기본 30분 2,000원 이후 10분당 500원 / 1가지의 강좌 이용시 3시간 무료'),
        최대상한: at('30분 무료 이후 10분당 1,000원 / 최대 4시간 무료주차 가능'),
        // 조건이 없는 규칙은 그대로 살아야 한다.
        조건없음: at('평일 19시 이후 무료 개방'),
        조건없음규칙: rules('평일 19시 이후 무료 개방'),
      }
    })

    // 30분 무료 + 남은 90분을 10분당 1,000원 = 9,000원. 구매 조건은 요금을 깎지 않는다.
    expect(out.구매조건.cost).toBe(9000)
    expect(out.구매조건규칙).toContain('targeted')
    expect(out.구매조건규칙).not.toContain('always')

    // 문화센터 강좌, '최대 N시간' 상한도 마찬가지다.
    expect(out.강좌조건.cost).toBeGreaterThan(0)
    expect(out.최대상한.cost).toBe(9000)

    // 조건 없는 시간대 규칙은 손대지 않는다.
    expect(out.조건없음규칙).toContain('window')
  })

  test('원본에 차종 제한이 비어 있어도 보정표가 채운다', async ({ page }) => {
    /*
     * 남산공원 '소월로'는 특기사항에 '관광버스 전용'이 적혀 있는데 바로 옆 '소파로'는
     * 비어 있다. 둘 다 관광버스 전용인데도 그렇다(서울시설공단 직영 목록에서 확인).
     * 원본만 믿으면 21면짜리 무료 주차장으로 보여 승용차 운전자를 헛걸음시킨다.
     */
    await gotoApp(page)
    await expect.poll(() => page.evaluate(() => Boolean(window.__parkatzero))).toBe(true)

    const rows = await page.evaluate(() => {
      const bridge = window.__parkatzero!
      const base = {
        prkplceSe: '공영',
        prkplceType: '노상',
        rdnmadr: '서울특별시 중구',
        parkingchrgeInfo: '무료',
        latitude: '37.55',
        longitude: '126.99',
      }
      const cases = [
        { label: '보정 대상', prkplceNm: '남산공원 소파로', institutionNm: '서울시설공단', spcmnt: '' },
        { label: '관리기관 다름', prkplceNm: '남산공원 소파로', institutionNm: '다른기관', spcmnt: '' },
        { label: '보정 없음', prkplceNm: '성수동 서울숲2길 노상주차장', institutionNm: '서울시설공단', spcmnt: '' },
      ]
      return cases.map((c, i) => ({
        label: c.label,
        restriction: bridge.normalize({ ...base, ...c }, i)?.restriction ?? null,
      }))
    })

    const by = Object.fromEntries(rows.map((r) => [r.label, r.restriction]))
    expect(by['보정 대상']).toBe('관광버스 전용')
    // 이름만 같고 관리기관이 다르면 덮지 않는다 — 동명이인을 잘못 덮으면 더 나쁘다.
    expect(by['관리기관 다름']).toBeNull()
    expect(by['보정 없음']).toBeNull()
  })

  test('공휴일 운영종료시각 컬럼명을 원본 그대로 읽는다', async ({ page }) => {
    /*
     * 실제 API 가 쓰는 이름은 holidayCloseOpenHhmm 이다(오탈자로 보이지만 원본 스펙).
     * 이걸 빠뜨렸더니 전 레코드의 공휴일 종료시각을 못 읽어 모두 24시간 운영으로 오해했고,
     * 공휴일 밤에 문 닫는 1,362곳이 열려 있는 것으로 표시됐다.
     */
    await gotoApp(page)
    await expect.poll(() => page.evaluate(() => Boolean(window.__parkatzero))).toBe(true)

    const hours = await page.evaluate(() => {
      const bridge = window.__parkatzero!
      const base = {
        prkplceNm: '테스트',
        parkingchrgeInfo: '무료',
        latitude: '37.5',
        longitude: '127.0',
        holidayOperOpenHhmm: '09:00',
      }
      return {
        원본이름: bridge.normalize({ ...base, holidayCloseOpenHhmm: '18:00' }, 0)?.hours.holiday,
        예전이름: bridge.normalize({ ...base, holidayCloseHhmm: '18:00' }, 1)?.hours.holiday,
      }
    })

    // 09:00~18:00 → 540~1080분. 24시간(allDay)으로 읽히면 안 된다.
    expect(hours.원본이름).toEqual({ open: 540, close: 1080, allDay: false })
    // 다른 배포 경로에서 쓰는 이름도 계속 지원해야 한다.
    expect(hours.예전이름).toEqual({ open: 540, close: 1080, allDay: false })
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

    // 관리번호가 고유하지 않아 좌표를 꼬리로 붙인다.
    expect(normalized?.id).toBe('TEST-1@37.56630,126.97790')
    expect(normalized).toMatchObject({
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

  test('관리번호가 겹쳐도 주차장 id 는 고유하다', async ({ page }) => {
    /*
     * prkplceNo 는 지자체마다 자체 번호를 붙여서 서로 겹친다. 실제로 '116-2-000002'
     * 하나에 구로3동 마을공동·천왕역·동구로가 함께 달려 있다. id 가 겹치면 카드를
     * 골랐을 때 엉뚱한 주차장의 상세가 열리고, 목록 렌더도 흔들린다.
     */
    await gotoApp(page)
    await expect.poll(() => page.evaluate(() => Boolean(window.__parkatzero))).toBe(true)

    const result = await page.evaluate(() => {
      const bridge = window.__parkatzero!
      const base = { prkplceNo: '116-2-000002', parkingchrgeInfo: '무료' }
      const parkings = bridge.normalizeAll({
        data: [
          { ...base, prkplceNm: '구로3동 마을공동', latitude: '37.48502', longitude: '126.85' },
          { ...base, prkplceNm: '천왕역', latitude: '37.48728', longitude: '126.86' },
          { ...base, prkplceNm: '동구로', latitude: '37.49157', longitude: '126.87' },
          // 좌표까지 같고 이름만 다른 경우
          { ...base, prkplceNm: '이름만 다름', latitude: '37.48502', longitude: '126.85' },
        ],
      })
      return { count: parkings.length, unique: new Set(parkings.map((p) => p.id)).size }
    })

    expect(result.count).toBe(4)
    expect(result.unique).toBe(4)
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

/* ═══════════════════════════════════════════════════════════════
 *  개방주차장 수집기 (scripts/fetch-open-facility.mjs)
 * ═══════════════════════════════════════════════════════════════ */
test.describe('개방주차장 수집기', () => {
  test('휴관일에 적힌 요일을 빠짐없이 읽는다', async () => {
    const { closedDayTypes } = await import('../scripts/fetch-open-facility.mjs')

    /*
     * 자바스크립트의 \b 는 한글에 걸리지 않는다. '매주 토+일+공휴일' 에서 '토\b' 는
     * 토와 + 가 둘 다 비단어 문자라 경계가 없어 매칭에 실패했다. 그 탓에 토요일에
     * 문을 닫는 청사가 토요일 무료 주차장으로 올라갔다(포항시청사 등 11곳).
     */
    expect([...closedDayTypes('매주 토+일+공휴일')].sort()).toEqual(['공휴일', '토요일'])
    expect([...closedDayTypes('월+법정 공휴일')]).toEqual(['공휴일'])
    expect([...closedDayTypes('주말')].sort()).toEqual(['공휴일', '토요일'])

    // 문 여는 날은 하나도 빼면 안 된다.
    expect([...closedDayTypes('연중무휴')]).toEqual([])
    expect([...closedDayTypes('')]).toEqual([])
    // '월요일' 의 '일' 을 일요일로 읽으면 멀쩡한 주말 개방이 사라진다.
    expect([...closedDayTypes('매주 월요일')]).toEqual([])
    // '평일' 안의 '일' 도 마찬가지다.
    expect([...closedDayTypes('평일 휴관')]).toEqual([])
  })

  test('시각 표기를 네 자리로 맞추고, 시작과 끝이 같으면 미개방으로 본다', async () => {
    const { hhmm } = await import('../scripts/fetch-open-facility.mjs')

    expect(hhmm('09:00')).toBe('0900')
    expect(hhmm('9시')).toBe('0900')
    expect(hhmm('0730')).toBe('0730')
    expect(hhmm('23:59')).toBe('2359')
    expect(hhmm('')).toBe(null)
    expect(hhmm('상시')).toBe(null)
  })
})
