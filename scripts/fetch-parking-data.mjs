#!/usr/bin/env node
/**
 * 전국주차장정보표준데이터 전체를 받아 public/data/parkings.full.json 으로 굽는다.
 *
 *   npm run data:fetch
 *
 * 필요한 환경변수 (.env.local 또는 CI 시크릿):
 *   PARKING_API_KEY   공공데이터포털 인증키
 *   PARKING_API_BASE  API 엔드포인트 URL
 *
 * 왜 런타임 API 가 아니라 빌드 타임 스냅샷인가
 *   - 이 데이터셋 갱신주기는 '반기'다. 매 요청마다 원본을 부를 이유가 없다.
 *   - 개발계정 일일 트래픽은 10,000회다. 사용자가 늘면 그 한도에 화면이 먼저 죽는다.
 *   - 정적 파일이면 엣지가 brotli 로 눌러 보내고 브라우저가 캐시한다.
 *
 * 호출 규격이 데이터셋마다 다른 문제
 *   같은 포털이라도 주소 계열(page/perPage ↔ pageNo/numOfRows), 인증키 형태
 *   (Encoding ↔ Decoding), JSON 을 요구하는 파라미터 이름(type/dataType/...)이
 *   제각각이고, 어떤 API 는 모르는 파라미터를 무시하지 않고 거부한다.
 *   그래서 규격을 가정하지 않고 소수의 요청으로 탐색해 확정한다.
 *
 * 출력은 결정적이다. 원본이 그대로면 파일도 같아서 자동 갱신이 헛커밋을 만들지 않는다.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const OUT_PATH = path.join('public', 'data', 'parkings.full.json')
const MAX_PAGES = 800
const PROBE_SIZE = 100
const BULK_SIZE = 1000
/** 이 크기를 넘으면 경고한다 — 브라우저가 한 번에 파싱하기 버거워지는 지점. */
const WARN_BYTES = 12 * 1024 * 1024

const KEY_MODES = ['raw', 'encoded']
/** null = JSON 파라미터를 아예 보내지 않음. 거부하는 API 가 있어 최소 요청부터 시작한다. */
const JSON_PARAMS = [null, 'type', 'dataType', 'returnType', 'resultType']

/**
 * 앱이 실제로 읽는 컬럼만 남긴다(src/lib/normalize.ts 의 FIELD 와 일치).
 * 전국 규모에서는 쓰지 않는 컬럼의 무게가 무시 못 할 수준이다.
 */
const KEEP = new Set([
  'prkplceNo', '주차장관리번호',
  'prkplceNm', '주차장명',
  'prkplceSe', '주차장구분',
  'prkplceType', '주차장유형',
  'rdnmadr', '소재지도로명주소',
  'lnmadr', '소재지지번주소',
  'prkcmprt', '주차구획수',
  'operDay', '운영요일',
  'weekdayOperOpenHhmm', '평일운영시작시각',
  'weekdayOperColseHhmm', 'weekdayOperCloseHhmm', '평일운영종료시각',
  'satOperOperOpenHhmm', 'satOperOpenHhmm', '토요일운영시작시각',
  'satOperCloseHhmm', '토요일운영종료시각',
  'holidayOperOpenHhmm', '공휴일운영시작시각',
  'holidayCloseHhmm', 'holidayOperCloseHhmm', '공휴일운영종료시각',
  'parkingchrgeInfo', '요금정보',
  'basicTime', '주차기본시간',
  'basicCharge', '주차기본요금',
  'addUnitTime', '추가단위시간',
  'addUnitCharge', '추가단위요금',
  'dayCmmtktAdjTime', '1일주차권요금적용시간',
  'dayCmmtkt', '1일주차권요금',
  'monthCmmtkt', '월정기권요금',
  'metpay', '결제방법',
  'spcmnt', '특기사항',
  'phoneNumber', '전화번호',
  'institutionNm', '관리기관명',
  'latitude', '위도',
  'longitude', '경도',
  'referenceDate', '데이터기준일자',
])

/** dotenv 의존성 없이 .env.local 을 읽는다 — 스크립트 하나 때문에 패키지를 늘리지 않는다. */
async function loadEnvFile(file) {
  if (!existsSync(file)) return
  const text = await readFile(file, 'utf-8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!(key in process.env)) process.env[key] = value
  }
}

/**
 * Node 의 fetch 는 네트워크 오류를 전부 'fetch failed' 로 감싸고 진짜 사유를 cause 에 넣는다.
 * 그 사슬을 펼쳐야 ENOTFOUND / ECONNREFUSED 같은 실제 원인이 보인다.
 */
