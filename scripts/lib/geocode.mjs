/**
 * 한국 주소를 좌표로 바꾼다. 카카오 로컬 API 를 쓴다.
 *
 * 지자체가 공개하는 주차장 표에는 주소만 있고 좌표가 없는 경우가 아주 많다.
 * 그 표들을 쓰려면 지오코딩이 필요한데, 정확도가 곧 앱의 품질이다.
 *
 * ── 왜 결과를 검증하는가 ────────────────────────────────────
 * 지오코더는 못 찾으면 대개 '가까운 것'을 돌려준다. OSM Nominatim 은
 * '성동구 마장동 463-2' 를 마장동 중심점으로 돌려주는데 실제 위치와 470m 떨어져 있다.
 * 카카오도 번지를 못 찾으면 동 단위로 넓혀서 답을 준다.
 * 주차장 안내에서 수백 미터는 없는 것보다 나쁘다 — 찾아갔는데 주차장이 없다.
 *
 * 그래서 응답이 요청한 주소와 정말 같은지 확인하고, 아니면 버린다.
 *   지번주소: 법정동 + 본번 + 부번이 모두 같아야 한다
 *   도로명주소: 도로명 + 건물본번이 같아야 한다
 *
 * 필요한 환경변수: KAKAO_REST_API_KEY
 */

const ENDPOINT = 'https://dapi.kakao.com/v2/local/search/address.json'

const squash = (s) => String(s ?? '').split(/[ \t\r\n]+/).join(' ').trim()

/**
 * 주소 끝에 붙은 범위 표현을 떼어 낸다.
 * 지자체 표에는 '동구 계림동 289-2 외 1필지', '대인동 327-1 일대', '동명동 25 부근'
 * 처럼 번지 뒤에 말이 붙는 경우가 흔하다. 그대로 두면 번지를 못 읽어 통째로 버려진다.
 */
function trimSuffix(s) {
  return squash(s).replace(/\s*(?:외\s*\d+\s*(?:필지|개소)?|일대|일원|부근|인근|앞|주변)\s*$/g, '').trim()
}

/**
 * 지번주소에서 법정동·본번·부번을 뽑는다.
 * '성동구 마장동 463-2' → { dong: '마장동', main: '463', sub: '2' }
 *
 * 동 이름을 숫자 기준으로 자르면 안 된다. '남산동2가' 가 '남산동' 이 되어 어긋난다.
 * 뒤쪽 번지만 떼어 내고 남은 마지막 낱말을 쓴다.
 */
export function readJibun(addr) {
  const clean = trimSuffix(addr)
  const m = /(\d+)(?:\s*-\s*(\d+))?\s*(?:번지)?\s*$/.exec(clean)
  if (!m) return null
  const head = clean.replace(/\s*(?:산\s*)?\d+(?:\s*-\s*\d+)?\s*(?:번지)?\s*$/, '')
  const last = head.split(/\s+/).pop() ?? ''
  return { dong: /[동리가]$/.test(last) ? last : '', main: m[1], sub: m[2] ?? '0' }
}

/**
 * 도로명주소에서 도로명과 건물본번을 뽑는다.
 * '권선구 세권로 243(권선동)' → { road: '세권로', main: '243' }
 */
export function readRoad(addr) {
  const clean = trimSuffix(squash(addr).replace(/\([^)]*\)\s*$/, ''))
  const m = /([가-힣A-Za-z0-9]+(?:로|길))\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(clean)
  if (!m) return null
  return { road: m[1], main: m[2], sub: m[3] ?? '0' }
}

/** 국내 좌표 범위인가 */
export function inKorea(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat > 33 && lat < 39 && lng > 124 && lng < 132
}

/**
 * 주소 하나를 좌표로. 확인에 실패하면 null.
 *
 * @param {string} addr  '광주광역시 동구 동명동 159-7' 처럼 시도까지 붙인 주소
 * @param {string} key   카카오 REST API 키
 * @returns {Promise<{lat:number,lng:number,matched:string}|null>}
 */
export async function geocode(addr, key) {
  const wantJibun = readJibun(addr)
  const wantRoad = readRoad(addr)
  // 어느 쪽으로도 번지를 못 읽으면 검증할 방법이 없다. 동 중심점을 받게 되므로 포기한다.
  if (!wantJibun && !wantRoad) return null

  /*
   * 정리한 주소로 묻는다.
   *
   * '동구 계림동 289-2 외 1필지' 를 그대로 보내면 카카오가 못 읽어서 빈손으로 온다.
   * 우리가 번지를 읽어 낼 수 있는 형태로 다듬어 보내야 검증까지 이어진다.
   */
  const query = trimSuffix(addr.replace(/\([^)]*\)\s*$/, ''))
  const res = await fetch(ENDPOINT + '?analyze_type=exact&size=10&query=' + encodeURIComponent(query), {
    headers: { Authorization: 'KakaoAK ' + key },
  })
  if (!res.ok) throw new Error('지오코딩 HTTP ' + res.status)
  const docs = (await res.json()).documents ?? []

  for (const d of docs) {
    const lat = Number(d.y)
    const lng = Number(d.x)
    if (!inKorea(lat, lng)) continue

    const a = d.address
    if (wantJibun && a) {
      const dongOk = !wantJibun.dong || String(a.region_3depth_name ?? '') === wantJibun.dong
      const mainOk = String(a.main_address_no ?? '') === wantJibun.main
      const subOk = wantJibun.sub === '0' || String(a.sub_address_no ?? '') === wantJibun.sub
      if (dongOk && mainOk && subOk) return { lat, lng, matched: a.address_name }
    }

    const r = d.road_address
    if (wantRoad && r) {
      const roadOk = String(r.road_name ?? '') === wantRoad.road
      const mainOk = String(r.main_building_no ?? '') === wantRoad.main
      if (roadOk && mainOk) return { lat, lng, matched: r.address_name }
    }
  }
  return null
}

/**
 * 여러 주소를 차례로 지오코딩한다. 카카오는 초당 요청 제한이 있어 간격을 둔다.
 *
 * @param {Array<{key:string,addr:string}>} items
 * @param {string} apiKey
 * @param {(done:number,total:number,found:number)=>void} [onProgress]
 */
export async function geocodeAll(items, apiKey, onProgress) {
  const out = new Map()
  let found = 0
  let done = 0
  for (const it of items) {
    try {
      const hit = await geocode(it.addr, apiKey)
      if (hit) {
        out.set(it.key, hit)
        found++
      }
    } catch (err) {
      console.warn('  ! ' + it.addr + ': ' + err.message)
    }
    await new Promise((r) => setTimeout(r, 60))
    done++
    if (onProgress && done % 100 === 0) onProgress(done, items.length, found)
  }
  return out
}
