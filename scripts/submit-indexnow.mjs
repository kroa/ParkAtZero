#!/usr/bin/env node
/**
 * IndexNow 로 새 주소를 검색엔진에 알린다.
 *
 * Bing·네이버·Yandex·Seznam·Yep 이 함께 쓰는 규약이다(indexnow.org 확인). 계정도
 * 로그인도 필요 없다 — 사이트 루트에 키 파일을 두어 소유권을 증명하고, 주소 목록을
 * POST 하면 된다. 구글은 참여하지 않으므로 Search Console 로 따로 해야 한다.
 *
 * 한국 서비스라 네이버가 참여한다는 점이 특히 크다.
 *
 * ── 키 ────────────────────────────────────────────────────
 * public/<키>.txt 파일의 이름이 곧 키이고 내용도 같은 키다. 이 파일이 배포돼
 * https://도메인/<키>.txt 로 200 이 떠야 제출이 받아들여진다. 그래서 반드시
 * 배포가 끝난 뒤에 이 스크립트를 돌린다.
 *
 * 사용: node scripts/submit-indexnow.mjs [--dry]
 */
import path from 'node:path'
import { readFile, readdir } from 'node:fs/promises'

const SITE = process.env.SITE_ORIGIN || 'https://parkatzero.pages.dev'
const HOST = new URL(SITE).host
const ENDPOINT = 'https://api.indexnow.org/indexnow'
/** 한 번에 보낼 수 있는 최대 개수(규약 상한). */
const BATCH = 10_000

/** public/ 에서 <32자 이상 16진수>.txt 파일을 찾아 키를 읽는다. */
async function findKey() {
  const dir = 'public'
  for (const f of await readdir(dir)) {
    const m = /^([0-9a-f]{8,128})\.txt$/.exec(f)
    if (!m) continue
    const body = (await readFile(path.join(dir, f), 'utf-8')).trim()
    if (body === m[1]) return m[1]
    console.warn('  ! ' + f + ' 의 내용이 파일명과 다릅니다 — 건너뜁니다')
  }
  return null
}

/** 사이트맵에서 주소를 읽는다. 지역 페이지까지 전부 들어 있다. */
async function urlsFromSitemap() {
  const res = await fetch(SITE.replace(/\/$/, '') + '/sitemap.xml')
  if (!res.ok) throw new Error('sitemap.xml 응답 ' + res.status)
  const xml = await res.text()
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim())
  if (urls.length === 0) throw new Error('sitemap.xml 에서 주소를 찾지 못했습니다')
  return urls
}

async function main() {
  const dry = process.argv.includes('--dry')

  const key = await findKey()
  if (!key) throw new Error('public/ 에 <키>.txt 가 없습니다')

  // 키 파일이 실제로 배포돼 있어야 제출이 받아들여진다. 먼저 확인한다.
  const keyUrl = SITE.replace(/\/$/, '') + '/' + key + '.txt'
  const keyRes = await fetch(keyUrl)
  const keyBody = (await keyRes.text()).trim()
  if (!keyRes.ok || keyBody !== key) {
    throw new Error(
      '키 파일이 아직 배포되지 않았습니다: ' + keyUrl + ' (' + keyRes.status + ', 내용 ' + keyBody.slice(0, 40) + ')',
    )
  }
  console.log('키 확인: ' + keyUrl)

  const urls = await urlsFromSitemap()
  console.log('사이트맵 주소 ' + urls.length + '개')
  if (dry) {
    console.log('--dry 라 제출하지 않습니다. 표본:')
    for (const u of urls.slice(0, 3)) console.log('   ' + u)
    return
  }

  for (let i = 0; i < urls.length; i += BATCH) {
    const chunk = urls.slice(i, i + BATCH)
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: HOST, key, keyLocation: keyUrl, urlList: chunk }),
    })
    const text = await res.text()
    /*
     * 200 = 받음, 202 = 받았으나 키 검증 대기.
     * 나머지는 그대로 드러낸다 — 조용히 실패하면 제출된 줄 알고 넘어가게 된다.
     */
    console.log('  ' + chunk.length + '개 → HTTP ' + res.status + (text ? ' ' + text.slice(0, 120) : ''))

    /*
     * 처음 제출하면 403 SiteVerificationNotCompleted 가 온다. 실패가 아니라
     * '키 파일을 아직 가져가 보지 않았으니 잠시 뒤 다시 보내라' 는 뜻이다.
     * 영구 실패와 구분해서 알려 주지 않으면 다시 시도할 생각을 못 하게 된다.
     */
    if (res.status === 403 && /SiteVerificationNotCompleted/i.test(text)) {
      console.log('    → 키 검증 대기 중입니다. 몇 분 뒤 다시 실행하세요.')
      process.exitCode = 75 // EX_TEMPFAIL — 나중에 다시
      return
    }
    if (res.status !== 200 && res.status !== 202) {
      throw new Error('제출 실패 HTTP ' + res.status)
    }
  }
  console.log('제출 완료 — Bing·네이버·Yandex 등이 함께 받습니다. 구글은 Search Console 로 따로 해야 합니다.')
}

main().catch((err) => {
  console.error('✗ 실패:', err.message)
  process.exit(1)
})