function describeError(err) {
  const parts = [err.message]
  let cause = err.cause
  for (let depth = 0; cause && depth < 4; depth++) {
    parts.push((cause.code ? cause.code + ' ' : '') + (cause.message ?? String(cause)))
    cause = cause.cause
  }
  return parts.join(' ← ')
}

function apiFlavor(base) {
  return new URL(base).hostname.includes('odcloud.kr') ? 'odcloud' : 'classic'
}

function buildUrl(base, key, page, spec) {
  const url = new URL(base)
  // 사용자가 ?serviceKey=... 까지 붙여 넣는 경우가 흔하다. 우리가 다시 세팅하므로 지운다.
  url.searchParams.delete('serviceKey')

  if (spec.flavor === 'odcloud') {
    url.searchParams.set('page', String(page))
    url.searchParams.set('perPage', String(spec.size))
  } else {
    url.searchParams.set('pageNo', String(page))
    url.searchParams.set('numOfRows', String(spec.size))
  }
  if (spec.jsonParam) {
    url.searchParams.set(spec.jsonParam, spec.jsonParam === 'dataType' ? 'JSON' : 'json')
  }

  // searchParams 는 항상 인코딩하므로 raw 모드는 쿼리 문자열에 직접 이어 붙인다.
  const value = spec.keyMode === 'raw' ? key : encodeURIComponent(key)
  return url.toString() + (url.search ? '&' : '?') + 'serviceKey=' + value
}

/**
 * 포털은 HTTP 200 에 오류를 실어 보낸다. 껍데기도 두 가지다.
 *   { response: { header: { resultCode } } }   /   { header: { resultCode } }
 * 둘 다 봐야 '0건' 으로 오해하지 않는다.
 */
function assertNoApiError(payload) {
  const header = payload?.response?.header ?? payload?.header
  const code = header?.resultCode ?? header?.returnReasonCode
  if (code === undefined || String(code) === '00' || String(code) === '0') return

  const msg = header?.resultMsg ?? header?.returnAuthMsg ?? '(메시지 없음)'
  const err = new Error('API 오류 ' + code + ': ' + msg)
  // "INVALID_REQUEST_PARAMETER_ERROR (dataType)" 처럼 문제의 파라미터를 알려준다.
  const named = /INVALID_REQUEST_PARAMETER[^(]*\(([^)]+)\)/.exec(msg)
  if (named) err.invalidParam = named[1].trim()
  if (/SERVICE_KEY|인증/i.test(msg)) err.auth = true
  throw err
}

async function fetchPage(base, key, page, spec, { attempts = 3 } = {}) {
  const url = buildUrl(base, key, page, spec)

  let lastError
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(45000),
      })
      const text = await res.text()

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw Object.assign(new Error('인증 실패(HTTP ' + res.status + ') ' + text.slice(0, 120)), {
            fatal: true,
            auth: true,
          })
        }
        throw new Error('HTTP ' + res.status + ' ' + res.statusText + ' — ' + text.slice(0, 160))
      }

      let payload
      try {
        payload = JSON.parse(text)
      } catch {
        // XML 로 돌려주는 경우. JSON 파라미터 이름이 틀렸다는 신호다.
        throw Object.assign(new Error('XML 응답(JSON 파라미터 불일치) ' + text.slice(0, 120)), {
          fatal: true,
          notJson: true,
        })
      }

      assertNoApiError(payload)
      return payload
    } catch (err) {
      lastError = err
      if (err.fatal || err.invalidParam || err.auth) break
      if (attempt < attempts) await new Promise((r) => setTimeout(r, attempt * 1500))
    }
  }
  throw Object.assign(new Error(describeError(lastError)), {
    auth: lastError.auth,
    invalidParam: lastError.invalidParam,
    notJson: lastError.notJson,
    network: /fetch failed|ETIMEDOUT|ECONNRESET|ENOTFOUND|ECONNREFUSED/.test(lastError.message),
  })
}

/** 주차장 레코드로 보이는 객체인지 — 깊이 탐색이 엉뚱한 배열을 잡지 않게 하는 최소 판별. */
function looksLikeRecord(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const keys = Object.keys(v)
  if (keys.length < 3) return false
  return keys.some((k) => /prkplce|주차장|latitude|위도|longitude|경도/i.test(k))
}

