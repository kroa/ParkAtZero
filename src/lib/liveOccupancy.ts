/**
 * 지금 자리가 얼마나 남았는지 가져온다.
 *
 * 사용자가 망원한강공원에 갔다가 자리가 없어 한참 기다렸다. "지금 자리가 널널한지
 * 대기가 엄청난지 알면 좋겠다"고 했다. 서울시 주차정보안내시스템이 2~3분 주기로
 * 현재 주차대수를 갱신하는 곳이 서울 72곳 있고, 사용자가 겪은 망원 일대가 거기 든다.
 *
 * 값은 스냅샷에 담지 않는다 — 빌드 시점 대수는 배포되는 순간 낡는다. 어느 곳에
 * 물어볼 수 있는지(parking.live)만 담아 두고, 화면에 보이는 곳만 그때그때 묻는다.
 *
 * 실패하면 조용히 비운다. 실시간이 없어도 앱은 원래대로 동작해야 한다.
 */
import { useEffect, useState } from 'react'
import type { Parking } from '@/types/parking'

export interface LiveOccupancy {
  /** 지금 비어 있는 면수 */
  free: number
  capacity: number
  /** 원본이 이 값을 갱신한 시각(ISO) */
  updatedAt: string
}

/** 서버가 한 번에 받아 주는 수와 맞춘다. 지도 한 화면에 보이는 것보다 넉넉하다. */
const MAX_CODES = 20
/** 원본이 2~3분 주기로 갱신하므로 그에 맞춘다. */
const REFRESH_MS = 120_000

/**
 * 주차장 id 에서 서울시 주차장 코드를 뽑는다.
 * id 는 'PZ-SEOUL-3020856@37.55598,126.90003' 모양이다.
 */
function codeOf(id: string): string | null {
  if (!id.startsWith('PZ-SEOUL-')) return null
  const code = id.slice('PZ-SEOUL-'.length).split('@')[0]
  return /^[0-9]{3,12}$/.test(code) ? code : null
}

export function useLiveOccupancy(items: Array<{ parking: Parking }>): Map<string, LiveOccupancy> {
  const [live, setLive] = useState<Map<string, LiveOccupancy>>(() => new Map())

  /*
   * 코드 목록을 문자열로 만들어 의존성으로 쓴다.
   *
   * items 는 지도를 움직일 때마다 새 배열이 된다. 배열을 그대로 의존성에 넣으면
   * 살짝만 움직여도 다시 불러 원본 서버를 두드리게 된다. 실제로 물어볼 코드가
   * 달라졌을 때만 다시 부른다.
   */
  const codes: string[] = []
  for (const it of items) {
    if (!it.parking.live) continue
    const c = codeOf(it.parking.id)
    if (c && !codes.includes(c)) codes.push(c)
    if (codes.length >= MAX_CODES) break
  }
  const key = codes.join(',')

  useEffect(() => {
    if (!key) {
      setLive((prev) => (prev.size === 0 ? prev : new Map()))
      return
    }
    // E2E 는 네트워크에 기대면 안 된다. 실시간 없이도 화면이 같아야 통과한다.
    if (import.meta.env.VITE_E2E === 'true') return

    let alive = true
    const load = async () => {
      try {
        const res = await fetch('/api/live?codes=' + key)
        if (!res.ok) return
        const body = (await res.json()) as { lots?: Array<LiveOccupancy & { code: string }> }
        if (!alive) return
        const next = new Map<string, LiveOccupancy>()
        for (const lot of body.lots ?? []) {
          next.set(lot.code, { free: lot.free, capacity: lot.capacity, updatedAt: lot.updatedAt })
        }
        setLive(next)
      } catch {
        /* 실시간은 없어도 그만이다 */
      }
    }
    void load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [key])

  /*
   * 서버는 코드로 답하고 화면은 주차장 id 로 찾는다. 여기서 한 번 옮겨 준다.
   * 요청한 코드가 응답에 없을 수 있다 — 값이 낡았거나 계량기가 어긋나 서버가
   * 버린 경우다. 그런 곳은 그냥 실시간 없이 보여 준다.
   */
  const byId = new Map<string, LiveOccupancy>()
  for (const it of items) {
    const c = it.parking.live ? codeOf(it.parking.id) : null
    const hit = c ? live.get(c) : undefined
    if (hit) byId.set(it.parking.id, hit)
  }
  return byId
}
