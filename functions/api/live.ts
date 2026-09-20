/**
 * Cloudflare Pages Function — 서울 공영주차장 실시간 주차대수.
 *
 * 사용자가 망원한강공원에 갔다가 자리가 없어 한참 기다렸다. "지금 자리가 널널한지
 * 대기가 엄청난지 알면 좋겠다"고 했다. 서울시 주차정보안내시스템이 2~3분 주기로
 * 현재 주차대수를 갱신하고 있어서, 그걸 가져다 쓴다.
 *
 * 왜 프록시가 필요한가
 *  1. 브라우저에서 바로 부르면 CORS 에 막힌다.
 *  2. 엣지에서 잠깐 캐시해 원본 서버 부담을 줄인다.
 *
 * ⚠ 이 엔드포인트는 공개 Open API 가 아니라 서울시 사이트의 내부 조회 경로다.
 *   이용약관도 SLA 도 없고 예고 없이 바뀔 수 있다. 사용자가 사용을 승인했다.
 *   끊기면 이 함수만 빈 배열을 돌려주고 앱은 실시간 표시 없이 평소대로 동작한다.
 *
 * 믿을 수 없는 값은 버린다 — 이게 이 함수의 핵심이다.
 *
 *  · 갱신 시각이 없는 곳(39곳)과 30분보다 오래된 곳. que_status 가 '연계됨'이어도
 *    실제로는 몇 달 전 값이 남아 있는 곳이 있다. 광화문 D타워는 5개월,
 *    그랑서울은 11개월 전 값이었다. 낡은 값으로 '자리 있음'을 보여 주면
 *    아무것도 안 보여 주느니만 못하다.
 *  · 현재대수가 총면수를 넘는 곳(10곳). 석계역 87/70, 은평평화공원 156/66 처럼
 *    음수 여유가 나온다.
 *
 * 사용: GET /api/live?codes=3020856,3199031
 */

/** 한 번에 물어볼 수 있는 주차장 수. 지도 한 화면에 보이는 것보다 넉넉하다. */
const MAX_CODES = 20
/** 엣지 캐시. 원본이 2~3분 주기로 갱신되므로 그보다 짧게 잡는다. */
const CACHE_SECONDS = 90
/** 이보다 오래된 갱신 시각은 버린다. */
const MAX_AGE_MS = 30 * 60 * 1000
const BASE = 'https://parking.seoul.go.kr'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

interface Live {
  code: string
  capacity: number
  current: number
  free: number
  updatedAt: string
}

export const onRequestGet: PagesFunction = async (context) => {
  const { request } = context
  const url = new URL(request.url)

  const codes = (url.searchParams.get('codes') ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => /^[0-9]{3,12}$/.test(c))
    .slice(0, MAX_CODES)

  if (codes.length === 0) return json({ lots: [] }, 200, 'no-store')

  const cacheKey = new Request(new URL('/api/live?codes=' + codes.join(','), url.origin).toString())
  const cache = caches.default
  const cached = await cache.match(cacheKey)
  if (cached) return cached

  const settled = await Promise.allSettled(codes.map((c) => fetchOne(c)))
  const lots = settled
    .map((s) => (s.status === 'fulfilled' ? s.value : null))
    .filter((v): v is Live => v !== null)

  const response = json({ lots, fetchedAt: new Date().toISOString() }, 200,
    'public, max-age=' + CACHE_SECONDS)
  context.waitUntil(cache.put(cacheKey, response.clone()))
  return response
}

async function fetchOne(code: string): Promise<Live | null> {
  let body: Record<string, unknown>
  try {
    const res = await fetch(BASE + '/search/parking/detail.do', {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'X-Requested-With': 'XMLHttpRequest',
        Referer: BASE + '/search/parking/main.do',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: new URLSearchParams({ code, infra_type: 'PK' }).toString(),
    })
    if (!res.ok) return null
    body = (await res.json()) as Record<string, unknown>
  } catch {
    return null
  }

  if (String(body?.result_state) !== '0000') return null
  const v = body?.res_value as Record<string, unknown> | undefined
  if (!v || String(v.que_status) !== '1') return null

  const capacity = int(v.capacity)
  const current = int(v.cur_parking)
  if (capacity <= 0) return null
  // 현재대수가 총면수를 넘으면 계량기가 어긋난 것이다. 음수 여유를 보여 줄 수는 없다.
  if (current < 0 || current > capacity) return null

  const updated = parseKst(String(v.cur_parking_time ?? ''))
  if (!updated) return null
  if (Date.now() - updated.getTime() > MAX_AGE_MS) return null

  return {
    code,
    capacity,
    current,
    free: capacity - current,
    updatedAt: updated.toISOString(),
  }
}

/**
 * '2026-09-20 20:58:23.0' 을 읽는다.
 * 시간대 표시가 없지만 한국 시각이다. 그대로 Date 에 넣으면 실행 환경이 UTC 인
 * 엣지에서 9시간 어긋나, 방금 갱신된 값이 9시간 전 것으로 보여 전부 버려진다.
 */
function parseKst(raw: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw.trim())
  if (!m) return null
  const iso = m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + '+09:00'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

function int(v: unknown): number {
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? Math.round(n) : 0
}

function json(payload: unknown, status: number, cacheControl: string): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
      'Access-Control-Allow-Origin': '*',
    },
  })
}
