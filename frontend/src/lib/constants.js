export const prefersReduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isLite = () => /[?&]lite=1/.test(window.location.href);
