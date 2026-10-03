# Fair Drop — frontend

React + Vite port of the Fair Drop designs. Every screen is responsive, from phone to desktop.

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
npm run build    # static output in dist/ (relative paths, hash routing — host anywhere)
```

## Routes

| Route | What it is |
|---|---|
| `#/` | Consumer ticketing app: home feed, quick-view popup, event page with a 3D venue (drag to orbit, scroll or pinch to zoom, tap a section), human check, live queue with a 3D stadium and random checks, your turn (10-minute hold), checkout, confirmation, saved shows, my tickets |
| `#/drop` | The proof layer: pre-open countdown → 90 s window → sealed → draw → won/lost, plus the 50,000-point drum |
| `#/results` | "You weren't drawn" screen with the waitlist and the "How is this fair?" drawer |
| `#/verify` | Paste the seed, compare it to the commitment, watch the hash bloom lock, and recompute all 49,812 tickets in the browser |
| `#/judges` | Naive FIFO vs Fair Drop under the same attack, Gini, oversell, p99, subnet point cloud, arena |

### URL options

- `#/?speed=2&checks=frequent` changes the queue speed. `checks` can be `off`, `normal` or `frequent`.
- `#/drop?outcome=lost&opensIn=10&autoplay=0` sets the drop outcome, the countdown length, and whether the flow advances on its own.
- `?lite=1` on any route turns off the 3D venue.
- Reduced motion: honours `prefers-reduced-motion`. The 3D scenes render a single still frame.

## Structure

```
src/
  App.jsx                 routes
  styles/                 global tokens + concert app responsive CSS
  lib/                    sha256 (pure JS, sync), constants (seed, commitment, root)
  components/             Flap (split-flap digits), Grain (film grain + scanlines)
  three/                  drum.js, venue.js, hashBloom.js, judgeScenes.js — plain three.js engines
  pages/concert/          store.js (state machine + persistence), data.js, screens
  pages/                  FairDrop, Verify, JudgeDashboard, FanResults
```

Each 3D engine is a plain `createX(element, options)` function. It returns an object with methods (`setPhase`, `setTier`, `zoomBy`, and so on) plus `dispose()`. React components mount it in `useEffect`, so the engines carry no framework code.

## Wiring to a backend

`pages/concert/store.js` simulates the server. It holds the phase, queue position, check timing and hold expiry. To connect a real backend, replace the `setInterval` tick with server pushes (WebSocket or SSE). Keep the client side as rendering only, because the server must decide queue position, winners and holds.

## Notes

- `three` is pinned to `0.128.0` to match the original designs.
- The seed, commitment, ticket hashes and winners root are real SHA-256 values. Queue, attack and latency figures are simulated.
- Artist photos are placeholders from `i.pravatar.cc`. Replace `photoUrl` in `pages/concert/data.js` with licensed artist imagery.
