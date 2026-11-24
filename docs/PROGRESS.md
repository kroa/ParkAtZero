# ParkAtZero 작업 현황 (PROGRESS.md)

이 문서는 팀의 현재 진행 상황과 마일스톤, 리소스 사용 현황을 기록합니다.

## 현재 상태 요약
- **현재 마일스톤**: 모바일/태블릿 반응형 UI 개선 완료 및 검색 유입/홍보 부스팅
- **진행 중인 과제**: TASK-002 (Search Console sitemap-index.xml 수집 모니터링 및 수동 색인 가속)
- **최근 완료 과제**: TASK-006 (네이버·Bing IndexNow 매일 새벽 자동 발송 파이프라인 및 배포 연동 완료)
- **차단 요소 / 대표 결정 필요**: 없음

---

## 진행 이력

### 2026-11-24 (TASK-006 네이버·Bing IndexNow 매일 새벽 자동 발송 파이프라인 구축)
- **작업 내용**:
  - `.github/workflows/daily-indexnow.yml` 신설: 매일 04:00 KST (`cron: '0 19 * * *'`) 네이버·Bing·Yandex 273개 URL 자동 핑
  - `.github/workflows/deploy.yml` 연동: Pages 배포 완료 즉시 `seo:check` 검증 및 `seo:indexnow` 자동 발송 추가
  - 검색엔진 공식 규격 충족: 273개 URL(일일 한도 10,000개의 2.7% 수준, 월 무제한, 무료)
- **담당**: 개발 오준호, QA 차은결, 팀장 윤도한

### 2026-11-23 (TASK-004 모바일/태블릿 반응형 UI 시각 검수 및 디자인 개선 완료)
- **작업 내용**:
  - `docs/adr/ADR-004-responsive-viewport-architecture.md` 수립 및 승인
  - `src/hooks/useMediaQuery.ts`: 3단계 뷰포트(`compact < 768px`, `medium 768~1023px`, `expanded >= 1024px`) 인터페이스 구현
  - `src/App.tsx`: 태블릿 슬림 사이드바(`360px`) 및 상세 패널 Slide-over 처리로 지도 시야 53.1% 항시 보장
  - `src/index.css`: 글래스모피즘 매트화(`0.94~0.98`), 과도한 블러(12~16px) 절제, `.tap-target-44` 유틸리티 추가
  - `src/components/BottomSheet.tsx`: 바텀시트 Peek 높이 152px로 축소 (모바일 지도 가시 면적 82% 확보)
  - `src/components/DetailPanel.tsx`: 닫기 버튼 44×44px 터치 규격화
  - `src/components/NaviButtons.tsx`: 티맵 & 카카오내비 52px 대형 듀얼 버튼 전면 배치
  - `src/components/SearchBar.tsx`, `src/components/ThemeToggle.tsx`: 44px 터치 타깃 완비
  - 자동화 게이트 전수 통과: typecheck 0에러, lint 0경고, Playwright E2E 127개 전수 통과, build:only 및 크롤 그래프 100% 통과
  - 4인 병렬 검증 전원 합격: QA(차은결, PASS), 디자인(한소율, PASS), 보안(남궁현, PASS), 아키텍트(도경민, PASS)
- **담당**: 기획 서하은, 디자인 한소율, 아키텍트 도경민, 개발 오준호, QA 차은결, 보안 남궁현, 팀장 윤도한

### 2026-11-23 (TASK-003 크롤 그래프 검증 및 배관 무결성 확보 완료)
- **작업 내용**:
  - `docs/specs/task-003-crawl-graph.md` 및 `docs/adr/ADR-003-crawl-graph-verification.md` 수립
  - `scripts/check-crawl-graph.mjs` 구현 (Node.js 인메모리 BFS, 409ms)
  - 5대 수용 기준 전수 통과: 도달률 100%(273/273), 고아 0건, 깨진 링크 0건, 최단 깊이 최대 2홉(상한 3홉 만족), 검증 시간 409ms(<1초)
  - `build` 및 `build:only` 파이프라인 최종 게이트 연동 및 `npm run seo:crawl` 스크립트 추가
  - QA(차은결), 아키텍트(도경민), 보안(남궁현) 3인 병렬 검증 전원 합격(PASS)
- **담당**: 기획 서하은, 아키텍트 도경민, 개발 오준호, QA 차은결, 보안 남궁현, 팀장 윤도한

### 2026-11-23 (Google Antigravity 연동 체계 구축)
- **작업 내용**:
  - 서브 에이전트 팀 명단(10명) `.agents/agents/*.md` 구성
  - `AGENTS.md` 운영·품질 규칙 보완 (팀장 소통, 작업 흐름, 토큰 절약, 품질 게이트, 회고 규칙)
  - `docs/BACKLOG.md`, `docs/PROGRESS.md`, `docs/LESSONS.md` 체계 수립
- **담당**: 팀장 윤도한

### 2026-10-05 (검색 크롤 배관 개선 - 함정 11 해결)
- **작업 내용**:
  - `FooterLinks.tsx` 생성 및 `ParkingList.tsx` 하단 배치
  - 렌더링 후 내부 링크 0개 ➔ 6개 실측 확인
  - E2E 테스트 통과 및 GitHub Actions 배포 완료
- **담당**: 개발 오준호, QA 차은결
