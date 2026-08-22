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
