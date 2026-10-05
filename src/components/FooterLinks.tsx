import { cn } from '@/lib/cn'

interface Props {
  className?: string
}

export const FOOTER_LINKS = [
  { href: '/지역/', label: '지역별 무료 주차장' },
  { href: '/공휴일-무료주차장/', label: '공휴일 무료 주차장' },
  { href: '/야간-무료주차장/', label: '야간 무료 주차장' },
  { href: '/일요일-무료주차장/', label: '일요일 무료 주차장' },
  { href: '/토요일-무료주차장/', label: '토요일 무료 주차장' },
  { href: '/24시간-무료주차장/', label: '24시간 무료 주차장' },
] as const

/**
 * 앱 하단에 실제 <a> 링크를 렌더링하는 푸터.
 *
 * SPA 가 마운트된 후에도 구글봇 등 검색엔진 크롤러가 272개 정적 페이지(지역·상황)로
 * 건너갈 수 있도록 크롤 경로를 유지한다 (함정 11 방지).
 */
export function FooterLinks({ className }: Props) {
  return (
    <footer
      data-testid="footer-links"
      className={cn('border-t border-hairline/60 pt-3 pb-2 text-[11px] text-ink-mute', className)}
    >
      <nav aria-label="주요 무료 주차장 안내">
        <ul className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5 leading-relaxed">
          {FOOTER_LINKS.map((link, idx) => (
            <li key={link.href} className="inline-flex items-center gap-x-2.5">
              <a
                href={link.href}
                className="font-medium text-ink-soft transition-colors hover:text-brand-600 hover:underline dark:hover:text-brand-400"
              >
                {link.label}
              </a>
              {idx < FOOTER_LINKS.length - 1 && (
                <span className="text-ink-mute/30" aria-hidden>
                  ·
                </span>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  )
}
