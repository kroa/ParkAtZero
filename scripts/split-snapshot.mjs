#!/usr/bin/env node
/**
 * 전국 스냅샷을 지리 격자로 쪼갠다. 빌드 직전에 돈다.
 *
 * 왜 쪼개나
 *   전국 17,500곳을 담은 11.6MB 파일은 저사양 단말에서 내려받고 JSON 으로 푸는 데만
 *   2초 넘게 메인 스레드를 잡는다. 그 사이 사용자는 예시 데이터를 보고 있어야 한다.
 *   그런데 화면에 필요한 건 언제나 '지금 보고 있는 곳 반경 몇 km' 뿐이다.
 *   0.25도(약 28km) 격자로 나누면 반경 10km 화면에 필요한 것은 보통 6칸, 1MB 안쪽이다.
 *
 * 산출물은 dist 에만 들어간다. 저장소에는 원본 스냅샷 하나만 두고, 쪼갠 결과는
 * 언제든 다시 만들 수 있으므로 커밋하지 않는다.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const SOURCE = path.join('public', 'data', 'parkings.full.json')
/*
 * 표준데이터를 보완하는 자료들.
 *
 *  supplements.json — 관리기관 공식 안내를 보고 손으로 채운 것 (출처·확인일자 필수)
 *  hangang.json     — 서울 열린데이터광장 오픈API 로 받은 한강공원 주차장 30곳.
 *                     표준데이터에는 한 곳도 올라 있지 않다.
 *  emart.json       — 이마트·트레이더스 154곳. 대형마트 부설주차장은 표준데이터가
 *                     사실상 공영 전용이라 통째로 빠져 있다.
 */
const SUPPLEMENT_FILES = [
  path.join('src', 'data', 'supplements.json'),
  path.join('public', 'data', 'hangang.json'),
  path.join('public', 'data', 'emart.json'),
  path.join('public', 'data', 'outlets.json'),
  path.join('public', 'data', 'lotte.json'),
  path.join('public', 'data', 'homeplus.json'),
  path.join('public', 'data', 'seoul-lots.json'),
  path.join('public', 'data', 'daegu.json'),
  path.join('public', 'data', 'bucheon.json'),
  path.join('public', 'data', 'gwangju.json'),
  path.join('public', 'data', 'region-lots.json'),
  path.join('public', 'data', 'gyeonggi.json'),
  path.join('public', 'data', 'open-facility.json'),
]
const OUT_DIR = path.join('public', 'data', 'cells')
/*
 * 색인은 격자 칸과 다른 폴더에 둔다.
 *
 * 칸 파일은 이름에 내용 해시가 붙어 영구 캐시(immutable)로 두고, 색인만 짧게 캐시한다.
 * 같은 폴더에 있으면 _headers 의 /data/cells/* 규칙이 색인까지 영구 캐시로 만들어
 * 데이터를 고쳐도 재방문자에게 옛 값이 그대로 나간다.
 */
const INDEX_FILE = path.join('public', 'data', 'cell-index.json')
/** 격자 한 칸의 크기(도). 0.25도 ≈ 28km. */
const CELL_SIZE = 0.25

export function cellKey(lat, lng, size = CELL_SIZE) {
  return Math.floor(lat / size) + '_' + Math.floor(lng / size)
}

const kbOf = (json) => Math.round(Buffer.byteLength(json) / 1024).toLocaleString('ko-KR') + 'KB'

