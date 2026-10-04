// solvePow: the one export Member 1's entry form uses. Owner: Member 2.
//
//   const nonces = await solvePow(params, onProgress, signal)
//
// params      the GET /pow-challenge response { challenge, issued_at, bits, k, memory_kib },
//             plus optional { startIndex, prior } to resume after a tab suspension
//             (prior = the nonces already reported through onProgress).
// onProgress  called after each solved sub-puzzle with
//             { index, nonce, solved, k, nonces } — persist `nonces` (e.g. sessionStorage,
//             keyed by drop and issued_at) so a reload can resume from `solved`.
// signal      optional AbortSignal; aborting terminates the worker and rejects with AbortError.
//
// Resolves to the k nonces. Submit them with the same issued_at:
//   { pow: { issued_at: params.issued_at, nonces } }

export function solvePow(params, onProgress = () => {}, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    const startIndex = params.startIndex ?? 0;
    const nonces = (params.prior ?? []).slice(0, startIndex);
    const finish = (fn, v) => { worker.terminate(); signal?.removeEventListener('abort', onAbort); fn(v); };
    const onAbort = () => finish(reject, new DOMException('aborted', 'AbortError'));
    signal?.addEventListener('abort', onAbort);

    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        nonces[data.index] = data.nonce;
        onProgress({ index: data.index, nonce: data.nonce, solved: data.solved, k: data.k, nonces: nonces.slice() });
      } else if (data.type === 'done') {
        finish(resolve, data.nonces);
      } else if (data.type === 'error') {
        finish(reject, data.name === 'AbortError' ? new DOMException('aborted', 'AbortError') : new Error(data.message));
      }
    };
    worker.onerror = (e) => finish(reject, new Error(e.message || 'proof-of-work worker failed'));
    worker.postMessage({
      type: 'solve', challenge: params.challenge, bits: params.bits, k: params.k,
      memory_kib: params.memory_kib, startIndex, prior: nonces,
    });
  });
}

export default solvePow;
