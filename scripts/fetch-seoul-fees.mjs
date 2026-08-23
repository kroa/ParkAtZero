#!/usr/bin/env node
/**
 * 서울시 공영주차장 API 로 표준데이터의 빈 요금 칸을 채운다.
 *
 *   node scripts/fetch-seoul-fees.mjs [출력경로]
 *
 * 왜 필요한가
 *   「전국주차장정보표준데이터」에는 요금정보를 '유료'로 등록해 놓고 금액 칸은 비워 둔
 *   레코드가 620곳 있다. 그중 서울이 104곳인데, 서울시가 따로 운영하는 공영주차장 API
 *   에는 같은 주차장의 기본시간·기본요금·추가요금이 들어 있다.
 *   "홍제동 주차장이 왜 다 물음표냐" 는 지적의 일부가 여기서 풀린다.
 *
 * 새 주차장을 더하는 것이 아니라 기존 레코드의 빈 칸만 채운다.
 * 이름이나 지번주소로 1:1 로 붙는 것만 쓰고, 후보가 여럿이면서 요금이 갈리면 버린다.
 *
 * 서비스: GetParkInfo (서울 열린데이터광장, 공공누리 제1유형)
 * 필요한 환경변수: SEOUL_OPENAPI_KEY
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const SERVICE = 'GetParkInfo'
const SNAPSHOT = path.join('public', 'data', 'parkings.full.json')
const DEFAULT_OUT = path.join('public', 'data', 'seoul-fees.json')

async function loadEnvFile(file) {
  if (!existsSync(file)) return
  const text = await readFile(file, 'utf-8')
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const key = t.slice(0, eq).trim()
    if (!(key in process.env)) process.env[key] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
}

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** 이름에서 표기 차이를 걷어낸다: "남가좌2동 제1공영주차장(구)" ↔ "남가좌2동 제1공영" */
const normName = (s) =>
  String(s || '')
    .replace(/\((구|시|신)\)/g, '')
    .replace(/공영주차장|공영|주차장|노상|노외|부설/g, '')
    .replace(/[\s·,\-()]/g, '')
    .toLowerCase()

/** 지번주소를 '구|동|번지' 로. 표기가 달라도 같은 자리면 같은 열쇠가 된다. */
const addrKey = (s) => {
  const t = String(s || '').replace(/서울특별시|서울시|서울/g, '').trim()
  const m = /([가-힣0-9]+동|[가-힣0-9]+가)\s*([0-9]+(?:-[0-9]+)?)/.exec(t)
  const gu = /([가-힣]+구)/.exec(t)?.[1] ?? ''
  return m ? gu + '|' + m[1] + '|' + m[2] : ''
}

