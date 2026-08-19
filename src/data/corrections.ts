/**
 * 원본 데이터의 누락을 덮는 보정표.
 *
 * 「전국주차장정보표준데이터」의 특기사항(spcmnt)은 지자체가 자유롭게 적는 칸이라,
 * 같은 성격의 주차장인데도 어떤 곳은 '관광버스 전용'이라 적혀 있고 어떤 곳은 비어 있다.
 * 예컨대 남산공원 '소월로'는 적혀 있는데 바로 옆 '소파로'는 비어 있다. 둘 다 관광버스
 * 전용인데도 그렇다. 그 상태로는 승용차 운전자에게 21면짜리 무료 주차장으로 보인다.
 *
 * 그래서 관리기관 공식 페이지에서 직접 확인한 것만 여기에 적어 덮는다.
 * 추측으로 채우지 않는다 — 모든 항목에 확인 출처와 확인 날짜를 남긴다.
 *
 * 한계
 *  전국을 다 훑은 목록이 아니다. 서울시설공단 직영 주차장처럼 공식 목록이 공개되어
 *  있고 이용자가 많은 곳부터 채웠다. 여기 없다고 제한이 없다는 뜻은 아니므로,
 *  UI 는 구획 수가 적은 무료 노상 주차장에 대해 별도로 주의를 준다.
 */
export interface Correction {
  /** 공공데이터의 주차장명(prkplceNm)과 정확히 일치해야 한다. */
  name: string
  /** 동명이인을 가르기 위한 관리기관명(institutionNm). */
  institution: string
  /** 일반 차량이 댈 수 없는 이유. Evaluation.restriction 으로 그대로 노출된다. */
  restriction: string
  /** 확인한 출처 */
  source: string
  /** 확인한 날짜 */
  verifiedOn: string
}

const SISUL = '서울시설공단'
const SISUL_LIST = 'https://www.sisul.or.kr/open_content/parking/guidance/info.jsp'

export const CORRECTIONS: Correction[] = [
  // 서울시설공단 직영 공영주차장 목록의 '차종' 칸이 관광버스전용인데
  // 공공데이터 특기사항에는 비어 있는 것들.
  {
    name: '남산공원 소파로',
    institution: SISUL,
    restriction: '관광버스 전용',
    source: 'https://www.sisul.or.kr/open_content/parking/bbs/bbsMsgDetail.do?msg_seq=57&bcd=parking',
    verifiedOn: '2026-08-20',
  },
  {
    name: '장충단로(한남광장)',
    institution: SISUL,
    restriction: '관광버스 전용',
    source: 'https://www.sisul.or.kr/open_content/parking/bbs/bbsMsgDetail.do?msg_seq=64&bcd=parking',
    verifiedOn: '2026-08-20',
  },
  {
    name: 'DDP동측(양쪽)',
    institution: SISUL,
    restriction: '관광버스 전용',
    source: SISUL_LIST,
    verifiedOn: '2026-08-20',
  },
  {
    name: '남산예장',
    institution: SISUL,
    restriction: '관광버스 전용',
    source: SISUL_LIST,
    verifiedOn: '2026-08-20',
  },
]

const INDEX = new Map<string, Correction>(
  CORRECTIONS.map((c) => [key(c.name, c.institution), c]),
)

function key(name: string, institution: string): string {
  return name.replace(/\s/g, '') + '|' + institution.replace(/\s/g, '')
}

export function findCorrection(name: string, institution: string | undefined): Correction | undefined {
  if (!institution) return undefined
  return INDEX.get(key(name, institution))
}
