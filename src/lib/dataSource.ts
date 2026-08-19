import type { Parking } from '@/types/parking'
import { CONFIG } from './env'
import { normalizeAll } from './normalize'

const CACHE_KEY = 'pz.parkings.v1'

/**
 * 데이터의 출처.
 *  - 'sample' : 저장소에 동봉된 예시 데이터. 실제 공공데이터가 아니며 요금/운영시간이 가공값이다.
 *  - 'remote' : 공공데이터포털에서 받아온 실제 데이터.
 *
 * UI 는 이 값을 보고 출처를 정직하게 표기해야 한다. 예시 데이터를 정부 데이터처럼
 * 보여주면 사용자가 실제로 그 요금을 믿고 차를 몰고 간다.
 */
export type DataSource = 'sample' | 'remote'

interface CacheEnvelope {
  savedAt: number
  source: DataSource
  parkings: Parking[]
}

export type LoadStage = 'cache' | 'seed' | 'remote'

export interface LoadEvent {
  stage: LoadStage
  source: DataSource
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

function writeCache(parkings: Parking[], source: DataSource): void {
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

/** 브라우저가 한가해질 때까지 기다린다(지원하지 않으면 다음 프레임 뒤). */
function whenIdle(timeout = 1200): Promise<void> {
  return new Promise((resolve) => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback
    if (typeof ric === 'function') ric(() => resolve(), { timeout })
    else window.setTimeout(resolve, 150)
  })
}

/** 실패를 예외가 아니라 null 로 돌려주는 정적 파일 로더. */
async function tryLoad(url: string, signal?: AbortSignal): Promise<Parking[] | null> {
  if (!url) return null
  try {
    const parkings = normalizeAll(await fetchJson(url, signal))
    return parkings.length > 0 ? parkings : null
  } catch {
    // 스냅샷이 아직 없으면 404 다. 예시 데이터로 내려가면 되므로 조용히 넘어간다.
    return null
  }
}

/**
 * Local-First 로딩.
 *
 * 1) localStorage 캐시가 있으면 즉시 방출 → 첫 화면이 네트워크를 기다리지 않는다.
 * 2) 캐시가 없으면 정적 스냅샷 → 예시 데이터 순으로 방출 (오프라인에서도 동작).
 * 3) 프록시가 설정돼 있으면 마지막으로 원격 갱신. 실패해도 화면은 이미 살아 있다.
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
    // 예전 버전이 남긴 캐시에는 source 가 없을 수 있다. 확실치 않으면 예시로 간주한다(보수적).
    const source: DataSource = cached.source === 'remote' ? 'remote' : 'sample'
    onEvent({ stage: 'cache', source, parkings: cached.parkings, savedAt: cached.savedAt })
  }

  /*
   * 예시 데이터와 실제 스냅샷을 '동시에' 던진다.
   *
   * 순서대로 시도하면 스냅샷이 아직 없을 때 404 한 왕복만큼 첫 페인트가 늦는다.
   * 병렬로 던져 두면 가벼운 예시가 먼저 도착해 화면을 채우고, 뒤이어 스냅샷이 오면
   * 실제 데이터로 조용히 올라선다. 자동 갱신이 스냅샷을 커밋하는 순간
   * 환경변수도 코드도 건드리지 않고 앱이 알아서 승격된다.
   */
  if (!cached) {
    const sample = await tryLoad(CONFIG.seedUrl, signal)
    if (signal?.aborted) return
    if (sample) {
      onEvent({ stage: 'seed', source: 'sample', parkings: sample })
      writeCache(sample, 'sample')
    } else {
      onEvent({ stage: 'seed', source: 'sample', parkings: [] })
    }
  }

  // 전국 스냅샷은 10MB 급이라 JSON.parse 만으로도 메인 스레드를 1초 가까이 잡는다.
  // 첫 화면이 그려질 틈을 준 뒤에 손대야 저사양 단말에서 초기 로딩이 밀리지 않는다.
  await whenIdle()
  const snapshot = await tryLoad(CONFIG.dataUrl, signal)
  if (signal?.aborted) return
  if (snapshot) {
    onEvent({ stage: 'remote', source: 'remote', parkings: snapshot, savedAt: Date.now() })
    writeCache(snapshot, 'remote')
  }

  const remoteUrl = buildRemoteUrl()
  if (!remoteUrl || cacheFresh) return

  try {
    const payload = await fetchJson(remoteUrl, signal)
    const parkings = normalizeAll(payload)
    if (parkings.length > 0) {
      onEvent({ stage: 'remote', source: 'remote', parkings, savedAt: Date.now() })
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
