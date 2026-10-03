import { useEffect, useRef } from 'react';
import { createDrum, drumCounts } from './drum.js';
import { isLite, prefersReduced } from '../lib/constants.js';

function StaticDrum({ entries, winners, phase }) {
  const canvasRef = useRef(null);
  const scale = drumCounts(entries, winners);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return undefined;

    const draw = () => {
      const width = canvas.clientWidth || 1;
      const height = canvas.clientHeight || 1;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);
      const radius = Math.min(width * 0.34, height * 0.43);
      const centerX = width / 2;
      const centerY = height / 2;
      const goldenAngle = Math.PI * (3 - Math.sqrt(5));
      const winColor = phase === 'won' ? '#F59E0B' : '#67E8F9';
      for (let index = 0; index < scale.entryPoints; index++) {
        const y = 1 - 2 * (index + 0.5) / Math.max(1, scale.entryPoints);
        const ring = Math.sqrt(1 - y * y);
        const angle = goldenAngle * index;
        context.fillStyle = index < scale.winnerPoints ? winColor : phase === 'lost' ? '#494653' : '#A78BFA';
        const x = centerX + Math.cos(angle) * ring * radius;
        const pointY = centerY + y * radius * 0.72;
        context.fillRect(x, pointY, 2, 2);
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [entries, phase, scale.entryPoints, scale.winnerPoints]);

  return <canvas ref={canvasRef} className="fd-drum-static-canvas" aria-hidden="true" />;
}

export default function DrumHero({ entries = 0, winners = 0, phase = 'filling', label = 'Entry pool' }) {
  const host = useRef(null);
  const engine = useRef(null);
  const lite = isLite();
  const counts = drumCounts(entries, winners);

  useEffect(() => {
    if (lite) return undefined;
    const active = createDrum(host.current, { reduced: prefersReduced(), phase });
    engine.current = active;
    active.setCounts({ entries, winners });
    return () => {
      active.dispose();
      engine.current = null;
    };
  }, [lite]);

  useEffect(() => {
    engine.current?.setCounts({ entries, winners });
    engine.current?.setPhase(phase);
  }, [entries, winners, phase, lite]);

  return (
    <div className="fd-drum-summary" data-drum-phase={phase}>
      <span>{label}</span>
      <b>{entries.toLocaleString('en-IN')} entries</b>
      <div className="fd-drum-visual">
        {lite
          ? <StaticDrum entries={entries} winners={winners} phase={phase} />
          : <div ref={host} className="fd-drum-canvas" aria-hidden="true" />}
      </div>
      <div className="fd-drum-meta">
        {winners > 0 && <span>{winners.toLocaleString('en-IN')} entries offered</span>}
        <span>1 point = {counts.unitSize.toLocaleString('en-IN')} {counts.unitSize === 1 ? 'entry' : 'entries'}</span>
      </div>
    </div>
  );
}
