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
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const SOURCE = path.join('public', 'data', 'parkings.full.json')
const OUT_DIR = path.join('public', 'data', 'cells')
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
    // 칸마다 몇 건인지 — 없는 칸을 굳이 요청하지 않기 위해서다.
    cells: {},
  }

  let biggest = 0
  for (const [key, list] of cells) {
    const json = JSON.stringify({ data: list })
    await writeFile(path.join(OUT_DIR, key + '.json'), json, 'utf-8')
    index.cells[key] = list.length
    biggest = Math.max(biggest, Buffer.byteLength(json))
  }

  const indexJson = JSON.stringify(index)
  await writeFile(path.join(OUT_DIR, 'index.json'), indexJson, 'utf-8')

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
