// Node CLI around the browser puzzle code, for the Python<->JS round-trip test and benchmarks.
//   node src/pow/cli.mjs solve  <challenge_hex> <bits> <k> <memory_kib>          -> {"nonces":[...],"ms":N}
//   node src/pow/cli.mjs verify <challenge_hex> <bits> <k> <memory_kib> <json>   -> {"ok":true|false}
import { hexToBytes, solveOne, verify } from './puzzle.js';

const [cmd, hex, bits, k, mem, json] = process.argv.slice(2);
const ch = hexToBytes(hex);
if (cmd === 'solve') {
  const t0 = performance.now();
  const nonces = [];
  for (let i = 0; i < +k; i++) nonces.push(await solveOne(ch, i, +bits, +mem));
  console.log(JSON.stringify({ nonces, ms: Math.round(performance.now() - t0) }));
} else if (cmd === 'verify') {
  console.log(JSON.stringify({ ok: await verify(ch, JSON.parse(json), +bits, +k, +mem) }));
} else {
  console.error('usage: cli.mjs solve|verify ...');
  process.exit(2);
}
