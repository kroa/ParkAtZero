/**
 * 브라우저가 한가해질 때까지 기다린다.
 *
 * 무거운 작업(10MB JSON 파싱, 지도 엔진 초기화)을 첫 화면이 그려지기 전에 시작하면
 * 메인 스레드를 붙잡아 목록이 그만큼 늦게 뜬다. 저사양 단말에서 특히 크게 벌어진다.
 * requestIdleCallback 이 없는 브라우저에서는 다음 프레임 뒤로만 미룬다.
 */
export function whenIdle(timeout = 1500): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve()
      return
    }
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback
    if (typeof ric === 'function') ric(() => resolve(), { timeout })
    else window.setTimeout(resolve, 120)
  })
}
