#!/usr/bin/env node
/**
 * 서울시 주차정보안내시스템에서 면수와 운영 구분을 받아 온다.
 *
 * 왜 필요한가
 *
 *  1. 면수. 우리가 쓰는 「서울시 공영주차장 안내 정보」(OA-13122)는 노상주차장의
 *     주차면 수가 전부 1 이다. 우리 서울 레코드 419건 중 노상 235건이 모두 1면인데,
 *     노외 184건은 하나도 그렇지 않다. 공개 API 의 TPKCT 값 자체가 1 이라 우리 매핑을
 *     고쳐도 소용이 없다. 마포구시설관리공단 공식 현황표와 대조하면 망원시장 노상은
 *     15면, 월드컵시장은 13면, 망원1 노상은 57면이다. 1면짜리 주차장으로 안내하면
 *     사람이 헛걸음한다.
 *
 *  2. 거주자우선. 같은 공개 API 의 OPER_SE_NM 으로는 '거주자 우선 주차장'만 잡히고,
 *     거주자우선주차제로 운영하면서 방문자에게 시간제로 여는 곳(operation_rule=3)은
 *     전혀 표현되지 않는다. 실제로 망원1-1·망원2-1 이 그렇다. 둘 다 마포구시설관리공단
 *     「거주자우선주차장 시설현황」에 등재돼 있는데 우리는 24시간 일반 유료 주차장으로
 *     내보내고 있었다. 사용자가 현장에서 겪고 알려 주었다.
 *
 * ⚠ 이 엔드포인트는 공개 Open API 가 아니라 서울시 공식 사이트(서울주차정보 앱의
 *   백엔드)의 내부 AJAX 경로다. 이용약관도 SLA 도 없고 예고 없이 바뀔 수 있다.
 *   사용자가 사용을 명시적으로 승인해서 쓴다. 끊기면 이 파일만 오래된 채로 남고
 *   앱은 기존 값으로 동작한다 — 빌드는 깨지지 않는다.
 *
 * 받는 것만 받는다. 실시간 주차대수(cur_parking)는 저장하지 않는다. 빌드 시점 값은
 * 배포되는 순간 낡아서, 지금 자리가 있는 것처럼 보이면 없느니만 못하다.
 *
 * 사용: node scripts/fetch-seoul-portal.mjs
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const BASE = 'https://parking.seoul.go.kr'
const SOURCE = BASE + '/search/parking/detail.do'
const IN = path.join('public', 'data', 'seoul-lots.json')
const OUT = path.join('public', 'data', 'seoul-portal.json')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
/** 상대 서버에 부담을 주지 않도록 요청 사이에 두는 간격(ms). */
const GAP = 250

/**
 * 방문자에게 보여 줄 주의 문구.
 *
 * '거주자우선' 이라고 쓰면 안 된다. timeRules 의 제한 추출기가 그 표현을 '거주자 전용'
 * 으로 읽어 일반 차량 이용 불가로 막아 버린다. 그런데 이 주차장들은 방문자가 실제로
 * 댈 수 있다 — 망원1-1 은 66면 중 6대만 차 있었다. 막으면 쓸 수 있는 61곳을 잘못
 * 지우게 된다. 그래서 같은 사실을 막히지 않는 표현으로 적는다.
 *
 * 서울시가 쓰는 원문("운영시간 외 거주자우선주차구역으로 운영")을 그대로 옮기면
 * 역시 막힌다. 실제로 시험해서 확인했다.
 */
const RESIDENT_NOTE = '거주자 배정 구획이 있어 방문자가 댈 자리가 적을 수 있습니다'

/** operation_rule 의 뜻. 서울시가 코드표를 공개하지 않아 역검증으로 확인했다. */
const RULE = {
  1: null, //     일반 시간제
  2: null, //     거주자 전용 — 표준데이터에 이미 '거주자 전용'으로 들어와 있다
  3: RESIDENT_NOTE, // 거주자우선제로 운영하되 방문자에게 시간제로 여는 곳
  4: null, //     버스 전용 — 표준데이터에 이미 들어와 있다
  5: null, //     특수(버스 혼용)
}

