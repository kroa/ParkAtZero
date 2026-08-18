import type { LatLng } from '@/lib/geo'

export interface Landmark extends LatLng {
  name: string
  /** 검색 매칭을 넓히기 위한 별칭 */
  aliases?: string[]
  region: string
  /** 검색 결과 이동 시 사용할 기본 줌 */
  zoom: number
}

/**
 * 지오코딩 API 없이도 "강남역", "홍대" 같은 검색이 동작하도록 하는 내장 사전.
 * VITE_KAKAO_REST_KEY 가 설정되면 카카오 로컬 API 결과가 우선하고, 이 사전은 오프라인 폴백이 된다.
 */
export const LANDMARKS: Landmark[] = [
  { name: '서울시청', aliases: ['시청', '덕수궁'], region: '서울 중구', lat: 37.5663, lng: 126.9779, zoom: 15 },
  { name: '광화문', aliases: ['경복궁', '세종대로'], region: '서울 종로구', lat: 37.5759, lng: 126.9769, zoom: 15 },
  { name: '강남역', aliases: ['강남'], region: '서울 강남구', lat: 37.4979, lng: 127.0276, zoom: 15 },
  { name: '삼성역', aliases: ['코엑스', '무역센터'], region: '서울 강남구', lat: 37.5088, lng: 127.0631, zoom: 15 },
  { name: '홍대입구역', aliases: ['홍대', '연남동'], region: '서울 마포구', lat: 37.5572, lng: 126.9245, zoom: 15 },
  { name: '여의도', aliases: ['국회의사당', 'IFC'], region: '서울 영등포구', lat: 37.5219, lng: 126.9245, zoom: 14 },
  { name: '잠실역', aliases: ['롯데월드', '석촌호수'], region: '서울 송파구', lat: 37.5133, lng: 127.1 , zoom: 15 },
  { name: '성수동', aliases: ['성수', '서울숲'], region: '서울 성동구', lat: 37.5445, lng: 127.0557, zoom: 15 },
  { name: '이태원', aliases: ['한남동', '경리단길'], region: '서울 용산구', lat: 37.5345, lng: 126.9946, zoom: 15 },
  { name: '명동', aliases: ['을지로', '남대문'], region: '서울 중구', lat: 37.5636, lng: 126.9827, zoom: 15 },
  { name: '건대입구', aliases: ['건대', '커먼그라운드'], region: '서울 광진구', lat: 37.5403, lng: 127.0695, zoom: 15 },
  { name: '노원역', aliases: ['상계동'], region: '서울 노원구', lat: 37.6551, lng: 127.0614, zoom: 14 },
  { name: '목동', aliases: ['오목교', '현대백화점 목동'], region: '서울 양천구', lat: 37.5262, lng: 126.8752, zoom: 14 },
  { name: '수유역', aliases: ['강북구청'], region: '서울 강북구', lat: 37.6379, lng: 127.0256, zoom: 14 },
  { name: '가산디지털단지', aliases: ['가산', 'G밸리'], region: '서울 금천구', lat: 37.4816, lng: 126.8825, zoom: 14 },
  { name: '연신내', aliases: ['불광동'], region: '서울 은평구', lat: 37.6191, lng: 126.921, zoom: 14 },
  { name: '왕십리', aliases: ['한양대'], region: '서울 성동구', lat: 37.5613, lng: 127.0374, zoom: 15 },
  { name: '사당역', aliases: ['이수', '방배'], region: '서울 동작구', lat: 37.4766, lng: 126.9816, zoom: 15 },

  { name: '판교역', aliases: ['판교', '테크노밸리'], region: '경기 성남시', lat: 37.3947, lng: 127.1112, zoom: 15 },
  { name: '수원화성', aliases: ['수원', '행궁동'], region: '경기 수원시', lat: 37.2872, lng: 127.0146, zoom: 14 },
  { name: '일산호수공원', aliases: ['일산', '정발산'], region: '경기 고양시', lat: 37.6584, lng: 126.7699, zoom: 14 },
  { name: '인천공항', aliases: ['영종도', 'ICN'], region: '인천 중구', lat: 37.4602, lng: 126.4407, zoom: 13 },
  { name: '송도', aliases: ['송도국제도시', '센트럴파크'], region: '인천 연수구', lat: 37.3826, lng: 126.6437, zoom: 14 },

  { name: '해운대', aliases: ['부산 해운대', '마린시티'], region: '부산 해운대구', lat: 35.1587, lng: 129.1604, zoom: 14 },
  { name: '서면', aliases: ['부산 서면'], region: '부산 부산진구', lat: 35.1578, lng: 129.0594, zoom: 15 },
  { name: '대구 동성로', aliases: ['동성로', '반월당'], region: '대구 중구', lat: 35.8693, lng: 128.5947, zoom: 15 },
  { name: '대전역', aliases: ['대전', '중앙로'], region: '대전 동구', lat: 36.3315, lng: 127.4344, zoom: 14 },
  { name: '광주 충장로', aliases: ['충장로', '광주'], region: '광주 동구', lat: 35.1487, lng: 126.9165, zoom: 15 },
  { name: '전주한옥마을', aliases: ['전주', '한옥마을'], region: '전북 전주시', lat: 35.8151, lng: 127.153, zoom: 15 },
  { name: '제주공항', aliases: ['제주', 'CJU'], region: '제주 제주시', lat: 33.5104, lng: 126.4914, zoom: 13 },
  { name: '강릉 경포대', aliases: ['강릉', '경포'], region: '강원 강릉시', lat: 37.7955, lng: 128.8964, zoom: 14 },
  { name: '속초 중앙시장', aliases: ['속초'], region: '강원 속초시', lat: 38.2049, lng: 128.5915, zoom: 14 },
]

/** 공백/특수문자를 지운 소문자 키 — "강남 역", "강남역" 모두 매칭시키기 위함 */
export function searchKey(text: string): string {
  return text.toLowerCase().replace(/[\s·,.\-()]/g, '')
}

export function findLandmarks(query: string, limit = 4): Landmark[] {
  const q = searchKey(query)
  if (q.length < 1) return []
  const scored: Array<{ item: Landmark; score: number }> = []

  for (const lm of LANDMARKS) {
    const candidates = [lm.name, lm.region, ...(lm.aliases ?? [])]
    let best = -1
    for (const c of candidates) {
      const key = searchKey(c)
      if (key === q) best = Math.max(best, 100)
      else if (key.startsWith(q)) best = Math.max(best, 80)
      else if (key.includes(q)) best = Math.max(best, 55)
    }
    if (best > 0) scored.push({ item: lm, score: best })
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.item)
}