async function main() {
  await loadEnvFile(path.join(process.cwd(), '.env.local'))
  await loadEnvFile(path.join(process.cwd(), '.dev.vars'))
  const key = process.env.SEOUL_OPENAPI_KEY
  if (!key) {
    console.error('✗ SEOUL_OPENAPI_KEY 가 없습니다.')
    process.exit(1)
  }

  const first = await fetch('http://openapi.seoul.go.kr:8088/' + key + '/json/' + SERVICE + '/1/1/', {
    signal: AbortSignal.timeout(30000),
  })
  const head = (await first.json())[SERVICE]
  if (!head || (head.RESULT?.CODE && head.RESULT.CODE !== 'INFO-000')) {
    console.error('✗ API 오류: ' + (head?.RESULT?.MESSAGE ?? '알 수 없음'))
    process.exit(1)
  }
  const total = Number(head.list_total_count) || 0

  const api = []
  for (let s = 1; s <= total; s += 1000) {
    const res = await fetch(
      'http://openapi.seoul.go.kr:8088/' + key + '/json/' + SERVICE + '/' + s + '/' + Math.min(s + 999, total) + '/',
      { signal: AbortSignal.timeout(30000) },
    )
    api.push(...(((await res.json())[SERVICE] ?? {}).row ?? []))
  }
  console.log('서울시 공영주차장: ' + api.length + '건 (전체 ' + total + ')')

  const priced = api.filter((r) => num(r.PRK_CRG) > 0)
  const byName = new Map()
  const byAddr = new Map()
  for (const r of priced) {
    const n = normName(r.PKLT_NM)
    if (n) (byName.get(n) ?? byName.set(n, []).get(n)).push(r)
    const a = addrKey(r.ADDR)
    if (a) (byAddr.get(a) ?? byAddr.set(a, []).get(a)).push(r)
  }

  /** 후보의 요금이 모두 같을 때만 쓴다. 갈리면 버린다 — 틀린 금액보다 빈칸이 낫다. */
  const pick = (list) => {
    if (!list || list.length === 0) return null
    const uniq = [...new Set(list.map((r) => r.PRK_HM + '/' + r.PRK_CRG + '/' + r.ADD_UNIT_TM_MNT + '/' + r.ADD_CRG))]
    return uniq.length === 1 ? list[0] : null
  }

  const snapshot = JSON.parse(await readFile(SNAPSHOT, 'utf-8'))
  const rows = []
  for (const row of snapshot.data ?? []) {
    const addr = String(row.rdnmadr || row.lnmadr || '')
    if (!addr.startsWith('서울')) continue
    // 이미 금액이 있는 레코드는 건드리지 않는다.
    if (num(row.basicCharge) > 0 || num(row.addUnitCharge) > 0) continue
    /*
     * 요금정보가 <무료>인 레코드도 건드리지 않는다.
     * 금액 칸이 비어 있는 것이 맞는 값이라서다. 여기에 요금을 채우면 무료 주차장이
     * 유료로 뒤집힌다 — 남산공원 소월로(관광버스 전용 무료)가 5분 340원이 될 뻔했다.
     */
    if (String(row.parkingchrgeInfo ?? '').trim() === '무료') continue

    const gu = /서울특별시\s*(\S+구)/.exec(addr)?.[1] ?? ''
    const cands = (byName.get(normName(row.prkplceNm)) ?? []).filter((r) => !gu || String(r.ADDR || '').includes(gu))
    const hit = pick(cands) ?? pick(byAddr.get(addrKey(row.lnmadr || addr)))
    if (!hit) continue

    /*
     * 요일별 무료 정보도 함께 옮긴다. 표준데이터에는 없는 값이라 이것만으로도
     * '토요일은 0원' 같은 판정이 살아난다.
     */
    const notes = []
    if (/무료/.test(String(hit.SAT_CHGD_FREE_NM ?? ''))) notes.push('토요일 무료')
    if (/무료/.test(String(hit.LHLDY_NM ?? ''))) notes.push('공휴일 무료')

    rows.push({
      prkplceNo: String(row.prkplceNo ?? ''),
      prkplceNm: String(row.prkplceNm ?? ''),
      basicTime: String(num(hit.PRK_HM)),
      basicCharge: String(num(hit.PRK_CRG)),
      addUnitTime: String(num(hit.ADD_UNIT_TM_MNT)),
      addUnitCharge: String(num(hit.ADD_CRG)),
      dayCmmtkt: String(num(hit.DLY_MAX_CRG)),
      extraNote: notes.join(' / '),
      matchedName: String(hit.PKLT_NM ?? ''),
    })
  }

  await writeFile(
    process.argv[2] ?? DEFAULT_OUT,
    JSON.stringify(
      {
        source: '서울특별시 공영주차장 정보 (GetParkInfo)',
        sourceUrl: 'https://data.seoul.go.kr/dataList/OA-13122/S/1/datasetView.do',
        license: '공공누리 제1유형 (출처표시) · 서울특별시',
        fetchedOn: new Date().toISOString().slice(0, 10),
        note: '표준데이터의 빈 요금 칸만 채운다. 새 주차장을 더하지 않는다.',
        rows,
      },
      null,
      1,
    ),
    'utf-8',
  )
  console.log('요금을 채울 수 있는 곳: ' + rows.length + '곳 → ' + (process.argv[2] ?? DEFAULT_OUT))
}

main().catch((err) => {
  console.error('✗ 실패:', err.message)
  process.exit(1)
})
