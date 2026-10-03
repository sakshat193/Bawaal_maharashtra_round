import { useEffect, useRef } from 'react';
import { createVenue } from '../../three/venue.js';
import { isLite, prefersReduced } from '../../lib/constants.js';

/** Hosts the 3D venue engine for a screen. mode: event | turn | queue */
export default function VenueCanvas({ mode, tier, sold, progress, onPick, controls = false, glow, hint, children }) {
  const host = useRef(), eng = useRef(), pickRef = useRef(onPick);
  pickRef.current = onPick;
  const lite = isLite();

  useEffect(() => {
    if (lite) return;
    eng.current = createVenue(host.current, { reduced: prefersReduced(), onPick: id => pickRef.current && pickRef.current(id) });
    return () => { eng.current.dispose(); eng.current = null; };
  }, [lite]);

  useEffect(() => {
    const e = eng.current; if (!e) return;
    e.setMode(mode); e.setTier(tier); e.setSold(sold); e.setProgress(progress || 0);
  });

  return (
    <div className="c-stage">
      <div className="glowbg" style={{ background: `radial-gradient(ellipse 60% 55% at 50% 55%, ${glow || 'rgba(124,58,237,0.16)'}, rgba(10,10,15,0) 70%)` }} />
      <div ref={host} className="canvas" />
      {lite && <div className="lite">3D view off · lite mode</div>}
      {controls && !lite && (
        <div className="c-ctl">
          <button aria-label="Zoom in" onClick={() => eng.current?.zoomBy(0.8)}>+</button>
          <button aria-label="Zoom out" onClick={() => eng.current?.zoomBy(1.25)}>−</button>
          <button aria-label="Reset view" onClick={() => eng.current?.resetView()}>↺</button>
        </div>
      )}
      {hint && <div style={{ position: 'absolute', top: 18, left: 20, fontSize: 12, color: '#9A99A8', pointerEvents: 'none', maxWidth: '60%' }}>{hint}</div>}
      {children}
    </div>
  );
}
