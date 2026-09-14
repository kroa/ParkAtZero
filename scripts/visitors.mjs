#!/usr/bin/env node
/**
 * 방문자 수를 조회한다 (Cloudflare Web Analytics).
 *
 * 대시보드는 사람이 로그인해야 볼 수 있어서, 숫자를 확인할 때마다 화면을 캡처해
 * 주고받아야 했다. 읽기 전용 토큰을 하나 두면 여기서 바로 볼 수 있다.
 *
 * 준비물 — .env.local 에 두 줄. 값은 절대 출력하지 않는다.
 *
 *   CLOUDFLARE_ANALYTICS_TOKEN=...
 *   CLOUDFLARE_ACCOUNT_ID=...
 *
 * 토큰 권한은 Account → Account Analytics → Read 하나면 된다.
 * 만드는 곳: https://dash.cloudflare.com/profile/api-tokens/
 *
 * 계정 ID 는 32자 16진수다. 로그인 이메일이 아니라 대시보드 주소
 * dash.cloudflare.com/<32자>/... 의 그 부분이다. Account Analytics 권한만 가진
 * 토큰은 계정 <목록>을 볼 수 없어 자동으로 알아낼 수 없다.
 *
 * 사이트 태그는 호스트 이름으로 찾는다.
 *
 * 처음에는 index.html 의 beacon 조각에 든 토큰을 사이트 태그로 썼다. 그런데 둘은
 * 다른 값이다. 그 탓에 필터가 아무것도 맞히지 못해 오류 없이 "기록 없음" 만
 * 나왔다. 실제 태그는 requestHost 로 묶어 보면 바로 드러난다.
 *
 * 사용: node scripts/visitors.mjs [일수]      (기본 7일)
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql'
const DAYS = Number(process.argv[2] ?? 7)
/** 어느 사이트를 볼 것인가. 한 계정에 여러 사이트가 있으면 이걸로 갈린다. */
const HOST = process.env.SITE_HOST || 'parkatzero.pages.dev'
/** 태그를 찾을 때 훑는 기간. 최근에 방문이 없으면 짧은 창으로는 못 찾는다. */
const DISCOVER_DAYS = 90

/**
 * .env.local 을 먼저 보고, 없으면 .env 를 본다. 값은 반환만 하고 어디에도 찍지 않는다.
 * 둘 다 .gitignore 에 있어 저장소에는 올라가지 않는다.
 */
async function fromEnvFile(key) {
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue
    for (const line of (await readFile(file, 'utf-8')).split(/\r?\n/)) {
      const m = new RegExp('^' + key + '=(.*)$').exec(line.trim())
      if (m) return m[1].trim().replace(/^["']|["']$/g, '')
    }
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

const iso = (d) => d.toISOString().slice(0, 19) + 'Z'
const daysAgo = (n) => new Date(Date.now() - n * 86400_000)

/** 호스트 이름으로 사이트 태그를 찾는다. 못 찾으면 빈 문자열. */
async function findSiteTag(token, accountTag) {
  const data = await graphql(
    token,
    `query($a:String!,$from:Time!,$to:Time!){
       viewer{ accounts(filter:{accountTag:$a}){
         rumPageloadEventsAdaptiveGroups(limit:100, filter:{datetime_geq:$from, datetime_leq:$to}){
           count dimensions{siteTag requestHost}
         }
       } }
     }`,
    { a: accountTag, from: iso(daysAgo(DISCOVER_DAYS)), to: iso(new Date()) },
  )
  const rows = data?.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups ?? []
  const mine = rows.filter((r) => r.dimensions.requestHost === HOST).sort((a, b) => b.count - a.count)
  return { tag: mine[0]?.dimensions.siteTag ?? '', hosts: [...new Set(rows.map((r) => r.dimensions.requestHost))] }
}

async function main() {
  const token = process.env.CLOUDFLARE_ANALYTICS_TOKEN || (await fromEnvFile('CLOUDFLARE_ANALYTICS_TOKEN'))
  if (!token) {
    console.error('✗ CLOUDFLARE_ANALYTICS_TOKEN 이 없습니다. .env.local 에 넣어 주세요.')
    console.error('  만드는 곳: https://dash.cloudflare.com/profile/api-tokens/ (Account Analytics → Read)')
    process.exit(1)
  }

  const accountTag = process.env.CLOUDFLARE_ACCOUNT_ID || (await fromEnvFile('CLOUDFLARE_ACCOUNT_ID'))
  if (!accountTag) {
    console.error('✗ 계정 ID 가 필요합니다. .env.local 에 한 줄 추가해 주세요.')
    console.error('    CLOUDFLARE_ACCOUNT_ID=...')
    console.error('  찾는 곳: 대시보드 주소의 dash.cloudflare.com/<32자>/... 부분.')
    process.exit(1)
  }
  if (!/^[0-9a-f]{32}$/i.test(accountTag)) {
    console.error('✗ 계정 ID 형식이 아닙니다 — 32자 16진수여야 하는데 ' + accountTag.length + '자입니다.')
    console.error('  로그인 이메일이 아닙니다. 대시보드 주소 dash.cloudflare.com/<32자>/... 의 그 부분입니다.')
    process.exit(1)
  }

  let siteTag = process.env.CLOUDFLARE_RUM_SITE_TAG || (await fromEnvFile('CLOUDFLARE_RUM_SITE_TAG'))
  if (!siteTag) {
    const found = await findSiteTag(token, accountTag)
    siteTag = found.tag
    if (!siteTag) {
      console.error('✗ ' + HOST + ' 의 사이트 태그를 찾지 못했습니다.')
      console.error('  최근 ' + DISCOVER_DAYS + '일 동안 이 계정에서 기록된 호스트: ' + (found.hosts.join(', ') || '없음'))
      console.error('  이 호스트로 들어온 방문이 하나도 없다는 뜻입니다 — 집계 스크립트의 토큰을 확인하세요.')
      process.exit(1)
    }
  }

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
    { a: accountTag, s: siteTag, from: iso(daysAgo(DAYS)), to: iso(new Date()) },
  )

  const rows = data?.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups ?? []
  console.log(HOST + ' · 최근 ' + DAYS + '일 (사이트 태그 ' + siteTag.slice(0, 8) + '…)\n')
  if (rows.length === 0) {
    console.log('기록된 방문이 없습니다.')
    return
  }

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
  console.log('\n※ Cloudflare 는 표본을 보정해 10 단위로 반올림하므로 실제와 다를 수 있습니다.')
}

main().catch((err) => {
  console.error('✗ 실패:', err.message)
  process.exit(1)
})
