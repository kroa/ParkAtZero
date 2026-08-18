const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토']

export function toDateInputValue(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + day
}

export function toTimeInputValue(d: Date): string {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

/** date/time input 두 개의 문자열을 하나의 Date 로 합친다. 파싱 실패 시 원본 유지. */
export function fromInputs(dateStr: string, timeStr: string, fallback: Date): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [hh, mm] = timeStr.split(':').map(Number)
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return fallback
  const next = new Date(y, m - 1, d, hh, mm, 0, 0)
  return Number.isNaN(next.getTime()) ? fallback : next
}

/** "8월 18일 (화) 오후 2:30" */
export function formatVisitLabel(d: Date): string {
  const month = d.getMonth() + 1
  const day = d.getDate()
  const w = WEEKDAY_KO[d.getDay()]
  const h24 = d.getHours()
  const ampm = h24 < 12 ? '오전' : '오후'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  const mm = String(d.getMinutes()).padStart(2, '0')
  return month + '월 ' + day + '일 (' + w + ') ' + ampm + ' ' + h12 + ':' + mm
}

export function formatWeekday(d: Date): string {
  return WEEKDAY_KO[d.getDay()] ?? ''
}

/** 오늘/내일/모레 같은 상대 표기 — 날짜 칩에 쓴다. */
export function relativeDayLabel(d: Date, now = new Date()): string | null {
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const diff = Math.round((a - b) / 86_400_000)
  if (diff === 0) return '오늘'
  if (diff === 1) return '내일'
  if (diff === 2) return '모레'
  if (diff === -1) return '어제'
  return null
}

/** 분 단위를 5분 그리드로 스냅 — 시간 입력의 미세한 흔들림 제거 */
export function snapToFiveMinutes(d: Date): Date {
  const out = new Date(d)
  out.setMinutes(Math.round(out.getMinutes() / 5) * 5, 0, 0)
  return out
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000)
}