/**
 * 응답에서 레코드 배열을 찾아낸다.
 * 알려진 경로를 먼저 보고, 못 찾으면 응답 전체를 훑어 '레코드처럼 생긴 객체들의 배열'
 * 중 가장 큰 것을 고른다. 껍데기 구조를 하나씩 추가하며 왕복하는 것보다 확실하다.
 */
function rowsOf(payload) {
  const known = [
    payload?.data,
    payload?.response?.body?.items,
    payload?.response?.body?.items?.item,
    payload?.response?.body?.item,
    payload?.body?.items,
    payload?.body?.items?.item,
    payload?.items,
    payload?.records,
  ]
  for (const candidate of known) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate
    if (looksLikeRecord(candidate)) return [candidate]
  }

  let best = []
  const seen = new Set()
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 6 || seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      if (node.length > best.length && node.some(looksLikeRecord)) best = node
      for (const child of node.slice(0, 3)) walk(child, depth + 1)
      return
    }
    for (const value of Object.values(node)) walk(value, depth + 1)
  }
  walk(payload, 0)
  return best
}

function coord(row, keys) {
  for (const k of keys) {
    const n = Number(String(row[k] ?? '').replace(/[^0-9.-]/g, ''))
    if (Number.isFinite(n) && n !== 0) return n
  }
  return NaN
}

/** 쓰지 않는 컬럼과 빈 값을 걷어낸다. 빈 문자열 키가 전국 규모에서 수 MB 를 차지한다. */
function prune(row) {
  const out = {}
  for (const [key, value] of Object.entries(row)) {
    if (!KEEP.has(key)) continue
    if (value === null || value === undefined) continue
    const s = typeof value === 'string' ? value.trim() : value
    if (s === '') continue
    out[key] = s
  }
  return out
}

function idOf(row) {
  return String(row.prkplceNo ?? row['주차장관리번호'] ?? row.prkplceNm ?? row['주차장명'] ?? '')
}

function inKorea(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat > 32 && lat < 39.5 && lng > 124 && lng < 132.5
}

/**
 * 호출 규격을 탐색해 확정한다.
 *
 * 실패에서 배운 것을 즉시 반영해 후보를 쳐낸다.
 *   인증 실패     → 그 키 형태 전부 제외
 *   파라미터 거부 → 그 파라미터 전부 제외
 *   네트워크 실패 → 규격 문제가 아니므로 즉시 중단(더 두드리면 차단당한다)
 */
async function resolveSpec(base, key) {
  const guessed = apiFlavor(base)
  const flavors = [guessed, guessed === 'odcloud' ? 'classic' : 'odcloud']

  const badKeyModes = new Set()
  const badParams = new Set()
  const log = []

  for (const flavor of flavors) {
    for (const keyMode of KEY_MODES) {
      for (const jsonParam of JSON_PARAMS) {
        if (badKeyModes.has(keyMode) || badParams.has(jsonParam)) continue

        const spec = { flavor, keyMode, jsonParam, size: PROBE_SIZE }
        const label = flavor + ' / ' + keyMode + ' 키 / ' + (jsonParam ?? 'JSON 파라미터 없음')
        if (log.length > 0) await new Promise((r) => setTimeout(r, 600))

        try {
          const payload = await fetchPage(base, key, 1, spec, { attempts: 1 })
          if (rowsOf(payload).length > 0) return { spec, first: payload, log }
          log.push({ label, detail: '0건 — ' + JSON.stringify(payload).slice(0, 260) })
        } catch (err) {
          log.push({ label, detail: err.message })
          if (err.network) return { spec: null, log, network: true }
          if (err.auth) badKeyModes.add(keyMode)
          if (err.invalidParam) badParams.add(err.invalidParam)
          // XML 이 왔다는 건 인증·계열은 맞고 JSON 파라미터만 틀렸다는 뜻이다.
        }
      }
    }
  }
  return { spec: null, log }
}

