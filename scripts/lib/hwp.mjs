/**
 * HWP 5.0 문서에서 글자만 뽑아낸다. 외부 의존성 없이 순수 Node 로 읽는다.
 *
 * 자치법규의 주차요금표는 거의 전부 한글 문서(.hwp)로 첨부돼 있다. 조례 본문 XML 에는
 * 별표 내용이 비어 있고, law.go.kr 의 별표 뷰어는 자바스크립트 껍데기만 준다.
 * 그래서 파일을 직접 읽는 수밖에 없다.
 *
 * ── 구조 ─────────────────────────────────────────────────
 * .hwp 는 마이크로소프트 복합 문서(CFB/OLE)다. 그 안에 스트림이 여럿 들어 있고
 * 본문은 BodyText/Section0, Section1 … 에 담긴다. FileHeader 의 속성 비트가 켜져
 * 있으면 각 구획이 raw deflate 로 눌려 있다.
 *
 * 구획을 풀면 레코드가 줄줄이 나온다. 레코드 머리는 4바이트 리틀엔디언이고
 *   태그 = 하위 10비트, 級 = 다음 10비트, 길이 = 상위 12비트
 * 이며 길이가 0xFFF 면 뒤따르는 4바이트가 진짜 길이다.
 * 글자는 태그 67(HWPTAG_PARA_TEXT)에 UTF-16LE 로 들어 있다.
 *
 * 제어문자 중 일부는 뒤에 7개 낱말(14바이트)을 더 끌고 다닌다. 이걸 건너뛰지 않으면
 * 표 안의 글자가 깨져 나온다 — 주차요금표는 대부분 표라서 반드시 처리해야 한다.
 */
import { inflateRawSync, inflateSync } from 'node:zlib'

const CFB_MAGIC = 'd0cf11e0a1b11ae1'
const FREESECT = 0xffffffff
const ENDOFCHAIN = 0xfffffffe