async function session() {
  const res = await fetch(BASE + '/search/parking/main.do', { headers: { 'User-Agent': UA } })
  const raw = res.headers.getSetCookie?.() ?? []
  return raw.map((c) => c.split(';')[0]).join('; ')
}

async function detail(code, cookie) {
  const res = await fetch(SOURCE, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'X-Requested-With': 'XMLHttpRequest',
      Referer: BASE + '/search/parking/main.do',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Cookie: cookie,
    },
    body: new URLSearchParams({ code: String(code), infra_type: 'PK' }).toString(),
  })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const body = await res.json()
  if (String(body?.result_state) !== '0000' || typeof body?.res_value !== 'object') {
    throw new Error('result_state ' + body?.result_state)
  }
  return body.res_value
}

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? Math.round(n) : 0
}

async function main() {
  const src = JSON.parse(await readFile(IN, 'utf-8'))
  const lots = Array.isArray(src?.rows) ? src.rows : []
  if (lots.length === 0) throw new Error(IN + ' 에 rows 가 없습니다. fetch-seoul-lots 를 먼저 돌리세요.')

  const cookie = await session()
  if (!cookie) throw new Error('세션 쿠키를 받지 못했습니다.')

  const rows = []
  let failed = 0
  let capFix = 0
  let noted = 0
  let liveCount = 0

  for (const lot of lots) {
    const code = String(lot.prkplceNo ?? '').replace('PZ-SEOUL-', '')
    if (!code) continue
    let v
    try {
      v = await detail(code, cookie)
    } catch {
      failed++
      await new Promise((r) => setTimeout(r, GAP))
      continue
    }

    const capacity = num(v.capacity)
    const rule = num(v.operation_rule)
    const note = RULE[rule] ?? null
    const ours = num(lot.prkcmprt)

    /*
     * 면수는 우리 값과 다를 때만 싣는다. 같은 값을 실어 봐야 파일만 커지고,
     * 무엇이 고쳐졌는지도 안 보인다.
     */
    const row = { prkplceNo: lot.prkplceNo, prkplceNm: lot.prkplceNm }
    if (capacity > 0 && capacity !== ours) {
      row.capacity = capacity
      capFix++
    }
    if (note) {
      row.extraNote = note
      noted++
    }

    /*
     * 실시간 주차대수를 믿고 물어볼 수 있는 곳만 표시해 둔다.
     *
     * que_status 가 '연계됨'이어도 실제 값은 몇 달 전 것이 남아 있는 곳이 있다.
     * 갱신 시각이 아예 없는 곳도 39곳이다. 그런 곳까지 앱이 물어보면 응답은
     * 버려지고 요청만 낭비된다. 여기서 한 번 걸러 목록을 만든다.
     * 실제 신선도 판단은 /api/live 가 요청 시점에 다시 한다 — 이 목록은
     * 빌드 시점 기준이라 그사이 끊겼을 수 있다.
     */
    if (String(v.que_status) === '1' && String(v.cur_parking_time ?? '').trim()) {
      const cur = num(v.cur_parking)
      if (capacity > 0 && cur >= 0 && cur <= capacity) {
        row.live = true
        liveCount++
      }
    }

    if (row.capacity || row.extraNote || row.live) rows.push(row)

    await new Promise((r) => setTimeout(r, GAP))
  }

  const out = {
    source: '서울시 주차정보안내시스템(서울주차정보)',
    sourceUrl: BASE + '/search/parking/main.do',
    note: '공개 Open API 가 아닌 내부 조회 경로. 예고 없이 바뀔 수 있다.',
    fetchedOn: new Date().toISOString().slice(0, 10),
    rows,
  }
  await writeFile(OUT, JSON.stringify(out, null, 1) + '\n', 'utf-8')
  console.log(
    '서울 주차정보안내시스템: ' + lots.length + '건 조회 · 실패 ' + failed +
      ' · 면수 교정 ' + capFix + '건 · 거주자 주의 ' + noted + '건 · 실시간 ' + liveCount + '곳 → ' + OUT,
  )
}

main().catch((err) => {
  console.error('✗ 실패:', err.message)
  process.exit(1)
})
