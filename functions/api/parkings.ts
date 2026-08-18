/**
 * Cloudflare Pages Function — 공공데이터포털 프록시.
 *
 * 왜 필요한가
 *  1. 인증키를 브라우저 번들에 노출하지 않기 위해서. VITE_ 변수는 정적 자산에 그대로 박힌다.
 *  2. 공공데이터포털은 CORS 를 허용하지 않는 엔드포인트가 많다.
 *  3. Cloudflare 엣지 캐시로 원본 API 호출량을 줄인다(일일 트래픽 제한 회피).
 *
 * 배포 설정 (Cloudflare Pages > Settings > Environment variables)
 *   PARKING_API_KEY   : 공공데이터포털 일반 인증키(Decoding)
 *   PARKING_API_BASE  : 데이터셋 엔드포인트 URL
 */

interface Env {
  PARKING_API_KEY?: string
  PARKING_API_BASE?: string
}

const CACHE_SECONDS = 60 * 60 * 6 // 6시간
const DEFAULT_PER_PAGE = 1000
const MAX_PER_PAGE = 5000

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context

  if (!env.PARKING_API_KEY || !env.PARKING_API_BASE) {
    return json(
      {
        error: 'not_configured',
        message:
          'PARKING_API_KEY / PARKING_API_BASE 환경변수가 없습니다. 앱은 시드 데이터로 계속 동작합니다.',
      },
      501,
    )
  }

  const incoming = new URL(request.url)
  const page = clampInt(incoming.searchParams.get('page'), 1, 1, 100)
  const perPage = clampInt(incoming.searchParams.get('perPage'), DEFAULT_PER_PAGE, 1, MAX_PER_PAGE)

  const upstream = new URL(env.PARKING_API_BASE)
  upstream.searchParams.set('page', String(page))
  upstream.searchParams.set('perPage', String(perPage))
  upstream.searchParams.set('serviceKey', env.PARKING_API_KEY)
  upstream.searchParams.set('returnType', 'JSON')

  // 엣지 캐시 조회 — 키에서 인증키를 제거해 캐시가 새지 않게 한다.
  const cacheKey = new Request(new URL('/api/parkings?page=' + page + '&perPage=' + perPage, incoming.origin).toString(), {
    method: 'GET',
  })
  const cache = caches.default
  const cached = await cache.match(cacheKey)
  if (cached) return cached

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetch(upstream.toString(), {
      headers: { Accept: 'application/json' },
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
    })
  } catch (err) {
    return json({ error: 'upstream_unreachable', message: String(err) }, 502)
  }

  if (!upstreamResponse.ok) {
    return json({ error: 'upstream_error', status: upstreamResponse.status }, 502)
  }

  const body = await upstreamResponse.text()
  const response = new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=' + CACHE_SECONDS + ', stale-while-revalidate=86400',
      'Access-Control-Allow-Origin': incoming.origin,
      'X-Content-Type-Options': 'nosniff',
    },
  })

  context.waitUntil(cache.put(cacheKey, response.clone()))
  return response
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
