#!/usr/bin/env node
/**
 * 전국주차장표준데이터 전체를 내려받아 public/data/parkings.full.json 으로 저장한다.
 *
 *   npm run data:fetch
 *
 * 필요한 환경변수 (.env.local 또는 셸 환경):
 *   PARKING_API_KEY   공공데이터포털 일반 인증키(Decoding)
 *   PARKING_API_BASE  데이터셋 엔드포인트
 *                     예) https://api.odcloud.kr/api/15012890/v1/uddi:xxxx-xxxx
 *
 * 만들어진 파일은 .gitignore 에 걸려 있다(수십 MB). 배포에 포함하려면
 * VITE_PARKING_SEED_URL=/data/parkings.full.json 로 바꾸고 저장소 정책에 맞게 커밋하거나,
 * Cloudflare Pages Functions 프록시(functions/api/parkings.ts)를 그대로 쓰면 된다.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const OUT_PATH = path.join(ROOT, 'public', 'data', 'parkings.full.json')
const PER_PAGE = 1000
const MAX_PAGES = 200

/** dotenv 의존성 없이 .env.local 을 읽는다 — 이 스크립트 하나 때문에 패키지를 늘리지 않는다. */
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

async function fetchPage(base, key, page) {
  const url = new URL(base)
  url.searchParams.set('page', String(page))
  url.searchParams.set('perPage', String(PER_PAGE))
  url.searchParams.set('serviceKey', key)
  url.searchParams.set('returnType', 'JSON')

  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} (page ${page})`)
  return res.json()
}

function rowsOf(payload) {
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.response?.body?.items)) return payload.response.body.items
  if (Array.isArray(payload?.response?.body?.items?.item)) return payload.response.body.items.item
  return []
}

async function main() {
  await loadEnvFile(path.join(ROOT, '.env.local'))
  await loadEnvFile(path.join(ROOT, '.dev.vars'))

  const key = process.env.PARKING_API_KEY ?? process.env.VITE_PARKING_API_KEY
  const base = process.env.PARKING_API_BASE ?? process.env.VITE_PARKING_API_BASE

  if (!key || !base) {
    console.error('✗ PARKING_API_KEY / PARKING_API_BASE 가 필요합니다.')
    console.error('  .env.local 을 만들고 값을 채운 뒤 다시 실행하세요. (.env.example 참고)')
    process.exit(1)
  }

  const all = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    process.stdout.write(`\r  page ${page} … 누적 ${all.length}건`)
    const payload = await fetchPage(base, key, page)
    const rows = rowsOf(payload)
    all.push(...rows)
    if (rows.length < PER_PAGE) break
  }
  process.stdout.write('\n')

  if (all.length === 0) {
    console.error('✗ 받은 데이터가 없습니다. 엔드포인트와 인증키를 확인하세요.')
    process.exit(1)
  }

  await mkdir(path.dirname(OUT_PATH), { recursive: true })
  await writeFile(OUT_PATH, JSON.stringify({ totalCount: all.length, data: all }), 'utf-8')

  const mb = (Buffer.byteLength(JSON.stringify(all)) / 1024 / 1024).toFixed(1)
  console.log(`✓ ${all.length.toLocaleString('ko-KR')}건 저장 → public/data/parkings.full.json (${mb} MB)`)
  console.log('  앱에서 쓰려면 .env.local 에 VITE_PARKING_SEED_URL=/data/parkings.full.json 을 넣으세요.')
}

main().catch((err) => {
  console.error('\n✗ 실패:', err.message)
  process.exit(1)
})
