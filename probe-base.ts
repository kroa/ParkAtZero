import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { normalizeParking } from '@/lib/normalize'
import { evaluate } from '@/lib/freeCalc'
const ps: NonNullable<ReturnType<typeof normalizeParking>>[] = []
for (const f of readdirSync('public/data/cells')) {
  if (f.startsWith('holiday.')) continue
  for (const r of (JSON.parse(readFileSync('public/data/cells/' + f, 'utf-8')).data ?? [])) {
    const p = normalizeParking(r); if (p) ps.push(p)
  }
}
const TIMES: Array<[string, string]> = [
  ['평14', '2026-08-26T14:00:00+09:00'], ['평22', '2026-08-26T22:00:00+09:00'],
  ['토14', '2026-08-22T14:00:00+09:00'], ['일14', '2026-08-23T14:00:00+09:00'],
]
const snap: Record<string, string> = {}
const tally: Record<string, Record<string, number>> = {}
for (const p of ps) {
  const s = TIMES.map(([, iso]) => evaluate({ parking: p, visitStart: new Date(iso), durationMin: 120 }).status).join('|')
  snap[p.id] = s
  TIMES.forEach(([lbl], i) => {
    const st = s.split('|')[i]
    ;(tally[lbl] ??= {})[st] = ((tally[lbl] ??= {})[st] ?? 0) + 1
  })
}
writeFileSync(process.argv[2], JSON.stringify(snap))
console.log('주차장 ' + ps.length + '곳')
for (const [lbl] of TIMES) {
  const t = tally[lbl]
  console.log('  ' + lbl + ': ' + Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(' · '))
}
