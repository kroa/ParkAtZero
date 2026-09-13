#!/usr/bin/env node
/**
 * 방문자 수를 조회한다 (Cloudflare Web Analytics).
 *
 * 대시보드는 사람이 로그인해야 볼 수 있어서, 숫자를 확인할 때마다 화면을 캡처해
 * 주고받아야 했다. 읽기 전용 토큰을 하나 두면 여기서 바로 볼 수 있다.
 *
 * 준비물 — .env.local 에 아래 한 줄. 값은 절대 출력하지 않는다.
 *
 *   CLOUDFLARE_ANALYTICS_TOKEN=...
 *
 * 토큰 권한은 Account → Account Analytics → Read 하나면 된다.
 * 만드는 곳: https://dash.cloudflare.com/profile/api-tokens/
 *
 * 계정 ID 는 토큰으로 알아내므로 적지 않아도 된다. 알아내지 못하면
 * CLOUDFLARE_ACCOUNT_ID 를 .env.local 에 함께 적는다.
 *
 * 사용: node scripts/visitors.mjs [일수]      (기본 7일)
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql'
const DAYS = Number(process.argv[2] ?? 7)

/** .env.local 에서 값을 읽는다. 값은 반환만 하고 어디에도 찍지 않는다. */
async function fromEnvFile(key) {
  if (!existsSync('.env.local')) return ''
  for (const line of (await readFile('.env.local', 'utf-8')).split(/\r?\n/)) {
    const m = new RegExp('^' + key + '=(.*)$').exec(line.trim())
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  return ''
}

async function graphql(token, query, variables) {
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error('HTTP ' + res.status + ' — ' + JSON.stringify(body).slice(0, 300))
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join(' / '))
  return body.data
}

/**
 * 사이트 태그는 배포된 페이지의 beacon 조각에 그대로 들어 있다(공개값).
 * 따로 적어 두면 두 곳이 어긋날 수 있으므로 index.html 에서 읽는다.
 */
async function siteTagFromIndex() {
  const html = await readFile('index.html', 'utf-8')
  return /data-cf-beacon=['"]?\{\s*"token"\s*:\s*"([0-9a-f]{8,})"/.exec(html)?.[1] ?? ''
}

async function main() {
  const token = process.env.CLOUDFLARE_ANALYTICS_TOKEN || (await fromEnvFile('CLOUDFLARE_ANALYTICS_TOKEN'))
  if (!token) {
    console.error('✗ CLOUDFLARE_ANALYTICS_TOKEN 이 없습니다. .env.local 에 넣어 주세요.')
    console.error('  만드는 곳: https://dash.cloudflare.com/profile/api-tokens/ (Account Analytics → Read)')
    process.exit(1)
  }

  const siteTag = await siteTagFromIndex()
  if (!siteTag) throw new Error('index.html 에서 beacon 토큰(사이트 태그)을 찾지 못했습니다.')

  let accountTag = process.env.CLOUDFLARE_ACCOUNT_ID || (await fromEnvFile('CLOUDFLARE_ACCOUNT_ID'))
  if (!accountTag) {
    const d = await graphql(token, '{ viewer { accounts { accountTag } } }', {})
    accountTag = d?.viewer?.accounts?.[0]?.accountTag ?? ''
    if (!accountTag) throw new Error('계정을 찾지 못했습니다. CLOUDFLARE_ACCOUNT_ID 를 .env.local 에 적어 주세요.')
  }

  const to = new Date()
  const from = new Date(to.getTime() - DAYS * 86400_000)
  const iso = (d) => d.toISOString().slice(0, 19) + 'Z'

  const data = await graphql(
    token,
    `query($a:String!,$s:String!,$from:Time!,$to:Time!){
       viewer{ accounts(filter:{accountTag:$a}){
         rumPageloadEventsAdaptiveGroups(
           limit:1000,
           filter:{siteTag:$s, datetime_geq:$from, datetime_leq:$to},
           orderBy:[date_ASC]
         ){ count sum{visits} dimensions{date} }
       } }
     }`,
    { a: accountTag, s: siteTag, from: iso(from), to: iso(to) },
  )

  const rows = data?.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups ?? []
  if (rows.length === 0) {
    console.log('최근 ' + DAYS + '일 동안 기록된 방문이 없습니다.')
    return
  }

  console.log('최근 ' + DAYS + '일 (사이트 태그 ' + siteTag.slice(0, 6) + '…)\n')
  console.log('날짜'.padEnd(12) + '방문'.padStart(8) + '페이지뷰'.padStart(10))
  let v = 0
  let p = 0
  for (const r of rows) {
    const visits = r.sum?.visits ?? 0
    console.log(String(r.dimensions.date).padEnd(12) + String(visits).padStart(8) + String(r.count).padStart(10))
    v += visits
    p += r.count
  }
  console.log('-'.repeat(30))
  console.log('합계'.padEnd(12) + String(v).padStart(8) + String(p).padStart(10))
  console.log('\n※ Cloudflare 는 표본을 보정해 숫자를 반올림하므로 실제와 약간 다를 수 있습니다.')
}

main().catch((err) => {
  console.error('✗ 실패:', err.message)
  process.exit(1)
})
