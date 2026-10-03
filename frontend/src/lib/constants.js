// Drop 0417 — real values: SHA-256(SEED) === COMMIT; ROOT = SHA-256 of the 500 winning entry ids joined by "\n".
export const SEED = 'c41d9e07b3a85f26e19d4c70a8b2f35e6d07c19a4be82f53d6a1097ce84b2f15';
export const COMMIT = '0656a5fc6bc9f412f41a2e2b95f7f064b9b5b77a86ce32293956ecc05ec65129';
export const ROOT = '2f8041e0a26b5879ccd3f4af66e88fac34852a0ab01fe9583777db15aaef409c';
export const ENTRIES = 49812;
export const entryId = i => 'fd0417-' + String(i).padStart(5, '0');

export const prefersReduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isLite = () => /[?&]lite=1/.test(window.location.href);
export const pad2 = n => String(n).padStart(2, '0');
export const fmt = n => Math.round(n).toLocaleString('en-US');
