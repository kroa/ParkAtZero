#!/usr/bin/env node
/**
 * 수집한 스냅샷이 실제로 앱에서 동작하는지 검증한다.
 *
 *   node scripts/verify-snapshot.mjs public/data/parkings.full.json
 *
 * 왜 필요한가
 *   공공데이터의 컬럼명은 예고 없이 바뀐다. 그대로 커밋해 버리면 배포는 성공하는데
 *   사용자 화면만 텅 비는, 가장 알아채기 어려운 형태의 장애가 된다.
 *   그래서 자동 갱신 워크플로우는 커밋 전에 반드시 이 검증을 통과해야 한다.
 *
 * 검증은 앱이 실제로 쓰는 코드(src/lib/normalize.ts, freeCalc.ts)를 그대로 번들해서 돌린다.
 * 별도로 재구현하면 검증과 실제 동작이 어긋나므로 의미가 없다.
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { build } from 'esbuild'

/** 정규화를 통과해야 하는 최소 비율 — 이 아래면 스키마가 바뀐 것으로 본다. */
const MIN_NORMALIZE_RATIO = 0.9
/** 전국 데이터라면 이보다는 많아야 한다. 너무 적으면 페이지네이션이 중간에 끊긴 것. */
const MIN_ROWS = 1000

async function loadAppLogic() {
  const dir = path.join(tmpdir(), 'parkatzero-verify')
  await mkdir(dir, { recursive: true })

  const entry = path.join(dir, 'entry.ts')
  const outfile = path.join(dir, 'bundle.mjs')

  await writeFile(
    entry,
    [
      "export { normalizeAll } from '@/lib/normalize'",
      "export { evaluate } from '@/lib/freeCalc'",
      "export { extractFreeRules } from '@/lib/timeRules'",
    ].join('\n'),
    'utf-8',
  )

  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'error',
    alias: { '@': path.resolve(process.cwd(), 'src') },
  })

  const mod = await import('file://' + outfile.replace(/\\/g, '/'))
  return { mod, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

function fail(message) {
  console.error('✗ ' + message)
  process.exitCode = 1
}

async function main() {
  const file = process.argv[2] ?? path.join('public', 'data', 'parkings.full.json')
  const payload = JSON.parse(await readFile(file, 'utf-8'))
  const rawCount = Array.isArray(payload?.data) ? payload.data.length : 0

  console.log('검증 대상:', file)
  console.log('원본 건수:', rawCount.toLocaleString('ko-KR'))

  if (rawCount < MIN_ROWS) {
    fail(`건수가 ${rawCount}건뿐입니다. 수집이 중간에 끊겼을 가능성이 큽니다(최소 ${MIN_ROWS}건 기대).`)
    return
  }

  const { mod, cleanup } = await loadAppLogic()
  try {
    const parkings = mod.normalizeAll(payload)
    const ratio = parkings.length / rawCount
    console.log('정규화 통과:', parkings.length.toLocaleString('ko-KR'), `(${(ratio * 100).toFixed(1)}%)`)

    if (ratio < MIN_NORMALIZE_RATIO) {
      fail(
        `정규화 통과율이 ${(ratio * 100).toFixed(1)}% 로 낮습니다. ` +
          '원본 컬럼명이 바뀌었을 수 있습니다 — src/lib/normalize.ts 의 FIELD 별칭을 확인하세요.',
      )
      return
    }

    // 요금 판별이 실제로 도는지, 결과가 한쪽으로 쏠리지 않는지 본다.
    const visit = new Date('2026-01-15T14:00:00')
    const tally = { free: 0, conditional: 0, paid: 0, closed: 0, unknown: 0 }
    for (const p of parkings) {
      tally[mod.evaluate({ parking: p, visitStart: visit, durationMin: 120 }).status]++
    }
    console.log('평일 14시 2시간 기준:', JSON.stringify(tally))

    const decided = tally.free + tally.conditional + tally.paid
    if (decided === 0) {
      fail('요금/운영시간을 하나도 판별하지 못했습니다. 요금 컬럼 매핑이 깨졌을 수 있습니다.')
      return
    }
    if (tally.unknown / parkings.length > 0.5) {
      fail('절반 이상이 "정보 부족" 입니다. 요금 컬럼이 비어 들어왔을 가능성이 큽니다.')
      return
    }

    // 좌표 온전성 — 지도에 못 올리는 데이터가 섞이면 마커가 엉뚱한 곳에 찍힌다.
    const badCoord = parkings.filter(
      (p) => !(p.lat > 32 && p.lat < 39.5 && p.lng > 124 && p.lng < 132.5),
    ).length
    if (badCoord > 0) {
      fail(`국내 범위를 벗어난 좌표 ${badCoord}건이 남아 있습니다.`)
      return
    }

    /*
     * 보완표 검사.
     *
     * 표준데이터에 빠진 주차장을 손으로 채우는 곳이라 규율이 무너지기 쉽다.
     * 출처 없이 한 줄만 슬쩍 들어가도 앱 전체의 신뢰가 깨지므로 여기서 막는다.
     */
    const supPaths = [
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
    ]
    for (const supPath of supPaths) {
      if (!existsSync(supPath)) continue
      const sup = JSON.parse(await readFile(supPath, 'utf-8'))
      const supRows = Array.isArray(sup?.rows) ? sup.rows : []
      const problems = []
      for (const r of supRows) {
        const who = r.prkplceNm ?? r.prkplceNo ?? '(이름 없음)'
        if (!r.pzSource) problems.push(who + ': 확인 출처(pzSource)가 없습니다')
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.pzVerifiedOn ?? undefined)))
          problems.push(who + ': 확인 날짜(pzVerifiedOn)가 없거나 형식이 다릅니다')
        const la = Number(r.latitude)
        const ln = Number(r.longitude)
        if (!(la > 32 && la < 39.5 && ln > 124 && ln < 132.5))
          problems.push(who + ': 좌표가 국내 범위를 벗어났습니다')
      }
      if (problems.length > 0) {
        fail('보완표에 문제가 있습니다:' + problems.map((p) => '\n  - ' + p).join(''))
        return
      }
      console.log('보완 ' + supPath + ':', supRows.length, '건 (출처·확인일자·좌표 확인)')
    }

    console.log('✓ 스냅샷 검증 통과')
  } finally {
    await cleanup()
  }
}

main().catch((err) => {
  console.error('✗ 검증 실패:', err.message)
  process.exit(1)
})
