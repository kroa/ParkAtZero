import { ExternalLink, Info } from 'lucide-react'
import { cn } from '@/lib/cn'

interface Props {
  /** 예시 데이터로 동작 중이면 공공데이터 출처를 달면 안 된다. */
  isSample: boolean
  /** 스냅샷에 실린 주차장 수 */
  count: number
  /** 원본 데이터 기준일 (YYYY-MM-DD) */
  referenceDate?: string
  className?: string
}

const DATASET_URL = 'https://www.data.go.kr/data/15012896/standard.do'
const KOGL_URL = 'https://www.kogl.or.kr/info/license.do#01-tab'

/**
 * 공공누리 제1유형(저작자표시) 출처 표시.
 *
 * 활용신청 시 동의한 이용허락범위가 '저작자표시'다. 상업적 이용과 변형은 자유지만
 * 출처 표시는 의무이며, 공공누리는 저작물명·제공기관·이용조건을 밝히도록 안내한다.
 * 지도 타일(OpenStreetMap·CARTO) 저작권은 지도 우하단에 별도 표기된다.
 */
export function AttributionNotice({ isSample, count, referenceDate, className }: Props) {
  if (isSample) {
    return (
      <p
        data-testid="attribution"
        className={cn(
          'flex items-start justify-center gap-1.5 text-center text-[11px] leading-relaxed text-ink-mute',
          className,
        )}
      >
        <Info className="mt-[1px] h-3 w-3 shrink-0" strokeWidth={2.4} />
        기능 시연용 예시 데이터입니다. 실제 요금·운영시간이 아닙니다
      </p>
    )
  }

  return (
    <div
      data-testid="attribution"
      className={cn('rounded-xl bg-ink/[0.03] px-3 py-2.5 dark:bg-white/[0.03]', className)}
    >
      <p className="text-[11px] leading-relaxed text-ink-mute">
        본 서비스는 <b className="font-semibold text-ink-soft">행정안전부</b>가 공공누리{' '}
        <a
          href={KOGL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-brand-600 underline-offset-2 hover:underline dark:text-brand-300"
        >
          제1유형(출처표시)
        </a>
        으로 개방한{' '}
        <a
          href={DATASET_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 font-semibold text-brand-600 underline-offset-2 hover:underline dark:text-brand-300"
        >
          전국주차장정보표준데이터
          <ExternalLink className="h-2.5 w-2.5" strokeWidth={2.6} />
        </a>
        를 이용하였으며, 해당 저작물은 공공데이터포털에서 무료로 받을 수 있습니다.
      </p>

      <p className="tnum mt-1.5 border-t border-hairline/60 pt-1.5 text-[10.5px] text-ink-mute">
        {referenceDate ? '데이터 기준일 ' + referenceDate + ' · ' : ''}
        {count.toLocaleString('ko-KR')}곳 · 요금과 운영시간은 현장과 다를 수 있으니 안내판을 확인하세요
      </p>
    </div>
  )
}
