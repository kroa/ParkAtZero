#!/usr/bin/env node
/**
 * 설·추석 연휴에만 무료 개방하는 주차장을 모은다.
 *
 * 행정안전부가 명절마다 「전국 명절 무료주차장 현황」을 낸다. 학교 운동장,
 * 공공기관 주차장, 교육청 부지 같은 곳을 연휴 며칠 동안만 개방하는 자료로,
 * 2026년 설에는 전국 10,074곳이 올라 있었다. 좌표와 개방일·개방시간이 함께 들어 있다.
 *
 * 출처: 공공데이터포털 「행정안전부_전국 명절 무료주차장 현황」 (인증 불필요)
 *       https://www.data.go.kr/data/15099790/fileData.do
 *
 * ── 연중 띄우지 않는다 ──────────────────────────────────────
 * 이 주차장들은 평소에는 일반인이 못 댄다. 학교 운동장을 사철 지도에 띄우면
 * '가 봤더니 막혀 있다'가 되고, 그건 요금을 틀리는 것만큼 나쁘다.
 * 그래서 개방일 목록(pzOpenDates)을 달아 두고, 방문 날짜가 그 안에 있을 때만
 * 결과에 넣는다(src/lib/query.ts). 연휴에는 가장 쓸모 있는 정보가 되고
 * 나머지 360일은 보이지 않는다.
 *
 * 개방시간이 '미개방'인 행은 담지 않는다. 등록만 하고 열지 않는 곳이다.
 *
 * ── 내려받기 주소를 매번 다시 찾는다 ─────────────────────────
 * 행안부는 명절이 지나면 같은 데이터셋에 다음 명절 파일을 새로 올린다.
 * 파일 번호를 박아 두면 추석 자료가 올라와도 지난 설 자료를 계속 받는다.
 * 그래서 상세 페이지에서 내려받기 링크를 찾아 쓴다.
 *
 * 사용: node scripts/fetch-holiday-parking.mjs [출력경로]
 */
import path from 'node:path'
import { writeFile } from 'node:fs/promises'

const PAGE = 'https://www.data.go.kr/data/15099790/fileData.do'
const DEFAULT_OUT = path.join('public', 'data', 'holiday-parking.json')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'

const squash = (s) => String(s ?? '').split(/[ \t\r\n]+/).join(' ').trim()

/** 상세 페이지에서 JSON 내려받기 링크를 찾는다. 못 찾으면 마지막으로 쓰던 주소로 돌아간다. */
export function findDownloadUrl(html) {
  const ids = [...String(html).matchAll(/atchFileId=(FILE_[0-9A-Z]+)/g)].map((m) => m[1])
  if (ids.length === 0) return null
  // fileDetailSn=2 가 JSON(UTF-8), 1 이 CSV(EUC-KR). JSON 쪽이 인코딩 사고가 없다.
  return 'https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=' + ids[0] + '&fileDetailSn=2'
}

/** '종일개방' → 24시간. '09:00~18:00' → 그 구간. '미개방' → null(담지 않음). */
export function readOpenTime(text) {
  const s = squash(text)
  if (!s || /미개방|미운영|불가/.test(s)) return null
  if (/종일|24/.test(s)) return { open: '0000', close: '2400' }
  const m = /(\d{1,2})\s*:\s*(\d{2})\s*[~\-–]\s*(\d{1,2})\s*:\s*(\d{2})/.exec(s)
  if (!m) return { open: '0000', close: '2400' }
  const pad = (h, mm) => String(Math.min(24, Number(h))).padStart(2, '0') + mm
  return { open: pad(m[1], m[2]), close: pad(m[3], m[4]) }
}

