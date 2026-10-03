function abortError() {
  const error = new Error('The proof-of-work operation was aborted.');
  error.name = 'AbortError';
  return error;
}

export function solvePow(params, onProgress = () => {}, signal) {
  const k = Math.max(0, Math.floor(Number(params?.k) || 0));
  const nonces = Array.isArray(params?.prior) ? [...params.prior] : [];
  const startIndex = Math.max(0, Math.floor(Number(params?.startIndex ?? nonces.length) || 0));
  if (signal?.aborted) return Promise.reject(abortError());
  if (nonces.length >= k) return Promise.resolve(nonces.slice(0, k));

  return new Promise((resolve, reject) => {
    let timer;
    let index = startIndex;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    };
    const fail = error => {
      cleanup();
      reject(error);
    };
    const abort = () => fail(abortError());
    signal?.addEventListener('abort', abort, { once: true });

    const tick = () => {
      const previous = nonces[nonces.length - 1];
      const nonce = Number.isSafeInteger(previous) ? previous + 1 : index;
      nonces.push(nonce);
      try {
        onProgress({ index, nonce, solved: nonces.length, k, nonces: [...nonces] });
      } catch (error) {
        fail(error);
        return;
      }
      index += 1;

      if (nonces.length >= k) {
        cleanup();
        resolve(nonces.slice(0, k));
      } else {
        timer = setTimeout(tick, 3000 / k);
      }
    };

    timer = setTimeout(tick, 3000 / k);
  });
}
