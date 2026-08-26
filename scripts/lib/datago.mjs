/**
 * 공공데이터포털(data.go.kr) 내려받기 규약.
 *
 * 포털은 '표준데이터'와 '파일데이터'를 서로 다른 두 단계 규약으로 준다. 둘 다 인증키·쿠키가
 * 필요 없다. 화면의 내려받기 단추가 서버 파일을 그대로 주는 게 아니라 자바스크립트가 두 번
 * 호출해 브라우저에서 파일을 맞추기 때문에, 주소 하나만 찍으면 404 HTML 이 돌아온다.
 * 그래서 예전에는 '0바이트'로 보였다.
 *
 *  표준데이터  /download/columList.json  → totalCount·svcTableNm·colNmList
 *              /download/standard.json   → 위 셋 + perPage·page 를 모두 붙여야 200
 *
 *  파일데이터  /tcs/dss/selectFileDataDownload.do → atchFileId·fileDetailSn
 *              /cmm/cmm/fileDownload.do          → 실제 파일(csv 또는 xlsx)
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'

const headers = (pk) => ({ 'User-Agent': UA, Referer: 'https://www.data.go.kr/data/' + pk + '/fileData.do' })

/** 표준데이터를 통째로 받는다. 반환은 파싱된 JSON 배열. */
export async function downloadStandard(pk) {
  const col = await (
    await fetch('https://www.data.go.kr/download/columList.json?pk=' + pk + '&ext=JSON', { headers: headers(pk) })
  ).json()

  /*
   * colNmList 는 columList[].columCode(29개)가 아니라 tableVO.colNmList(27개)다.
   * 둘은 개수부터 다르고, 29개를 넘기면 서버가 200 에 빈 본문을 돌려준다 — 오류도 없이
   * 그냥 0바이트다. jQuery traditional:true 방식이라 키를 반복해서 붙여야 한다.
   */
  const cols = col.tableVO?.colNmList ?? (col.columList ?? []).map((c) => c.columCode)
  const q = new URLSearchParams()
  q.set('publicDataPk', String(pk))
  for (const c of cols) q.append('colNmList', c)
  q.set('totalCount', String(col.totalCount ?? 0))
  q.set('svcTableNm', String(col.tableVO?.svcTableNm ?? col.svcTableNm ?? ''))
  q.set('perPage', '10000')
  q.set('page', '1')

  const res = await fetch('https://www.data.go.kr/download/standard.json?' + q, { headers: headers(pk) })
  if (!res.ok) throw new Error('표준데이터 ' + pk + ' 응답 ' + res.status)
  const text = await res.text()
  if (text.trimStart().startsWith('<')) throw new Error('표준데이터 ' + pk + ' 가 HTML 을 돌려줬습니다')
  if (!text.trim()) throw new Error('표준데이터 ' + pk + ' 가 빈 본문을 돌려줬습니다 — colNmList 를 확인하세요')

  const body = JSON.parse(text)
  const rows = Array.isArray(body) ? body : (body.data ?? body.records ?? [])
  const names = new Map((col.columList ?? []).map((c) => [c.columCode, c.columNm]))
  // 코드(OPEN_FCLTY_NM) 대신 한글 컬럼명으로 바꿔 둔다. 다른 스크립트와 결이 같아진다.
  return rows.map((r) => {
    const o = {}
    for (const [k, v] of Object.entries(r)) o[names.get(k) ?? k] = v
    return o
  })
}

/** 파일데이터(csv/xlsx)를 받는다. 반환은 { buffer, name, isXlsx }. */
export async function downloadFile(pk) {
  const page = await (await fetch('https://www.data.go.kr/data/' + pk + '/fileData.do', { headers: headers(pk) })).text()
  const uddi =
    /publicDataDetailPk"\s+name="publicDataDetailPk"\s+value="([^"]+)"/.exec(page)?.[1] ??
    /fn_fileDataDown\('\d+',\s*'([^']+)'/.exec(page)?.[1]
  if (!uddi) throw new Error('파일데이터 ' + pk + ' 의 publicDataDetailPk 를 찾지 못했습니다')

  const q = new URLSearchParams({ publicDataPk: String(pk), publicDataDetailPk: uddi })
  const meta = await (
    await fetch('https://www.data.go.kr/tcs/dss/selectFileDataDownload.do?' + q, { headers: headers(pk) })
  ).json()
  if (!meta.status) throw new Error('파일데이터 ' + pk + ' 내려받기를 거부당했습니다')

  const res = await fetch(
    'https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=' + meta.atchFileId + '&fileDetailSn=' + meta.fileDetailSn,
    { headers: headers(pk) },
  )
  const buffer = Buffer.from(await res.arrayBuffer())
  return {
    buffer,
    name: String(meta.dataSetFileDetailInfo?.dataNm ?? pk),
    isXlsx: buffer.subarray(0, 2).toString('binary') === 'PK',
  }
}

/** 포털 CSV 는 대개 cp949 다. utf-8 로 읽히면 그쪽을 쓴다. */
export function decodeCsv(buffer) {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
  if (!utf8.includes('�')) return utf8.replace(/^﻿/, '')
  return new TextDecoder('euc-kr').decode(buffer)
}

/** 따옴표·줄바꿈을 지키는 최소 CSV 파서. 첫 줄을 헤더로 보고 객체 배열을 만든다. */
export function parseCsv(text) {
  const rows = []
  let field = ''
  let row = []
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      field = ''
      if (row.length > 1) rows.push(row)
      row = []
    } else if (c !== '\r') field += c
  }
  if (field || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  if (rows.length === 0) return []
  const head = rows[0].map((h) => h.trim())
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])))
}