async function main() {
  const out = process.argv[2] || DEFAULT_OUT
  const today = new Date().toISOString().slice(0, 10)

  const pageHtml = await (await fetch(PAGE, { headers: { 'User-Agent': UA } })).text()
  const url = findDownloadUrl(pageHtml)
  if (!url) throw new Error('내려받기 링크를 찾지 못했습니다. 상세 페이지 구조가 바뀌었을 수 있습니다.')
  console.log('내려받기: ' + url.slice(0, 90))

  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const api = JSON.parse(await res.text())
  console.log('원본: ' + api.length.toLocaleString() + '행')

  const tally = {}
  const bump = (k) => {
    tally[k] = (tally[k] ?? 0) + 1
  }
  const rows = []
  const seasons = new Set()
  const allDates = new Set()

  for (let i = 0; i < api.length; i++) {
    const r = api[i]
    const lat = Number(r.위도)
    const lng = Number(r.경도)
    if (!(lat > 33 && lat < 39 && lng > 124 && lng < 132)) {
      bump('좌표 없음')
      continue
    }
    if (squash(r.요금정책) !== '무료') {
      bump('무료 아님')
      continue
    }

    // 개방일과 그날의 개방시간을 짝지어 읽는다. 날짜마다 시간이 다를 수 있다.
    const dates = []
    let hours = null
    for (let n = 1; n <= 5; n++) {
      const day = squash(r['휴일_' + n + '_개방일'])
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
      const t = readOpenTime(r['휴일_' + n + '_개방시간'])
      if (!t) continue
      dates.push(day)
      hours ??= t
    }
    if (dates.length === 0) {
      bump('개방일 없음(미개방)')
      continue
    }

    for (const d of dates) allDates.add(d)
    seasons.add(squash(r.연도) + ' ' + squash(r.명절구분))
    bump('담음')

    const label = squash(r.명절구분) + ' 연휴 무료개방'
    rows.push({
      prkplceNo: 'PZ-HOL-' + squash(r.연도) + '-' + i,
      prkplceNm: squash(r.자원명) || '명절 무료개방 주차장',
      prkplceSe: '공영',
      prkplceType: squash(r.주차장유형) || '노외',
      rdnmadr: squash(r.주소) + (squash(r.상세주소) ? ' ' + squash(r.상세주소) : ''),
      latitude: String(lat),
      longitude: String(lng),
      parkingchrgeInfo: '무료',
      operDay: '매일',
      weekdayOperOpenHhmm: hours.open,
      weekdayOperColseHhmm: hours.close,
      satOperOperOpenHhmm: hours.open,
      satOperCloseHhmm: hours.close,
      holidayOperOpenHhmm: hours.open,
      holidayCloseOpenHhmm: hours.close,
      basicTime: '0',
      basicCharge: '0',
      addUnitTime: '0',
      addUnitCharge: '0',
      dayCmmtkt: '0',
      prkcmprt: String(Number(String(r.주차면수 ?? '').replace(/[^0-9]/g, '')) || 0),
      spcmnt: label + (squash(r.참고사항) ? ' / ' + squash(r.참고사항).slice(0, 80) : ''),
      institutionNm: squash(r.기관명),
      // 이 날짜에만 결과에 넣는다.
      pzOpenDates: dates,
      pzSource: PAGE,
      pzVerifiedOn: today,
    })
  }

  await writeFile(
    out,
    JSON.stringify(
      {
        source: '행정안전부 — 전국 명절 무료주차장 현황',
        sourceUrl: PAGE,
        license: '행정안전부 제공 공공데이터. 명절 연휴에만 개방하는 주차장이라 개방일에만 노출된다',
        seasons: [...seasons].sort(),
        openDates: [...allDates].sort(),
        fetchedOn: today,
        rows,
      },
      null,
      1,
    ),
    'utf-8',
  )
  console.log('명절: ' + [...seasons].join(', '))
  console.log('개방일: ' + [...allDates].sort().join(', '))
  console.log('저장: ' + rows.length.toLocaleString() + '곳 → ' + out)
  console.log('분류: ' + JSON.stringify(tally))
}

if (process.argv[1] && process.argv[1].includes('fetch-holiday-parking')) {
  main().catch((err) => {
    console.error('✗ 실패:', err.message)
    process.exit(1)
  })
}