async function main() {
  await loadEnvFile(path.join(process.cwd(), '.env.local'))
  await loadEnvFile(path.join(process.cwd(), '.dev.vars'))

  const key = process.env.PARKING_API_KEY
  const base = process.env.PARKING_API_BASE

  if (!key || !base) {
    console.error('✗ PARKING_API_KEY / PARKING_API_BASE 가 필요합니다.')
    console.error('  로컬: .env.local 에 넣으세요 (.env.example 참고)')
    console.error('  CI  : GitHub Secrets 에 등록하세요 (DEPLOY.md 8절)')
    process.exit(1)
  }

  console.log('주소:', new URL(base).origin + new URL(base).pathname)

  // 인증 이전에 연결 자체가 되는지부터 가른다. 여기서 막히면 키 문제가 아니다.
  try {
    const probe = await fetch(new URL(base).origin, { signal: AbortSignal.timeout(15000) })
    console.log('호스트 연결: OK (HTTP ' + probe.status + ')')
  } catch (err) {
    console.error('✗ 호스트에 연결하지 못했습니다:', describeError(err))
    console.error('  인증키가 아니라 네트워크·주소 문제입니다. 잠시 뒤 재실행하세요.')
    process.exit(1)
  }

  const { spec, first, log, network } = await resolveSpec(base, key)

  if (!spec) {
    console.error(network ? '✗ 탐색 중 연결이 끊겼습니다.' : '✗ 호출 규격을 찾지 못했습니다.')
    for (const line of log) console.error('  - ' + line.label + ' → ' + line.detail)
    process.exit(1)
  }

  console.log('확정된 호출 규격')
  console.log('  계열         :', spec.flavor === 'odcloud' ? 'odcloud (page/perPage)' : 'classic (pageNo/numOfRows)')
  console.log('  인증키       :', spec.keyMode === 'raw' ? '받은 문자열 그대로' : 'URL 인코딩')
  console.log('  JSON 파라미터:', spec.jsonParam ?? '없음')
  if (log.length > 0) console.log('  (앞선 시도 ' + log.length + '회)')
  console.log('  첫 레코드 컬럼:', Object.keys(rowsOf(first)[0]).slice(0, 8).join(', '))

  // 한 번에 많이 받을 수 있으면 그렇게 한다. 거부하면 탐색에 쓴 크기로 돌아간다.
  let pageSize = PROBE_SIZE
  let firstPayload = first
  try {
    const bulk = await fetchPage(base, key, 1, { ...spec, size: BULK_SIZE }, { attempts: 1 })
    if (rowsOf(bulk).length > rowsOf(first).length) {
      pageSize = BULK_SIZE
      firstPayload = bulk
    }
  } catch {
    // 큰 페이지를 거부하는 API 다. 작은 크기로 진행한다.
  }
  console.log('  페이지 크기  :', pageSize)

  const collected = []
  let dropped = 0

  for (let page = 1; page <= MAX_PAGES; page++) {
    const payload = page === 1 ? firstPayload : await fetchPage(base, key, page, { ...spec, size: pageSize })
    const rows = rowsOf(payload)

    for (const row of rows) {
      const lat = coord(row, ['latitude', '위도'])
      const lng = coord(row, ['longitude', '경도'])
      if (!inKorea(lat, lng)) {
        dropped++
        continue
      }
      collected.push(prune(row))
    }

    process.stdout.write('\r  page ' + page + ' … 수집 ' + collected.length.toLocaleString('ko-KR') + '건')
    if (rows.length < pageSize) break
  }
  process.stdout.write('\n')

  if (collected.length === 0) {
    console.error('✗ 수집 결과가 없습니다.')
    process.exit(1)
  }

  // 중복 제거 + 정렬 → 원본이 그대로면 출력도 그대로(불필요한 커밋 방지)
  const byId = new Map()
  for (const row of collected) byId.set(idOf(row) + '|' + row.latitude + '|' + row.longitude, row)
  const data = [...byId.values()].sort((a, b) => idOf(a).localeCompare(idOf(b), 'ko'))

  await mkdir(path.dirname(OUT_PATH), { recursive: true })
  const json = JSON.stringify({ totalCount: data.length, data })
  await writeFile(OUT_PATH, json, 'utf-8')

  const bytes = Buffer.byteLength(json)
  const mb = (bytes / 1024 / 1024).toFixed(1)
  console.log('✓ ' + data.length.toLocaleString('ko-KR') + '건 저장 → ' + OUT_PATH + ' (' + mb + ' MB)')
  if (dropped > 0) console.log('  좌표 없음/범위 밖 ' + dropped.toLocaleString('ko-KR') + '건 제외')
  if (collected.length !== data.length) {
    console.log('  중복 ' + (collected.length - data.length).toLocaleString('ko-KR') + '건 병합')
  }
  if (bytes > WARN_BYTES) {
    console.warn('')
    console.warn('⚠ ' + mb + ' MB 는 브라우저가 한 번에 파싱하기 버거운 크기입니다. 분할을 검토하세요.')
  }
}

main().catch((err) => {
  console.error('\n✗ 실패:', describeError(err))
  process.exit(1)
})