/** 복합 문서에서 <스트림 이름 → 바이트> 표를 만든다. */
export function readCompound(buf) {
  if (buf.subarray(0, 8).toString('hex') !== CFB_MAGIC) throw new Error('CFB 서명이 아닙니다')

  const sectorShift = buf.readUInt16LE(0x1e)
  const miniShift = buf.readUInt16LE(0x20)
  const sectorSize = 1 << sectorShift
  const miniSize = 1 << miniShift
  const dirStart = buf.readUInt32LE(0x30)
  const miniCutoff = buf.readUInt32LE(0x38)
  const miniFatStart = buf.readUInt32LE(0x3c)
  const difatStart = buf.readUInt32LE(0x44)
  const difatCount = buf.readUInt32LE(0x48)

  const at = (sector) => 512 + sector * sectorSize
  const slice = (sector) => buf.subarray(at(sector), at(sector) + sectorSize)

  // FAT 이 놓인 구획 번호들: 머리말에 109개까지 들어가고 나머지는 DIFAT 사슬에 이어진다.
  const fatSectors = []
  for (let i = 0; i < 109; i++) {
    const s = buf.readUInt32LE(0x4c + i * 4)
    if (s === FREESECT || s === ENDOFCHAIN) break
    fatSectors.push(s)
  }
  let next = difatStart
  for (let n = 0; n < difatCount && next !== ENDOFCHAIN && next !== FREESECT; n++) {
    const sec = slice(next)
    const per = sectorSize / 4 - 1
    for (let i = 0; i < per; i++) {
      const s = sec.readUInt32LE(i * 4)
      if (s === FREESECT || s === ENDOFCHAIN) break
      fatSectors.push(s)
    }
    next = sec.readUInt32LE(per * 4)
  }

  const fat = []
  for (const s of fatSectors) {
    const sec = slice(s)
    for (let i = 0; i < sectorSize / 4; i++) fat.push(sec.readUInt32LE(i * 4))
  }

  const chain = (start, table) => {
    const out = []
    let s = start
    const guard = table.length + 8
    while (s !== ENDOFCHAIN && s !== FREESECT && out.length < guard) {
      out.push(s)
      s = table[s] ?? ENDOFCHAIN
    }
    return out
  }
  const readChain = (start, size) => {
    const parts = chain(start, fat).map((s) => slice(s))
    return Buffer.concat(parts).subarray(0, size)
  }

  // 디렉터리 항목 128바이트씩
  const dirBuf = readChain(dirStart, chain(dirStart, fat).length * sectorSize)
  const entries = []
  for (let off = 0; off + 128 <= dirBuf.length; off += 128) {
    const nameLen = dirBuf.readUInt16LE(off + 0x40)
    if (nameLen <= 0 || nameLen > 64) {
      entries.push(null)
      continue
    }
    entries.push({
      name: dirBuf.subarray(off, off + nameLen - 2).toString('utf16le'),
      type: dirBuf.readUInt8(off + 0x42),
      start: dirBuf.readUInt32LE(off + 0x74),
      size: dirBuf.readUInt32LE(off + 0x78),
    })
  }

  const root = entries.find((e) => e && e.type === 5)
  if (!root) throw new Error('루트 항목을 찾지 못했습니다')

  // 작은 스트림은 미니 FAT 를 타고 루트의 미니 스트림 안에 들어 있다.
  const miniFatBuf = miniFatStart === ENDOFCHAIN ? Buffer.alloc(0) : readChain(miniFatStart, Number.MAX_SAFE_INTEGER)
  const miniFat = []
  for (let i = 0; i + 4 <= miniFatBuf.length; i += 4) miniFat.push(miniFatBuf.readUInt32LE(i))
  const miniStream = root.size > 0 ? readChain(root.start, root.size) : Buffer.alloc(0)

  const streams = new Map()
  for (const e of entries) {
    if (!e || e.type !== 2 || e.size === 0) continue
    if (e.size < miniCutoff) {
      const parts = chain(e.start, miniFat).map((s) => miniStream.subarray(s * miniSize, (s + 1) * miniSize))
      streams.set(e.name, Buffer.concat(parts).subarray(0, e.size))
    } else {
      streams.set(e.name, readChain(e.start, e.size))
    }
  }
  return streams
}

/** 눌려 있으면 풀고, 아니면 그대로 준다. */
function unpack(buf, compressed) {
  if (!compressed) return buf
  try {
    return inflateRawSync(buf)
  } catch {
    try {
      return inflateSync(buf)
    } catch {
      return buf
    }
  }
}

/*
 * 뒤에 낱말 7개를 더 끌고 다니는 제어문자들. 표·그림·각주 따위가 여기 속한다.
 * 건너뛰지 않으면 그 14바이트가 글자로 잘못 읽혀 표 내용이 깨진다.
 */
const EXTENDED = new Set([1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23])
/** 줄바꿈·문단나눔·칸나눔으로 볼 제어문자. */
const BREAKS = new Set([10, 13, 24, 25, 26, 27, 28, 29, 30, 31])

/** 한 구획(Section)에서 글자만 뽑는다. */
export function extractSection(data) {
  const out = []
  let pos = 0
  while (pos + 4 <= data.length) {
    const header = data.readUInt32LE(pos)
    pos += 4
    const tag = header & 0x3ff
    let size = (header >> 20) & 0xfff
    if (size === 0xfff) {
      if (pos + 4 > data.length) break
      size = data.readUInt32LE(pos)
      pos += 4
    }
    if (pos + size > data.length) break

    if (tag === 67) {
      const body = data.subarray(pos, pos + size)
      let i = 0
      while (i + 2 <= body.length) {
        const code = body.readUInt16LE(i)
        if (code < 32) {
          if (BREAKS.has(code)) out.push('\n')
          else if (code === 9) out.push('\t')
          i += EXTENDED.has(code) ? 16 : 2
          continue
        }
        out.push(String.fromCharCode(code))
        i += 2
      }
      out.push('\n')
    }
    pos += size
  }
  return out.join('')
}