async function main() {
  if (!existsSync(SOURCE)) {
    console.log('스냅샷이 없어 격자 분할을 건너뜁니다 (' + SOURCE + ')')
    return
  }

  const payload = JSON.parse(await readFile(SOURCE, 'utf-8'))
  const rows = Array.isArray(payload?.data) ? payload.data : []
  if (rows.length === 0) {
    console.error('✗ 스냅샷에 데이터가 없습니다.')
    process.exit(1)
  }

  /*
   * 표준데이터에 빠져 있는 주차장을 여기서 합친다.
   *
   * 「전국주차장정보표준데이터」는 지자체가 자율로 등록하는 자료라, 실제로 존재하고
   * 이용자도 많은 주차장이 통째로 빠진다(서울 25개 자치구 중 구청 청사가 등록된 곳은 10곳).
   * 보완표의 행은 표준데이터와 같은 모양이라 normalize 가 그대로 읽는다.
   * 이름·좌표가 겹치면 표준데이터를 그대로 두고 보완 행을 버린다 — 원본이 우선이다.
   */
  /*
   * 빈 요금 칸을 채운다.
   *
   * 표준데이터에는 요금정보를 '유료'로 등록해 놓고 금액 칸은 비워 둔 레코드가 620곳
   * 있다. 그중 서울 일부는 서울시 공영주차장 API 에 같은 주차장의 금액이 들어 있다.
   * 새 주차장을 더하는 것이 아니라 이미 있는 레코드의 빈 칸만 채운다 —
   * 이미 금액이 있으면 손대지 않는다.
   */
  const FEE_FILES = [
    path.join('public', 'data', 'seoul-fees.json'),
    path.join('public', 'data', 'bucheon-fees.json'),
    path.join('public', 'data', 'seoul-official-hours.json'),
  ]
  for (const file of FEE_FILES) {
    if (!existsSync(file)) continue
    const fix = JSON.parse(await readFile(file, 'utf-8'))
    const byKey = new Map(
      (Array.isArray(fix?.rows) ? fix.rows : []).map((r) => [String(r.prkplceNo) + '|' + String(r.prkplceNm), r]),
    )
    let filled = 0
    let noted = 0
    for (const r of rows) {
      const hit = byKey.get(String(r.prkplceNo ?? '') + '|' + String(r.prkplceNm ?? ''))
      if (!hit) continue
      const money = (v) => Number(String(v ?? '').replace(/[^0-9.]/g, '')) || 0
      // 요금정보가 '무료'면 빈 금액 칸이 맞는 값이다. 채우면 무료가 유료로 뒤집힌다.
      if (String(r.parkingchrgeInfo ?? '').trim() === '무료') continue

      /*
       * 요일 정보는 금액이 이미 있어도 옮긴다.
       *
       * '공휴일 무료개방'은 표준데이터에 아예 없는 값이라, 금액이 적혀 있다고
       * 건너뛰면 요금표가 제대로 든 유료 주차장은 영영 공휴일 무료로 판정되지 않는다.
       * 금액 칸만 덮어쓰지 않으면 된다.
       */
      if (hit.extraNote) {
        r.spcmnt = [r.spcmnt, hit.extraNote].filter(Boolean).join(' / ')
        noted++
      }

      /*
       * 요일별 운영시간을 관리기관 고시로 덮는다.
       *
       * 표준데이터는 공휴일 칸에 토요일 시간을 그대로 복사해 놓은 경우가 많다.
       * 여의도공원 노상은 표준데이터가 공휴일 09:00-15:00 인데 서울시 고시는
       * '무료개방' 이다. 금액과 무관하므로 요금이 이미 있어도 덮는다.
       */
      if (hit.hours) {
        Object.assign(r, hit.hours)
        noted++
      }

      if (money(r.basicCharge) > 0 || money(r.addUnitCharge) > 0) continue
      if (money(hit.basicCharge) > 0 || money(hit.addUnitCharge) > 0) {
        r.basicTime = hit.basicTime
        r.basicCharge = hit.basicCharge
        r.addUnitTime = hit.addUnitTime
        r.addUnitCharge = hit.addUnitCharge
        if (money(hit.dayCmmtkt) > 0) r.dayCmmtkt = hit.dayCmmtkt
      }
      filled++
    }
    console.log('요금 채움: ' + filled + '건 · 요일 정보 채움: ' + noted + '건 (' + file + ')')
  }

  /*
   * 기관 단위 조례 규정을 덮는다.
   *
   * 표준데이터에는 요금과 요일 규정이 통째로 빈 기관이 있다. 여수시 노외 32곳,
   * 안산시 52곳이 그렇다. 그런 곳도 조례에는 요금표와 '공휴일은 무료를 원칙으로
   * 한다' 같은 규정이 분명히 적혀 있다. 주차장마다 다른 것은 담지 않고, 기관 전체에
   * 같게 적용되는 것만 담는다. excludeNames 는 조례의 예외로 확인된 주차장이다.
   */
  const RULES_FILE = path.join('public', 'data', 'institution-rules.json')
  if (existsSync(RULES_FILE)) {
    const { rules = [] } = JSON.parse(await readFile(RULES_FILE, 'utf-8'))
    for (const rule of rules) {
      let applied = 0
      for (const r of rows) {
        if (String(r.institutionNm ?? '').trim() !== rule.institution) continue
        if (rule.types && !rule.types.includes(String(r.prkplceType ?? '').trim())) continue
        const name = String(r.prkplceNm ?? '')
        if ((rule.excludeNames ?? []).some((x) => name.includes(x))) continue

        /*
         * includeNames 는 <이 이름들만> 이라는 뜻이다.
         *
         * 같은 기관 안에서도 일부만 무료인 곳이 있다. 의왕도시공사 유료 24곳 중
         * 공휴일 무료가 확인되는 건 9곳뿐이고, 조례에 "다만 노외주차장과 행락지
         * 주차장은 공휴일에도 징수할 수 있다"는 단서가 붙어 있다. 기관 전체에
         * 걸면 유료 15곳을 무료로 잘못 안내하게 된다.
         */
        if (rule.includeNames && !rule.includeNames.some((x) => name.includes(x))) continue
        // 요금정보가 '무료'인 곳에 요금을 넣으면 무료 주차장이 유료로 뒤집힌다.
        if (String(r.parkingchrgeInfo ?? '').trim() === '무료') continue

        /*
         * onlyFeeEmpty 는 '금액이 비어 있는 레코드만' 이라는 뜻이다.
         *
         * 조례 요금표로 빈칸을 메우는 규칙(여수·경주)은 이미 금액이 든 레코드까지
         * 건드리면 안 된다. 운영시간까지 덮어써서 멀쩡한 데이터를 망친다.
         * 반대로 부산 구별 징수시간 규칙은 금액이 있는 레코드에 적용해야 하므로
         * 이 플래그를 쓰지 않는다.
         */
        const money = (v) => Number(String(v ?? '').replace(/[^0-9.]/g, '')) || 0
        if (rule.onlyFeeEmpty && (money(r.basicCharge) > 0 || money(r.addUnitCharge) > 0)) continue

        if (rule.note) r.spcmnt = [r.spcmnt, rule.note].filter(Boolean).join(' / ')
        if (rule.fee) {
          // 이미 금액이 있으면 덮지 않는다. 조례는 기관 기본값이고 개별 등록이 우선이다.
          if (money(r.basicCharge) === 0 && money(r.addUnitCharge) === 0) Object.assign(r, rule.fee)
        }
        /*
         * 운영시간도 덮을 수 있게 한다.
         *
         * 여수 노외주차장은 20:00~08:00 이 '무료 운영'이다. 문을 닫는 게 아니라 열어 둔 채
         * 요금만 받지 않는다. 그런데 표준데이터에는 운영시간이 08:00~20:00 으로 들어 있어
         * 야간이 '운영 종료' 회색으로 묻힌다. 무료 시간대를 적어 봐야 소용이 없다.
         */
        if (rule.hours) Object.assign(r, rule.hours)
        applied++
      }
      console.log('조례 보정: ' + applied + '건 (' + rule.institution + ' — ' + (rule.note ?? '요금') + ')')
    }
  }

  const seen = new Set(
    rows.map((r) => String(r.prkplceNm ?? '').trim() + '@' + Number(r.latitude).toFixed(4) + ',' + Number(r.longitude).toFixed(4)),
  )
  for (const file of SUPPLEMENT_FILES) {
    if (!existsSync(file)) continue
    const sup = JSON.parse(await readFile(file, 'utf-8'))
    const supRows = Array.isArray(sup?.rows) ? sup.rows : []
    let added = 0
    for (const r of supRows) {
      const key = String(r.prkplceNm ?? '').trim() + '@' + Number(r.latitude).toFixed(4) + ',' + Number(r.longitude).toFixed(4)
      if (seen.has(key)) continue
      seen.add(key)
      rows.push(r)
      added++
    }
    console.log('보완 합침: ' + added + '건 (' + file + ')')
  }

  const cells = new Map()
  let dropped = 0
  let referenceDate = ''

  for (const row of rows) {
    const lat = Number(row.latitude)
    const lng = Number(row.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      dropped++
      continue
    }
    const key = cellKey(lat, lng)
    if (!cells.has(key)) cells.set(key, [])
    cells.get(key).push(row)

    const ref = String(row.referenceDate ?? '')
    if (ref > referenceDate) referenceDate = ref
  }

  // 이전 결과가 남아 있으면 지운다. 데이터가 줄었을 때 옛 칸이 살아남으면 안 된다.
  await rm(OUT_DIR, { recursive: true, force: true })
  await mkdir(OUT_DIR, { recursive: true })

  const index = {
    cellSize: CELL_SIZE,
    totalCount: rows.length - dropped,
    referenceDate,
    // 칸마다 몇 건인지와 실제 파일명(내용 해시 포함). 없는 칸은 요청하지 않는다.
    cells: {},
  }

  let biggest = 0
  for (const [key, list] of cells) {
    const json = JSON.stringify({ data: list })
    /*
     * 파일명에 내용 해시를 붙인다.
     *
     * 예전에는 150_507.json 처럼 고정 이름이라, 캐시를 넉넉히 잡아 두면 데이터를 고쳐도
     * 재방문자에게는 옛 칸이 그대로 나갔다. 실제로 보완표를 배포한 뒤에도 브라우저가
     * 캐시된 칸을 그대로 써서 새 주차장이 보이지 않았다.
     * 이름이 바뀌면 URL 이 바뀌므로 색인만 새로 받으면 곧바로 반영된다.
     */
    const hash = createHash('sha256').update(json).digest('hex').slice(0, 8)
    const file = key + '.' + hash + '.json'
    await writeFile(path.join(OUT_DIR, file), json, 'utf-8')
    index.cells[key] = { count: list.length, file }
    biggest = Math.max(biggest, Buffer.byteLength(json))
  }

  /*
   * 명절 연휴에만 개방하는 주차장은 격자에 섞지 않고 따로 낸다.
   *
   * 전국 1만 곳인데 1년에 닷새만 쓸 수 있다. 칸 파일에 넣으면 360일 동안 아무도
   * 못 쓰는 데이터를 매번 내려받게 된다. 앱은 색인의 holiday.dates 를 보고
   * 그 날짜를 골랐을 때만 이 파일을 받는다.
   */
  const HOLIDAY_FILE = path.join('public', 'data', 'holiday-parking.json')
  if (existsSync(HOLIDAY_FILE)) {
    const h = JSON.parse(await readFile(HOLIDAY_FILE, 'utf-8'))
    const hRows = Array.isArray(h?.rows) ? h.rows : []
    if (hRows.length > 0) {
      /*
       * 평소 칸과 같은 격자로 쪼갠다.
       * 한 파일로 두면 8MB 가 넘어 연휴에 첫 화면이 멈춘다.
       */
      const hCells = new Map()
      for (const row of hRows) {
        const la = Number(row.latitude)
        const ln = Number(row.longitude)
        if (!Number.isFinite(la) || !Number.isFinite(ln)) continue
        const key = cellKey(la, ln)
        if (!hCells.has(key)) hCells.set(key, [])
        hCells.get(key).push(row)
      }
      const cells = {}
      let biggestH = 0
      for (const [key, list] of hCells) {
        const json = JSON.stringify({ data: list })
        const hash = createHash('sha256').update(json).digest('hex').slice(0, 8)
        const file = 'holiday.' + key + '.' + hash + '.json'
        await writeFile(path.join(OUT_DIR, file), json, 'utf-8')
        cells[key] = { count: list.length, file }
        biggestH = Math.max(biggestH, Buffer.byteLength(json))
      }
      const dates = [...new Set(hRows.flatMap((r) => r.pzOpenDates ?? []))].sort()
      index.holiday = { dates, cells, count: hRows.length }
      console.log(
        '명절 주차장: ' + hRows.length.toLocaleString('ko-KR') + '건 → ' + hCells.size +
          '칸 (가장 큰 칸 ' + Math.round(biggestH / 1024).toLocaleString('ko-KR') + 'KB) — ' +
          dates.length + '일: ' + dates.join(', '),
      )
    }
  }

  /*
   * 이름·주소 검색용 색인을 만든다.
   *
   * 검색은 반경을 400km 로 넓혀 보지만, 앱이 실제로 들고 있는 것은 보고 있는 곳
   * 주변 격자뿐이다. 그래서 '스타필드'를 검색해도 이미 받아 둔 칸 안에 있는
   * 하남·고양만 나오고 안성·명지는 나오지 않았다.
   *
   * 전국 칸을 다 받으면 13MB 라 쓸 수 없다. 대신 '어느 칸에 어떤 이름이 있는지'만
   * 담은 색인(gzip 135KB)을 검색할 때 한 번 받고, 걸리는 칸만 추가로 받는다.
   * 색인은 후보를 좁히는 용도이고 최종 판정은 buildResults 가 그대로 한다.
   */
  const searchIndex = {}
  for (const [key, list] of cells) {
    const names = new Set()
    const places = new Set()
    for (const row of list) {
      const nm = String(row.prkplceNm ?? '').trim()
      if (nm) names.add(nm.replace(/\s+/g, '').toLowerCase())
      // 주소는 '시도 시군구' 까지만. '속초', '강남' 같은 지역 검색을 받는다.
      const addr = String(row.rdnmadr ?? row.lnmadr ?? '').trim().split(/\s+/).slice(0, 2).join('')
      if (addr) places.add(addr.toLowerCase())
      const inst = String(row.institutionNm ?? '').trim()
      if (inst) places.add(inst.replace(/\s+/g, '').toLowerCase())
    }
    searchIndex[key] = { n: [...names], a: [...places] }
  }
  {
    const json = JSON.stringify(searchIndex)
    const hash = createHash('sha256').update(json).digest('hex').slice(0, 8)
    const file = 'search.' + hash + '.json'
    await writeFile(path.join(OUT_DIR, file), json, 'utf-8')
    index.search = { file }
    console.log('검색 색인: ' + Object.keys(searchIndex).length + '칸 (' + kbOf(json) + ')')
  }

  const indexJson = JSON.stringify(index)
  await writeFile(INDEX_FILE, indexJson, 'utf-8')

  const kb = (n) => Math.round(n / 1024).toLocaleString('ko-KR') + 'KB'
  console.log(
    '격자 분할: ' +
      index.totalCount.toLocaleString('ko-KR') +
      '건 → ' +
      cells.size +
      '칸 (가장 큰 칸 ' +
      kb(biggest) +
      ', 색인 ' +
      kb(Buffer.byteLength(indexJson)) +
      ')',
  )
  if (dropped > 0) console.log('  좌표 없는 ' + dropped + '건 제외')
}

main().catch((err) => {
  console.error('✗ 격자 분할 실패:', err.message)
  process.exit(1)
})
