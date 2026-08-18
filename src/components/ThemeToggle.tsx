import { motion } from 'framer-motion'
import { Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/cn'

interface Props {
  isDark: boolean
  onToggle: () => void
  className?: string
}

export function ThemeToggle({ isDark, onToggle, className }: Props) {
  return (
    <button
      type="button"
      data-testid="theme-toggle"
      onClick={onToggle}
      aria-label={isDark ? '라이트 모드로 전환' : '다크 모드로 전환'}
      aria-pressed={isDark}
      className={cn(
        'tap glass glass-shine relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full text-ink-soft transition-colors hover:text-ink',
        className,
      )}
    >
      <motion.span
        key={isDark ? 'moon' : 'sun'}
        initial={{ rotate: -60, opacity: 0, scale: 0.7 }}
        animate={{ rotate: 0, opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 26 }}
        className="flex items-center justify-center"
      >
        {isDark ? <Moon className="h-[18px] w-[18px]" strokeWidth={2.2} /> : <Sun className="h-[18px] w-[18px]" strokeWidth={2.2} />}
      </motion.span>
    </button>
  )
}
