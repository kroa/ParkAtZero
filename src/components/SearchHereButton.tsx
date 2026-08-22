import { motion, AnimatePresence } from 'framer-motion'
import { Crosshair } from 'lucide-react'
import { cn } from '@/lib/cn'

interface Props {
  /** 지도를 옮겨서 기준점과 멀어졌는가 */
  visible: boolean
  onClick: () => void
  className?: string
}

/**
 * "이 지역에서 다시 찾기".
 *
 * 결과는 언제나 기준점(origin) 반경 안에서만 고른다. 그런데 지도를 옮겨도 기준점은
 * 그대로라, 다른 동네로 밀어 보면 마커가 하나도 없어 그 지역엔 주차장이 없는 것처럼
 * 보인다. 기준점을 자동으로 따라 움직이게 하면 카드에 적힌 거리와 목록이 지도를
 * 건드릴 때마다 출렁이므로, 옮길지 말지는 사용자가 정하게 한다.
 */
export function SearchHereButton({ visible, onClick, className }: Props) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          data-testid="search-here"
          onClick={onClick}
          initial={{ opacity: 0, y: -8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          className={cn(
            'tap glass glass-shine pointer-events-auto flex items-center gap-1.5 rounded-full py-2 pl-3 pr-3.5',
            'text-[12.5px] font-bold text-ink shadow-[0_10px_28px_-10px_rgba(15,23,42,0.55)]',
            className,
          )}
        >
          <Crosshair className="h-3.5 w-3.5 text-brand-600 dark:text-brand-300" strokeWidth={2.6} />
          이 지역에서 다시 찾기
        </motion.button>
      )}
    </AnimatePresence>
  )
}
