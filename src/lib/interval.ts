/** 반열림 구간 [start, end) 을 분 단위로 다루는 최소 유틸. 무료/운영/과금 구간 계산에 쓴다. */
export interface Interval {
  start: number
  end: number
}

export function makeInterval(start: number, end: number): Interval | null {
  return end > start ? { start, end } : null
}

export function intersect(a: Interval, b: Interval): Interval | null {
  const start = Math.max(a.start, b.start)
  const end = Math.min(a.end, b.end)
  return end > start ? { start, end } : null
}

export function intersectAll(list: Interval[], clip: Interval): Interval[] {
  const out: Interval[] = []
  for (const it of list) {
    const hit = intersect(it, clip)
    if (hit) out.push(hit)
  }
  return out
}

/** 겹치거나 맞닿은 구간을 병합해 정규형으로 만든다. */
export function union(list: Interval[]): Interval[] {
  if (list.length === 0) return []
  const sorted = [...list].sort((a, b) => a.start - b.start)
  const out: Interval[] = [{ ...sorted[0]! }]
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!
    const last = out[out.length - 1]!
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end)
    } else {
      out.push({ ...cur })
    }
  }
  return out
}

export function totalLength(list: Interval[]): number {
  return list.reduce((sum, it) => sum + (it.end - it.start), 0)
}

/** point 를 포함하는 구간을 찾는다. 없으면 null. */
export function findContaining(list: Interval[], point: number): Interval | null {
  for (const it of list) {
    if (point >= it.start && point < it.end) return it
  }
  return null
}

/** 두 구간 리스트의 교집합. 둘 다 정규형(union 통과)일 필요는 없다. */
export function intersectLists(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = []
  for (const x of a) {
    for (const y of b) {
      const hit = intersect(x, y)
      if (hit) out.push(hit)
    }
  }
  return union(out)
}
