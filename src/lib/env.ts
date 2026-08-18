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
  const s = typeof value === 'string' ? value.trim() : ''
  if (!s) return fallback
  if (s.startsWith('/') || s.startsWith('http://') || s.startsWith('https://')) return s
  console.warn('[ParkAtZero] 잘못된 경로 설정을 무시합니다:', s, '→', fallback)
  return fallback
}

export const CONFIG = {
  /** 정적 시드 데이터 경로 — 네트워크 없이도 즉시 뜨는 Local-First 의 기반 */
  seedUrl: urlPath(env.VITE_PARKING_SEED_URL, '/data/parkings.sample.json'),

  /** 서버리스 프록시 경로(권장). 비어 있으면 원격 갱신을 건너뛴다. */
  apiProxyPath: urlPath(env.VITE_PARKING_API_PROXY, ''),

  /** 프록시 없이 직접 호출할 때만 사용 (개발용). */
  apiBase: (env.VITE_PARKING_API_BASE as string) || '',
  apiKey: (env.VITE_PARKING_API_KEY as string) || '',
  apiPerPage: Number(env.VITE_PARKING_API_PER_PAGE ?? 1000),

  /** 카카오 로컬 API(장소 검색). 없으면 내장 랜드마크 사전으로 동작한다. */
  kakaoRestKey: (env.VITE_KAKAO_REST_KEY as string) || '',

  /** 지도 타일 (기본: CARTO 무료 베이스맵 — API 키 불필요) */
  tileLight:
    (env.VITE_MAP_TILE_LIGHT as string) ||
    'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  tileDark:
    (env.VITE_MAP_TILE_DARK as string) ||
    'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
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
