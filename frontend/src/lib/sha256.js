// Pure-JS SHA-256 (sync, so 49,812 tickets can be hashed in rAF chunks).
const primes = [];
for (let n = 2; primes.length < 64; n++) if (primes.every(q => n % q)) primes.push(n);
const frac = x => ((x - Math.floor(x)) * 4294967296) >>> 0;
const K = new Uint32Array(primes.map(q => frac(Math.cbrt(q))));
const H = primes.slice(0, 8).map(q => frac(Math.sqrt(q)));
const W = new Uint32Array(64);
const enc = new TextEncoder();
const rotr = (x, n) => (x >>> n) | (x << (32 - n));

export function sha256(str) {
  const b = enc.encode(str), l = b.length, nb = ((l + 72) >> 6) << 6;
  const m = new Uint8Array(nb); m.set(b); m[l] = 0x80;
  const bits = l * 8;
  m[nb - 4] = bits >>> 24; m[nb - 3] = (bits >>> 16) & 255; m[nb - 2] = (bits >>> 8) & 255; m[nb - 1] = bits & 255;
  let [h0, h1, h2, h3, h4, h5, h6, h7] = H;
  for (let o = 0; o < nb; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = (m[o + 4 * i] << 24) | (m[o + 4 * i + 1] << 16) | (m[o + 4 * i + 2] << 8) | m[o + 4 * i + 3];
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15], c = W[i - 2];
      W[i] = (W[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + W[i - 7] + (rotr(c, 17) ^ rotr(c, 19) ^ (c >>> 10))) | 0;
    }
    let a = h0, bb = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + bb) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}
