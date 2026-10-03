// Web Worker: solves sub-puzzles off the main thread and reports each one as it lands.
import { hexToBytes, solveOne } from './puzzle.js';

let stopped = false;

self.onmessage = async ({ data }) => {
  if (data.type === 'stop') { stopped = true; return; }
  if (data.type !== 'solve') return;
  stopped = false;
  const { challenge, bits, k, memory_kib: memoryKib, startIndex = 0, prior = [] } = data;
  const ch = hexToBytes(challenge);
  const nonces = prior.slice(0, startIndex);
  try {
    for (let i = startIndex; i < k; i++) {
      const t0 = performance.now();
      const n = await solveOne(ch, i, bits, memoryKib, () => stopped);
      nonces.push(n);
      self.postMessage({ type: 'progress', index: i, nonce: n, solved: i + 1, k, ms: performance.now() - t0 });
    }
    self.postMessage({ type: 'done', nonces });
  } catch (e) {
    self.postMessage({ type: 'error', name: e.name, message: String(e.message || e) });
  }
};
