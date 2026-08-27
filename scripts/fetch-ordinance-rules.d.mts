/** scripts/fetch-ordinance-rules.mjs 가 테스트에 내보내는 순수 함수들의 타입. */
export declare function classify(sentence: string): '확정' | '원칙' | '재량'
export declare function looksLikeSentence(s: string): boolean
export declare function matchInstitutions(org: string, known: Iterable<string>): string[]
export declare function readScope(sentence: string): { days: string[]; night: boolean; daySpan: string }
