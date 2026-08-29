/**
 * 모든 외부 설정은 여기 한 곳에서만 읽는다.
 * VITE_ 접두사가 붙은 값은 번들에 그대로 박히므로 '공개 가능한 키'만 넣어야 한다.
 * 비공개 키(공공데이터포털 Decoding key 등)는 Cloudflare Pages Functions 프록시를 거친다.
 * (자세한 내용은 DEPLOY.md '보안' 절 참고)
 */
const env = import.meta.env

function flag(value: unknown, fallback = false): boolean {
  if (value === undefined || value === '') return fallback
  return String(value).toLowerCase() === 'true'
}

/**
 * URL/경로로 쓸 수 없는 값이면 기본값으로 되돌린다.
 *
 * Git Bash(MSYS)에서 `VITE_X=/data/foo.json vite build` 로 빌드하면 값이
 * `C:/Program Files/Git/data/foo.json` 으로 자동 변환돼 번들에 박힌다.
 * 그대로 두면 배포 후에야 file:// fetch 실패로 드러나므로 여기서 잘라낸다.
 * (빌드 시점 해결책: MSYS_NO_PATHCONV=1 또는 값 앞에 슬래시를 하나 더)
 */
function urlPath(value: unknown, fallback: string): string {
  // 값을 아예 주지 않은 것과 '빈 값으로 껐다'는 것은 다르다.
  // 빈 문자열까지 기본값으로 되돌리면 테스트에서 스냅샷을 끌 방법이 없어진다.
  if (value === undefined || value === null) return fallback
  const s = typeof value === 'string' ? value.trim() : ''
  if (!s) return ''
  if (s.startsWith('/') || s.startsWith('http://') || s.startsWith('https://')) return s
  console.warn('[ParkAtZero] 잘못된 경로 설정을 무시합니다:', s, '→', fallback)
  return fallback
}

/**
 * 타일 주소에 CARTO 키를 붙인다. 키가 없으면 주소를 그대로 둔다.
 *
 * 직접 만든 주소(VITE_MAP_TILE_LIGHT)를 쓰는 사람은 자기 주소에 키를 이미 적어 넣었을
 * 테니 건드리지 않는다. 기본 주소일 때만 붙인다.
 */
export function withTileKey(url: string, source: Record<string, unknown> = env): string {
  const key = typeof source.VITE_MAP_TILE_KEY === 'string' ? source.VITE_MAP_TILE_KEY.trim() : ''
  if (!key || url.includes('key=')) return url
  return url + (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key)
}

export const CONFIG = {
  /**
   * 격자 색인. 빌드 때 만들어지며, 앱은 이걸 먼저 읽고 필요한 칸만 골라 받는다.
   * 없으면(격자를 만들지 않은 환경) 예시 데이터로 내려간다.
   */
  cellIndexUrl: urlPath(env.VITE_PARKING_CELL_INDEX, '/data/cell-index.json'),
  cellBaseUrl: urlPath(env.VITE_PARKING_CELL_BASE, '/data/cells'),

  /** 예시 데이터 — 실제 스냅샷이 없을 때만 쓰는 폴백 */
  seedUrl: urlPath(env.VITE_PARKING_SEED_URL, '/data/parkings.sample.json'),

  /** 서버리스 프록시 경로(권장). 비어 있으면 원격 갱신을 건너뛴다. */
  apiProxyPath: urlPath(env.VITE_PARKING_API_PROXY, ''),

  /** 프록시 없이 직접 호출할 때만 사용 (개발용). */
  apiBase: (env.VITE_PARKING_API_BASE as string) || '',
  apiKey: (env.VITE_PARKING_API_KEY as string) || '',
  apiPerPage: Number(env.VITE_PARKING_API_PER_PAGE ?? 1000),

  /** 카카오 로컬 API(장소 검색). 없으면 내장 랜드마크 사전으로 동작한다. */
  kakaoRestKey: (env.VITE_KAKAO_REST_KEY as string) || '',

  /*
   * 지도 타일 — CARTO 베이스맵.
   *
   * 오랫동안 키 없이 쓸 수 있었지만 CARTO 가 정책을 바꿨다. 키 없이 부르면 응답은
   * 200 이고 그림도 멀쩡히 들어 있는데 그 위에 'API KEY REQUIRED' 워터마크를 합성해
   * 보낸다. 오류가 아니라서 콘솔에 아무것도 안 뜨고, 캐시된 옛 타일과 섞여 지도 일부에만
   * 글씨가 보인다.
   *
   * VITE_MAP_TILE_KEY 를 넣으면 ?key= 로 붙는다. 없으면 워터마크가 찍힌 채로 나온다.
   * 키는 https://carto.com/basemaps/apikey 에서 무료로 받는다(월 500만 요청).
   * 무료 조건에 저작자 표시 유지가 있어 tileAttribution 을 지우면 안 된다.
   */
  tileKey: (env.VITE_MAP_TILE_KEY as string) || '',
  tileLight:
    (env.VITE_MAP_TILE_LIGHT as string) ||
    withTileKey('https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png', env),
  tileDark:
    (env.VITE_MAP_TILE_DARK as string) ||
    withTileKey('https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png', env),
  tileAttribution:
    (env.VITE_MAP_ATTRIBUTION as string) ||
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',

  /** Ezoic 광고 — 로컬/테스트에서는 꺼둔다. */
  adsEnabled: flag(env.VITE_ADS_ENABLED, false),
  ezoicIds: {
    listInline: Number(env.VITE_EZOIC_PLACEHOLDER_LIST ?? 101),
    bottom: Number(env.VITE_EZOIC_PLACEHOLDER_BOTTOM ?? 102),
  },

  /** Playwright 실행 중 여부 — 애니메이션 단축, 광고 비활성 */
  e2e: flag(env.VITE_E2E, false),

  cacheTtlMs: Number(env.VITE_CACHE_TTL_MS ?? 6 * 60 * 60 * 1000),
} as const

export type AppConfig = typeof CONFIG
