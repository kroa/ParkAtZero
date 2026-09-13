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
 * 계정 ID 도 함께 필요하다. Account Analytics 권한만 가진 토큰은 계정 목록을 볼 수
 * 없어서 알아낼 방법이 없다(토큰 자체는 멀쩡하다).
 *
 *   CLOUDFLARE_ACCOUNT_ID=...
 *
 * 사용: node scripts/visitors.mjs [일수]      (기본 7일)
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql'
const DAYS = Number(process.argv[2] ?? 7)

/**
 * .env.local 을 먼저 보고, 없으면 .env 를 본다. 값은 반환만 하고 어디에도 찍지 않는다.
 *
 * 처음에는 .env.local 만 읽었는데 .env 에 넣는 경우가 있었다. 둘 다 .gitignore 에
 * 있어 저장소에는 올라가지 않으므로 어느 쪽이든 받아 준다.
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

  /*
   * 계정 ID 는 직접 받는다.
   *
   * 처음에는 토큰으로 알아내려 했다. 그런데 Account Analytics 권한만 준 토큰은 계정
   * 목록을 볼 수 없다 — GraphQL 은 "not authorized for that account" 를, REST 의
   * /accounts 는 빈 목록을 돌려준다. 토큰 유효성 검사는 active 로 나오므로 토큰이
   * 잘못된 것으로 오해하기 쉽다. 권한을 넓히는 대신 계정 ID 를 받는다.
   */
  let accountTag = process.env.CLOUDFLARE_ACCOUNT_ID || (await fromEnvFile('CLOUDFLARE_ACCOUNT_ID'))
  if (!accountTag) {
    try {
      const d = await graphql(token, '{ viewer { accounts { accountTag } } }', {})
      accountTag = d?.viewer?.accounts?.[0]?.accountTag ?? ''
    } catch {
      /* 권한이 좁은 토큰에서는 정상이다. 아래에서 안내한다. */
    }
  }
  if (!accountTag) {
    console.error('✗ 계정 ID 가 필요합니다. .env.local 에 한 줄 추가해 주세요.')
    console.error('    CLOUDFLARE_ACCOUNT_ID=...')
    console.error('  찾는 곳: 대시보드 주소의 dash.cloudflare.com/<계정ID>/... 부분,')
    console.error('           또는 계정 홈의 Account ID 복사 버튼.')
    process.exit(1)
  }

  /*
   * 계정 ID 는 32자 16진수다. 로그인 이메일을 적는 경우가 있었는데, 그대로 보내면
   * Cloudflare 는 인증 오류만 돌려주어 토큰이 잘못된 것처럼 보인다. 형식이 아니면
   * 요청을 보내기 전에 여기서 알려 준다.
   */
  if (!/^[0-9a-f]{32}$/i.test(accountTag)) {
    console.error('✗ 계정 ID 형식이 아닙니다 — 32자 16진수여야 하는데 ' + accountTag.length + '자입니다.')
    console.error('  로그인 이메일이 아닙니다. 대시보드 주소 dash.cloudflare.com/<32자>/... 의 그 부분입니다.')
    process.exit(1)
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
