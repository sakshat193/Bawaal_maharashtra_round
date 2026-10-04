import { useEffect, useRef } from 'react';

let noiseUrl = null;
function noise() {
  if (noiseUrl) return noiseUrl;
  const c = document.createElement('canvas'); c.width = c.height = 180;
  const x = c.getContext('2d'), d = x.createImageData(180, 180);
  let seed = 0x41c64e6d;
  for (let i = 0; i < d.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const value = seed >>> 24;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = value;
    d.data[i + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  return (noiseUrl = c.toDataURL());
}

/** Film grain + scanlines (+ optional vignette), procedurally generated. */
export default function Grain({ vignette = false, opacity = 0.06 }) {
  const ref = useRef();
  useEffect(() => { ref.current.style.backgroundImage = `url(${noise()})`; }, []);
  return (
    <>
      <div className="fx-grain" style={{ opacity }}><div ref={ref} /></div>
      <div className="fx-scan" />
      {vignette && <div className="fx-vignette" />}
    </>
  );
}
