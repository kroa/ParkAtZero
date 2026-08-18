import type { ParkingStatus } from '@/types/parking'

/**
 * 상태 컬러 시스템의 단일 소스.
 * 뱃지·마커·카드 테두리·필터칩이 모두 여기서만 색을 가져간다 — 한 곳만 고치면 전부 맞춰진다.
 */
export interface StatusStyle {
  label: string
  short: string
  /** 뱃지 (텍스트 + 배경 + 링) */
  badge: string
  /** 카드 좌측 강조선 */
  accent: string
  /** 지도 마커 배경 (CSS color) */
  markerFill: string
  markerRing: string
  /** 마커 텍스트 색 */
  markerInk: string
  /** 필터칩 선택 상태 */
  chipActive: string
  dot: string
}

export const STATUS_STYLE: Record<ParkingStatus, StatusStyle> = {
  free: {
    label: '완전 무료',
    short: '0원',
    badge: 'bg-free-500/14 text-free-700 ring-1 ring-free-500/30 dark:bg-free-400/15 dark:text-free-300 dark:ring-free-400/25',
    accent: 'bg-free-500',
    markerFill: '#10b981',
    markerRing: 'rgba(16,185,129,0.30)',
    markerInk: '#ffffff',
    chipActive: 'bg-free-500 text-white shadow-[0_6px_16px_-6px_rgba(16,185,129,0.9)]',
    dot: 'bg-free-500',
  },
  conditional: {
    label: '조건부 무료',
    short: '조건부',
    badge:
      'bg-conditional-500/14 text-conditional-700 ring-1 ring-conditional-500/30 dark:bg-conditional-400/15 dark:text-conditional-300 dark:ring-conditional-400/25',
    accent: 'bg-conditional-500',
    markerFill: '#f97316',
    markerRing: 'rgba(249,115,22,0.30)',
    markerInk: '#ffffff',
    chipActive: 'bg-conditional-500 text-white shadow-[0_6px_16px_-6px_rgba(249,115,22,0.9)]',
    dot: 'bg-conditional-500',
  },
  paid: {
    label: '유료',
    short: '유료',
    badge: 'bg-paid-500/12 text-paid-600 ring-1 ring-paid-500/25 dark:bg-paid-400/12 dark:text-paid-300 dark:ring-paid-400/20',
    accent: 'bg-paid-400',
    markerFill: '#64748b',
    markerRing: 'rgba(100,116,139,0.28)',
    markerInk: '#ffffff',
    chipActive: 'bg-paid-600 text-white',
    dot: 'bg-paid-500',
  },
  closed: {
    label: '운영 종료',
    short: '종료',
    badge: 'bg-paid-500/10 text-paid-500 ring-1 ring-paid-500/20 dark:bg-white/5 dark:text-paid-400 dark:ring-white/10',
    accent: 'bg-paid-300 dark:bg-paid-700',
    markerFill: '#94a3b8',
    markerRing: 'rgba(148,163,184,0.22)',
    markerInk: '#ffffff',
    chipActive: 'bg-paid-500 text-white',
    dot: 'bg-paid-400',
  },
  unknown: {
    label: '정보 부족',
    short: '미상',
    badge: 'bg-paid-500/10 text-paid-500 ring-1 ring-paid-500/20 dark:bg-white/5 dark:text-paid-400 dark:ring-white/10',
    accent: 'bg-paid-300 dark:bg-paid-700',
    markerFill: '#94a3b8',
    markerRing: 'rgba(148,163,184,0.22)',
    markerInk: '#ffffff',
    chipActive: 'bg-paid-500 text-white',
    dot: 'bg-paid-400',
  },
}

export function statusStyle(status: ParkingStatus): StatusStyle {
  return STATUS_STYLE[status]
}
