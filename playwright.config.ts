import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.PW_PORT ?? 4173)
const BASE_URL = process.env.PW_BASE_URL ?? 'http://127.0.0.1:' + PORT
const DEV_URL = process.env.PW_DEV_URL ?? 'http://127.0.0.1:5173'

/**
 * `--project=dev` 로 실행하면 이미 떠 있는 dev 서버(`npm run dev`)에 붙는다.
 * Windows cmd 에서는 `VAR=1 명령` 인라인 환경변수가 동작하지 않아, 별도 프로젝트로 갈라 둔다.
 */
const devMode = process.argv.some((arg) => arg === '--project=dev' || arg === 'dev')

/** 개발 서버 스모크 프로젝트 정의. */
function devProject() {
  return {
    /**
     * 프로덕션 빌드에는 React StrictMode 의 이펙트 이중 실행이 없어서,
     * "마운트 → 정리 → 재마운트" 에서만 터지는 결함(취소된 요청이 재시도되지 않는 등)을
     * 기본 프로젝트로는 절대 잡을 수 없다. 이 프로젝트가 그 사각지대를 덮는다.
     *
     *   터미널 1:  npm run dev
     *   터미널 2:  npm run test:dev
     */
    name: 'dev',
    testMatch: '**/dev-smoke.spec.ts',
    use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, baseURL: DEV_URL },
  }
}

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 45_000,
  expect: { timeout: 8_000 },

  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // 지도 테스트가 워커마다 WebGL(swiftshader) 컨텍스트를 잡아 CPU 를 많이 먹는다.
  // 기본값(코어 수의 절반)으로 돌리면 빌드·배포 같은 다른 작업과 겹칠 때 로딩 타임아웃으로 무너진다.
  workers: process.env.CI ? 2 : 4,

  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['list']]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    // '내 위치' 버튼 검증을 위해 기본으로 권한을 열어 둔다(서울시청 좌표).
    permissions: ['geolocation'],
    geolocation: { latitude: 37.5663, longitude: 126.9779 },
  },

  /**
   * 프로젝트 목록은 실행 방식과 무관하게 항상 같아야 한다.
   * Playwright 워커는 config 를 각자 다시 로드하는데 그때 argv 에 --project 가 없어서,
   * argv 로 목록을 갈라 두면 "Project not found in the worker process" 로 터진다.
   * 대신 npm 스크립트에서 돌릴 프로젝트를 명시한다(`npm test` / `npm run test:dev`).
   */
  projects: [
    {
      name: 'desktop-chromium',
      testIgnore: '**/dev-smoke.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile-chrome',
      testIgnore: '**/dev-smoke.spec.ts',
      use: { ...devices['Pixel 5'] },
    },
    devProject(),
  ],

  /**
   * 기본은 프로덕션 빌드를 그대로 서빙해 테스트한다 — 실제 배포물을 검증하기 위함.
   * VITE_E2E=true 는 광고 스크립트를 끄고 테스트 브리지를 노출한다.
   * dev 프로젝트는 사용자가 이미 띄워 둔 서버를 쓰므로 여기서 서버를 올리지 않는다.
   */
  webServer: devMode
    ? undefined
    : {
        command: 'npm run build:only && npm run preview -- --port ' + PORT + ' --strictPort',
        url: BASE_URL,
        env: {
          VITE_E2E: 'true',
          VITE_ADS_ENABLED: 'false',
          VITE_PARKING_API_PROXY: '',
          // 테스트는 예시 데이터 32건만 쓴다.
          // 전국 스냅샷은 갱신될 때마다 내용이 바뀌므로 '마포구청은 평일 20시에 무료'
          // 같은 단언이 성립하지 않는다. 스냅샷 자체의 건전성은 verify-snapshot.mjs 가 본다.
          VITE_PARKING_DATA_URL: '',
        },
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
})
