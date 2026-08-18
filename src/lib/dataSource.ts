import type { Parking } from '@/types/parking'
import { CONFIG } from './env'
import { normalizeAll } from './normalize'

const CACHE_KEY = 'pz.parkings.v1'

interface CacheEnvelope {
  savedAt: number
  source: string
  parkings: Parking[]
}

export type LoadStage = 'cache' | 'seed' | 'remote'

export interface LoadEvent {
  stage: LoadStage
  parkings: Parking[]
  savedAt?: number
}

function readCache(): CacheEnvelope | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheEnvelope
    if (!Array.isArray(parsed.parkings) || parsed.parkings.length === 0) return null
    return parsed
  } catch {
    // 손상된 캐시는 조용히 버린다 — 시드 데이터로 계속 동작하면 된다.
    return null
  }
}

function writeCache(parkings: Parking[], source: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    const envelope: CacheEnvelope = { savedAt: Date.now(), source, parkings }
    localStorage.setItem(CACHE_KEY, JSON.stringify(envelope))
  } catch {
    // 용량 초과(QuotaExceeded)는 치명적이지 않다. 다음 세션에 다시 받으면 된다.
  }
}

export function clearCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    /* noop */
  }
}

/** 프록시가 아직 설정되지 않았을 때 Pages Function 이 돌려주는 상태 코드. */
const NOT_CONFIGURED = 501

class HttpError extends Error {
  constructor(readonly status: number, url: string) {
    super('HTTP ' + status + ' — ' + url)
    this.name = 'HttpError'
  }
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new HttpError(res.status, url)
  return res.json()
}

/** 원격 갱신 URL. 프록시가 있으면 프록시를, 없으면 직접 호출 URL을 만든다. */
function buildRemoteUrl(): string | null {
  if (CONFIG.apiProxyPath) return CONFIG.apiProxyPath
  if (!CONFIG.apiBase) return null

  const url = new URL(CONFIG.apiBase, window.location.origin)
  url.searchParams.set('page', '1')
  url.searchParams.set('perPage', String(CONFIG.apiPerPage))
  if (CONFIG.apiKey) url.searchParams.set('serviceKey', CONFIG.apiKey)
  url.searchParams.set('returnType', 'JSON')
  return url.toString()
}

/**
 * Local-First 로딩.
 *
 * 1) localStorage 캐시가 있으면 즉시 방출 → 첫 화면이 네트워크를 기다리지 않는다.
 * 2) 캐시가 없으면 번들과 함께 배포된 시드 JSON 을 방출 (오프라인에서도 동작).
 * 3) 마지막으로 원격 API 를 백그라운드 갱신. 실패해도 화면은 이미 살아 있다.
 *
 * onEvent 는 단계마다 호출되므로 UI 는 점진적으로 갱신된다.
 */
export async function loadParkings(
  onEvent: (event: LoadEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const cached = readCache()
  const cacheFresh = cached !== null && Date.now() - cached.savedAt < CONFIG.cacheTtlMs

  if (cached) {
    onEvent({ stage: 'cache', parkings: cached.parkings, savedAt: cached.savedAt })
  } else {
    try {
      const payload = await fetchJson(CONFIG.seedUrl, signal)
      const parkings = normalizeAll(payload)
      onEvent({ stage: 'seed', parkings })
      writeCache(parkings, 'seed')
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      onEvent({ stage: 'seed', parkings: [] })
    }
  }

  const remoteUrl = buildRemoteUrl()
  if (!remoteUrl || cacheFresh) return

  try {
    const payload = await fetchJson(remoteUrl, signal)
    const parkings = normalizeAll(payload)
    if (parkings.length > 0) {
      onEvent({ stage: 'remote', parkings, savedAt: Date.now() })
      writeCache(parkings, 'remote')
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return
    // 인증키를 아직 안 넣은 상태(501)는 정상적인 운영 형태다 — 시끄럽게 굴 필요 없다.
    if (err instanceof HttpError && err.status === NOT_CONFIGURED) return
    // 그 밖의 원격 실패도 치명적이지 않다. 사용자는 이미 캐시/시드 데이터를 보고 있다.
    console.warn('[ParkAtZero] 원격 데이터 갱신 실패 — 로컬 데이터로 계속합니다.', err)
  }
}
