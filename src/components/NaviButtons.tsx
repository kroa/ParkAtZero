import { motion } from 'framer-motion'
import { Navigation } from 'lucide-react'
import { cn } from '@/lib/cn'
import { buildNaviLinks, openNavi, type NaviApp, type NaviTarget } from '@/lib/navi'

interface Props {
  target: NaviTarget
  size?: 'sm' | 'md'
  className?: string
}

/** 각 서비스의 시각 아이덴티티를 살린 미니 로고. 외부 이미지 없이 인라인 SVG 로 그려 CLS/차단 이슈를 없앤다. */
function NaviGlyph({ app }: { app: NaviApp }) {
  switch (app) {
    case 'kakao':
      return (
        <svg viewBox="0 0 24 24" className="h-[20px] w-[20px]" aria-hidden>
          <path
            fill="#3C1E1E"
            d="M12 4.2c-4.3 0-7.8 2.7-7.8 6.1 0 2.2 1.5 4.1 3.7 5.2l-.9 3.3c-.1.3.2.5.5.4l3.9-2.5c.2 0 .4 0 .6 0 4.3 0 7.8-2.7 7.8-6.4S16.3 4.2 12 4.2Z"
          />
        </svg>
      )
    case 'naver':
      return (
        <svg viewBox="0 0 24 24" className="h-[16px] w-[16px]" aria-hidden>
          <path fill="#fff" d="M8 6h3.4l3.1 4.7V6H18v12h-3.4l-3.1-4.7V18H8V6Z" />
        </svg>
      )
    case 'tmap':
      return (
        <svg viewBox="0 0 24 24" className="h-[20px] w-[20px]" aria-hidden>
          <path fill="#fff" d="M6 5h12v3h-4.2v11h-3.6V8H6V5Z" />
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 24 24" className="h-[16px] w-[16px]" aria-hidden>
          <path
            fill="#fff"
            d="M12 3.6c-3.1 0-5.6 2.5-5.6 5.6 0 4.2 5.6 11.2 5.6 11.2s5.6-7 5.6-11.2c0-3.1-2.5-5.6-5.6-5.6Zm0 7.7a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2Z"
          />
        </svg>
      )
  }
}

/**
 * 1-Tap 길안내.
 * 티맵·카카오내비 52px 대형 듀얼 버튼 상단 배치 + 네이버·구글 보조 배치.
 */
export function NaviButtons({ target, className }: Props) {
  const links = buildNaviLinks(target)
  const primaryLinks = [links.find((l) => l.id === 'tmap'), links.find((l) => l.id === 'kakao')].filter(Boolean)
  const secondaryLinks = [links.find((l) => l.id === 'naver'), links.find((l) => l.id === 'google')].filter(Boolean)

  return (
    <div className={cn('space-y-2', className)} role="group" aria-label="길안내 앱 선택">
      {/* 1) 주력 내비 2종: 52px 대형 듀얼 버튼 (Thumb Zone 최적화) */}
      <div className="grid grid-cols-2 gap-2">
        {primaryLinks.map((link) => (
          <motion.a
            key={link!.id}
            data-testid={'navi-' + link!.id}
            data-href={link!.web}
            href={link!.web}
            onClick={(e) => {
              e.preventDefault()
              openNavi(link!)
            }}
            whileTap={{ scale: 0.96 }}
            whileHover={{ y: -1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 26 }}
            className="tap flex h-[52px] items-center gap-2.5 rounded-2xl border border-hairline/80 bg-surface-raised px-3.5 shadow-sm transition-colors hover:border-brand-400/50 hover:bg-brand-500/[0.06] active:scale-98"
            aria-label={link!.label + '으로 길안내'}
          >
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-[0_2px_6px_-2px_rgba(15,23,42,0.35)]"
              style={{ backgroundColor: link!.color }}
            >
              <NaviGlyph app={link!.id} />
            </span>
            <div className="min-w-0 text-left">
              <span className="block truncate text-[13px] font-extrabold leading-tight text-ink">{link!.label}</span>
              <span className="block text-[11px] font-semibold text-ink-mute">길안내</span>
            </div>
          </motion.a>
        ))}
      </div>

      {/* 2) 보조 내비 2종: 컴팩트 듀얼 버튼 */}
      <div className="grid grid-cols-2 gap-2">
        {secondaryLinks.map((link) => (
          <motion.a
            key={link!.id}
            data-testid={'navi-' + link!.id}
            data-href={link!.web}
            href={link!.web}
            onClick={(e) => {
              e.preventDefault()
              openNavi(link!)
            }}
            whileTap={{ scale: 0.96 }}
            whileHover={{ y: -1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 26 }}
            className="tap flex h-10 items-center justify-center gap-2 rounded-xl border border-hairline/60 bg-surface-raised/60 px-3 transition-colors hover:border-brand-400/40 hover:bg-brand-500/[0.04]"
            aria-label={link!.label + '으로 길안내'}
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: link!.color }}
            >
              <NaviGlyph app={link!.id} />
            </span>
            <span className="text-[12px] font-bold text-ink-soft">{link!.label}</span>
          </motion.a>
        ))}
      </div>
    </div>
  )
}

/** 카드 안에 들어가는 축약형 — 아이콘 하나로 기본 지도 앱을 연다. */
export function NaviQuickButton({ target, className }: Props) {
  const primary = buildNaviLinks(target)[0]!

  return (
    <button
      type="button"
      data-testid="navi-quick"
      onClick={(e) => {
        e.stopPropagation()
        openNavi(primary)
      }}
      aria-label="길안내 시작"
      className={cn(
        'tap tap-target-44 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-brand-600 transition-colors hover:bg-brand-500 hover:text-white dark:text-brand-300 dark:hover:text-white',
        className,
      )}
    >
      <Navigation className="h-4 w-4" strokeWidth={2.4} fill="currentColor" />
    </button>
  )
}
