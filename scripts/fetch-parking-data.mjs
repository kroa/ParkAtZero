#!/usr/bin/env node
/**
 * 전국주차장정보표준데이터 전체를 받아 public/data/parkings.full.json 으로 굽는다.
 *
 *   npm run data:fetch
 *
 * 필요한 환경변수 (.env.local 또는 CI 시크릿):
 *   PARKING_API_KEY   공공데이터포털 일반 인증키(Decoding)
 *   PARKING_API_BASE  https://api.odcloud.kr/api/15012896/v1/uddi:<UUID>
 *
 * 왜 런타임 API 가 아니라 빌드 타임 스냅샷인가
 *   - 이 데이터셋 갱신주기는 '반기'다. 매 요청마다 원본을 부를 이유가 없다.
 *   - 개발계정 일일 트래픽은 10,000회다. 사용자가 늘면 그 한도에 화면이 먼저 죽는다.
 *     월 1회 수집이면 한 달에 수십 회만 쓴다.
 *   - 정적 파일이면 Cloudflare 엣지가 brotli 로 눌러 보내고 브라우저가 캐시한다.
 *     앱의 Local-First 구조와 그대로 맞물린다.
 *
 * 출력은 결정적(deterministic)이다. 원본이 그대로면 파일도 같아서
 * 자동 갱신 워크플로우가 의미 없는 커밋을 만들지 않는다.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const OUT_PATH = path.join('public', 'data', 'parkings.full.json')
const PER_PAGE = 1000
const MAX_PAGES = 300
/** 이 크기를 넘으면 경고한다 — 브라우저가 한 번에 파싱하기 버거워지는 지점. */
const WARN_BYTES = 12 * 1024 * 1024

/**
 * 앱이 실제로 읽는 컬럼만 남긴다(src/lib/normalize.ts 의 FIELD 와 일치).
 * 표준데이터에는 앱이 쓰지 않는 컬럼이 여럿 있고, 전국 규모에서는 그 무게가 무시 못 할 수준이다.
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
 * 공공데이터포털 오픈API 는 계열이 둘이고 파라미터 이름이 다르다.
 *
 *   odcloud   api.odcloud.kr/api/<id>/v1/uddi:<uuid>   page / perPage / returnType
 *   classic   api(s).data.go.kr/openapi/<서비스명>      pageNo / numOfRows / type
 *
 * 어느 쪽 주소를 받아 오는지는 데이터셋마다 달라서, 호스트로 판별해 맞는 이름을 쓴다.
 */
function apiFlavor(base) {
  return new URL(base).hostname.includes('odcloud.kr') ? 'odcloud' : 'classic'
}

/**
 * 인증키는 Encoding / Decoding 두 형태로 발급되는데, API 마다 한쪽만 받는 경우가 흔하다.
 *  - 'encoded' : 원문 키를 우리가 URL 인코딩해서 보낸다 (Decoding 키를 받았을 때 맞는 형태)
 *  - 'raw'     : 받은 문자열을 그대로 붙인다 (이미 %2B 등이 섞인 Encoding 키일 때 맞는 형태)
 * 어느 쪽인지 사용자가 알기 어려우므로 둘 다 시도한다.
 */
function buildUrl(base, key, page, flavor, keyMode) {
  const url = new URL(base)
  // 사용자가 ?serviceKey=... 까지 통째로 붙여 넣는 경우가 흔하다. 우리가 다시 세팅하므로 지운다.
  url.searchParams.delete('serviceKey')

  if (flavor === 'odcloud') {
    url.searchParams.set('page', String(page))
    url.searchParams.set('perPage', String(PER_PAGE))
    url.searchParams.set('returnType', 'JSON')
  } else {
    url.searchParams.set('pageNo', String(page))
    url.searchParams.set('numOfRows', String(PER_PAGE))
    // 구형 계열은 JSON 을 요구하는 파라미터 이름이 API 마다 다르다(type/dataType/resultType).
    // 모르는 파라미터는 대개 무시되므로 넷을 함께 보내 어느 쪽이든 걸리게 한다.
    url.searchParams.set('type', 'json')
    url.searchParams.set('dataType', 'JSON')
    url.searchParams.set('resultType', 'json')
    url.searchParams.set('returnType', 'JSON')
  }

  // searchParams 로 넣으면 항상 인코딩되므로, raw 모드는 문자열로 직접 붙인다.
  const sep = url.search ? '&' : '?'
  const value = keyMode === 'raw' ? key : encodeURIComponent(key)
  return url.toString() + sep + 'serviceKey=' + value
}

/** 구형 API 는 HTTP 200 에 에러를 실어 보낸다. 그 메시지를 그대로 드러내야 원인을 알 수 있다. */
function assertNoApiError(payload, text) {
  const header = payload?.response?.header
  const code = header?.resultCode ?? header?.returnReasonCode
  if (code !== undefined && String(code) !== '00' && String(code) !== '0') {
    throw new Error(
      'API 오류 ' + code + ': ' + (header?.resultMsg ?? header?.returnAuthMsg ?? '(메시지 없음)'),
    )
  }
  if (typeof payload?.code === 'string' && payload.code !== 'success') {
    throw new Error('API 오류: ' + payload.code + ' ' + (payload.msg ?? ''))
  }
  if (payload === null || payload === undefined) {
    throw new Error('응답을 JSON 으로 해석하지 못했습니다: ' + text.slice(0, 200))
  }
}

