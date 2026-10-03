import { useEffect, useRef, useState } from 'react';
import { turnstileOptions } from './turnstile.js';

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITEKEY || '1x00000000000000000000AA';
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise;

function loadTurnstile() {
  if (globalThis.turnstile?.render) return Promise.resolve(globalThis.turnstile);
  if (scriptPromise) return scriptPromise;

  const script = document.querySelector('script[data-fairdrop-turnstile]') || document.createElement('script');
  script.src = SCRIPT_URL;
  script.async = true;
  script.defer = true;
  script.dataset.fairdropTurnstile = 'true';

  const pending = new Promise((resolve, reject) => {
    script.addEventListener('load', () => {
      if (globalThis.turnstile?.render) resolve(globalThis.turnstile);
      else reject(new Error('The Turnstile widget did not load.'));
    }, { once: true });
    script.addEventListener('error', () => reject(new Error('The Turnstile script could not be loaded.')), { once: true });
    if (!script.isConnected) document.head.appendChild(script);
  });
  scriptPromise = pending.catch(error => {
    scriptPromise = null;
    throw error;
  });
  return scriptPromise;
}

export default function Turnstile({ onToken }) {
  const host = useRef(null);
  const onTokenRef = useRef(onToken);
  const [error, setError] = useState('');
  const isMock = import.meta.env.VITE_MSW === '1';
  onTokenRef.current = onToken;

  useEffect(() => {
    if (isMock) return undefined;
    let active = true;
    let widget;

    loadTurnstile().then(api => {
      if (!active || !host.current) return;
      widget = api.render(host.current, turnstileOptions(SITE_KEY, token => {
        if (!active) return;
        setError('');
        onTokenRef.current(token);
      }));
    }).catch(() => {
      if (!active) return;
      setError('The human check could not load. Refresh and try again.');
      onTokenRef.current('');
    });

    return () => {
      active = false;
      if (widget !== undefined) globalThis.turnstile?.remove?.(widget);
      onTokenRef.current('');
    };
  }, [isMock]);

  if (isMock) {
    return (
      <div data-turnstile-action="enter" className="fd-check">
        <span>Human check · action: enter</span>
        <button type="button" className="btn btn-ghost" onClick={() => onToken('mock-turnstile-enter')}>Complete check</button>
      </div>
    );
  }

  return (
    <div className="fd-check" data-turnstile-action="enter">
      <span>Human check · action: enter</span>
      <div ref={host} aria-label="Cloudflare Turnstile verification" />
      {error && <p role="alert" className="fd-error">{error}</p>}
    </div>
  );
}
