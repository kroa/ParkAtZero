import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Tailwind 클래스 충돌을 마지막 선언 우선으로 정리해 합친다. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