async function fetchPage(base, key, page, flavor, keyMode) {
  const url = buildUrl(base, key, page, flavor, keyMode)

  // 공공 API 는 간헐적으로 5xx 를 뱉는다. 몇 번은 조용히 다시 시도한다.
  let lastError
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      const text = await res.text()

      if (!res.ok) {
        // 인증키 문제는 재시도해도 소용없다. 바로 세워서 원인을 보여준다.
        if (res.status === 401 || res.status === 403) {
          throw Object.assign(new Error('인증 실패(HTTP ' + res.status + ') ' + text.slice(0, 160)), { fatal: true })
        }
        throw new Error('HTTP ' + res.status + ' ' + res.statusText + ' — ' + text.slice(0, 200))
      }

      let payload
      try {
        payload = JSON.parse(text)
      } catch {
        // XML 로 에러를 돌려주는 경우가 많다. 본문을 그대로 보여줘야 진단이 된다.
        throw Object.assign(
          new Error('JSON 이 아닌 응답을 받았습니다. 엔드포인트 주소를 확인하세요. ' + text.slice(0, 400)),
          { fatal: true },
        )
      }

      assertNoApiError(payload, text)
      return payload
    } catch (err) {
      lastError = err
      if (err.fatal) break
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1500))
    }
  }
  throw new Error('page ' + page + ' 실패: ' + lastError.message)
}

function rowsOf(payload) {
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.response?.body?.items)) return payload.response.body.items
  if (Array.isArray(payload?.response?.body?.items?.item)) return payload.response.body.items.item
  return []
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

  /*
   * 주소 형태(계열)와 인증키 형태(Encoding/Decoding)는 데이터셋마다 다르고,
   * 사용자가 어느 쪽을 받았는지 알기 어렵다. 그래서 1페이지로 네 조합을 훑어
   * 실제로 데이터가 오는 조합을 찾아낸다. 이후 페이지는 그 조합으로만 부른다.
   */
  const guessed = apiFlavor(base)
  const flavors = [guessed, guessed === 'odcloud' ? 'classic' : 'odcloud']
  const attempts = []
  let flavor = null
  let keyMode = null
  let first = null

  outer: for (const f of flavors) {
    for (const km of ['encoded', 'raw']) {
      try {
        const payload = await fetchPage(base, key, 1, f, km)
        if (rowsOf(payload).length > 0) {
          flavor = f
          keyMode = km
          first = payload
          break outer
        }
        attempts.push(f + ' + ' + km + ' 키 → 0건')
      } catch (err) {
        attempts.push(f + ' + ' + km + ' 키 → ' + err.message)
      }
    }
  }

  if (!first) {
    console.error('✗ 어떤 조합으로도 데이터를 받지 못했습니다. 시도한 내역:')
    for (const line of attempts) console.error('  - ' + line)
    console.error('')
    console.error('  확인해 볼 것')
    console.error('  1) 활용신청 직후라면 인증키 반영에 시간이 걸립니다(보통 수십 분). 잠시 뒤 재실행하세요.')
    console.error('  2) PARKING_API_BASE 가 데이터셋 웹페이지 주소가 아니라 API 엔드포인트인지 확인하세요.')
    console.error('     (마이페이지 → 오픈API → 개발계정 → 해당 API → 상세보기의 요청 주소)')
    process.exit(1)
  }

  const firstRows = rowsOf(first)
  console.log('엔드포인트 계열:', flavor === 'odcloud' ? 'odcloud (page/perPage)' : 'classic (pageNo/numOfRows)')
  console.log('인증키 형태:', keyMode === 'raw' ? '받은 문자열 그대로(Encoding 키)' : 'URL 인코딩(Decoding 키)')
  if (attempts.length > 0) console.log('  (앞선 시도: ' + attempts.length + '회 실패 후 성공)')
  console.log('첫 레코드 컬럼:', Object.keys(firstRows[0]).slice(0, 10).join(', '))

  const collected = []
  let dropped = 0

  for (let page = 1; page <= MAX_PAGES; page++) {
    const payload = page === 1 ? first : await fetchPage(base, key, page, flavor, keyMode)
    const rows = rowsOf(payload)

    for (const row of rows) {
      const lat = coord(row, ['latitude', '위도'])
      const lng = coord(row, ['longitude', '경도'])
      // 좌표가 없거나 국내 밖이면 지도에 못 올린다. 앱이 어차피 버리므로 여기서 뺀다.
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 32 || lat > 39.5 || lng < 124 || lng > 132.5) {
        dropped++
        continue
      }
      collected.push(prune(row))
    }

    process.stdout.write(
      '\r  page ' + page + ' … 수집 ' + collected.length.toLocaleString('ko-KR') + '건 (제외 ' + dropped + ')',
    )
    if (rows.length < PER_PAGE) break
  }
  process.stdout.write('\n')

  if (collected.length === 0) {
    console.error('✗ 받은 데이터가 없습니다. 엔드포인트와 인증키를 확인하세요.')
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
    console.warn('⚠ 파일이 ' + mb + ' MB 입니다.')
    console.warn('  브라우저가 한 번에 파싱하기 버거운 크기라 지역별 분할을 검토하세요.')
  }
}

main().catch((err) => {
  console.error('\n✗ 실패:', err.message)
  process.exit(1)
})
