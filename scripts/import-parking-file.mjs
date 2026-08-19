#!/usr/bin/env node
/**
 * 공공데이터포털에서 직접 내려받은 파일(CSV/JSON)을 앱이 읽는 형식으로 변환한다.
 *
 *   node scripts/import-parking-file.mjs <내려받은파일> [출력경로]
 *   예) node scripts/import-parking-file.mjs ~/Downloads/전국주차장정보표준데이터.csv
 *
 * 인증키가 필요 없다. 「전국주차장정보표준데이터」는 갱신주기가 반기라서
 * 파일 스냅샷만으로 충분하고, API 신청·프록시 설정을 건너뛸 수 있다.
 *
 * 주의: 공공데이터 CSV 는 대부분 EUC-KR(CP949) 로 저장되어 있다.
 * UTF-8 로 읽으면 한글이 전부 깨지므로 인코딩을 자동 판별한다.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_OUT = path.join('public', 'data', 'parkings.full.json')

/** UTF-8 로 디코딩했을 때 대체문자(U+FFFD)가 많이 나오면 EUC-KR 로 다시 읽는다. */
function decode(buffer) {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
  const replacementRatio = (utf8.match(/�/g)?.length ?? 0) / Math.max(1, utf8.length)
  if (replacementRatio < 0.0005) {
    return { text: utf8.replace(/^﻿/, ''), encoding: 'utf-8' }
  }
  try {
    const euckr = new TextDecoder('euc-kr').decode(buffer)
    return { text: euckr.replace(/^﻿/, ''), encoding: 'euc-kr' }
  } catch {
    return { text: utf8.replace(/^﻿/, ''), encoding: 'utf-8(폴백)' }
  }
}

/**
 * 따옴표와 줄바꿈을 포함한 CSV 를 파싱한다.
 * 특기사항 필드에 쉼표와 줄바꿈이 예사로 들어 있어 단순 split 으로는 깨진다.
 */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += c
      }
      continue
    }

    if (c === '"') {
      quoted = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((v) => v.trim() !== '')) rows.push(row)
      row = []
    } else {
      field += c
    }
  }

  row.push(field)
  if (row.some((v) => v.trim() !== '')) rows.push(row)
  return rows
}

function csvToObjects(text) {
  const rows = parseCsv(text)
  if (rows.length < 2) return []
  const header = rows[0].map((h) => h.trim().replace(/^﻿/, ''))
  return rows.slice(1).map((cols) => {
    const obj = {}
    header.forEach((key, i) => {
      obj[key] = (cols[i] ?? '').trim()
    })
    return obj
  })
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.records)) return payload.records
  if (Array.isArray(payload?.response?.body?.items)) return payload.response.body.items
  if (Array.isArray(payload?.response?.body?.items?.item)) return payload.response.body.items.item
  return []
}

/** 앱의 normalize.ts 가 인식하는 최소 컬럼이 들어 있는지 확인한다. */
function sanityCheck(rows) {
  const sample = rows[0] ?? {}
  const keys = Object.keys(sample)
  const hasName = keys.some((k) => /prkplceNm|주차장명/.test(k))
  const hasLat = keys.some((k) => /latitude|위도/.test(k))
  const hasLng = keys.some((k) => /longitude|경도/.test(k))
  return { keys, hasName, hasLat, hasLng }
}

async function main() {
  const input = process.argv[2]
  const output = process.argv[3] ?? DEFAULT_OUT

  if (!input) {
    console.error('사용법: node scripts/import-parking-file.mjs <내려받은파일.csv|json> [출력경로]')
    process.exit(1)
  }

  const buffer = await readFile(input)
  const { text, encoding } = decode(buffer)
  const isJson = path.extname(input).toLowerCase() === '.json' || text.trimStart().startsWith('{') || text.trimStart().startsWith('[')

  const rows = isJson ? extractRows(JSON.parse(text)) : csvToObjects(text)

  if (rows.length === 0) {
    console.error('✗ 데이터를 한 건도 읽지 못했습니다. 파일 형식을 확인해 주세요.')
    process.exit(1)
  }

  const check = sanityCheck(rows)
  console.log('입력 :', input)
  console.log('인코딩:', encoding, '| 형식:', isJson ? 'JSON' : 'CSV')
  console.log('건수 :', rows.length.toLocaleString('ko-KR'))
  console.log('컬럼 :', check.keys.slice(0, 12).join(', '), check.keys.length > 12 ? '…' : '')

  if (!check.hasName || !check.hasLat || !check.hasLng) {
    console.error('')
    console.error('✗ 주차장명/위도/경도 컬럼을 찾지 못했습니다. 다른 데이터셋 파일일 수 있습니다.')
    console.error('  앱은 prkplceNm·latitude·longitude (또는 주차장명·위도·경도) 컬럼을 기대합니다.')
    process.exit(1)
  }

  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify({ totalCount: rows.length, data: rows }), 'utf-8')

  const mb = ((await readFile(output)).length / 1024 / 1024).toFixed(1)
  console.log('')
  console.log('✓ 저장 완료 →', output, `(${mb} MB)`)
  console.log('  앱에 반영하려면 빌드 시 VITE_PARKING_SEED_URL=/data/parkings.full.json 을 주세요.')
}

main().catch((err) => {
  console.error('✗ 실패:', err.message)
  process.exit(1)
})