/**
 * 최소한의 ZIP 읽기. HWPX·DOCX 가 ZIP 이라 필요하다.
 * 중앙 디렉터리를 뒤에서부터 찾아 항목을 훑고, 저장(0)·디플레이트(8)만 푼다.
 */
export function readZip(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66_000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('ZIP 끝 표지를 찾지 못했습니다')

  const count = buf.readUInt16LE(eocd + 10)
  let pos = buf.readUInt32LE(eocd + 16)
  const out = new Map()

  for (let n = 0; n < count && pos + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break
    const method = buf.readUInt16LE(pos + 10)
    const compSize = buf.readUInt32LE(pos + 20)
    const nameLen = buf.readUInt16LE(pos + 28)
    const extraLen = buf.readUInt16LE(pos + 30)
    const commentLen = buf.readUInt16LE(pos + 32)
    const localOff = buf.readUInt32LE(pos + 42)
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString('utf-8')
    pos += 46 + nameLen + extraLen + commentLen

    // 지역 머리말에서 실제 자료 시작점을 다시 계산한다(이름·여분 길이가 다를 수 있다).
    if (buf.readUInt32LE(localOff) !== 0x04034b50) continue
    const lNameLen = buf.readUInt16LE(localOff + 26)
    const lExtraLen = buf.readUInt16LE(localOff + 28)
    const start = localOff + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(start, start + compSize)
    try {
      out.set(name, method === 0 ? raw : inflateRawSync(raw))
    } catch {
      /* 못 푸는 항목은 건너뛴다 */
    }
  }
  return out
}

/** HWPX(.hwpx / ZIP) → 글자. 구획 XML 의 태그를 벗겨 낸다. */
export function hwpxToText(buf) {
  const zip = readZip(buf)
  const names = [...zip.keys()]
    .filter((n) => /Contents\/section\d+\.xml$/i.test(n))
    .sort()
  if (names.length === 0) {
    const prv = [...zip.keys()].find((n) => /PrvText\.txt$/i.test(n))
    if (prv) return zip.get(prv).toString('utf-8')
    throw new Error('HWPX 구획을 찾지 못했습니다')
  }
  const parts = []
  for (const n of names) {
    const xml = zip.get(n).toString('utf-8')
    // 문단·칸 끝을 줄바꿈으로 바꿔야 표가 한 줄로 뭉치지 않는다.
    parts.push(
      xml
        .replace(/<\/hp:p>/g, '\n')
        .replace(/<\/hp:tc>/g, '\t')
        .replace(/<\/hp:tr>/g, '\n')
        .replace(/<[^>]+>/g, ''),
    )
  }
  return parts.join('\n')
}

/** 형식을 알아서 가려 읽는다. .hwp(CFB) 와 .hwpx(ZIP) 둘 다 받는다. */
export function documentToText(buf) {
  if (buf.subarray(0, 2).toString('binary') === 'PK') return hwpxToText(buf)
  return hwpToText(buf)
}

/** .hwp 바이트 → 본문 글자. 못 읽으면 빈 문자열. */
export function hwpToText(buf) {
  const streams = readCompound(buf)
  const head = streams.get('FileHeader')
  if (!head || head.subarray(0, 17).toString('binary') !== 'HWP Document File') {
    throw new Error('HWP 5.0 문서가 아닙니다')
  }
  const compressed = (head.readUInt32LE(36) & 1) === 1

  const names = [...streams.keys()]
    .filter((n) => /^Section\d+$/.test(n))
    .sort((a, b) => Number(a.slice(7)) - Number(b.slice(7)))

  const parts = []
  for (const n of names) parts.push(extractSection(unpack(streams.get(n), compressed)))

  if (parts.join('').trim().length === 0 && streams.has('PrvText')) {
    // 본문을 못 읽으면 미리보기 글이라도 쓴다. 표는 안 들어 있을 수 있다.
    return streams.get('PrvText').toString('utf16le')
  }
  return parts.join('\n')
}
