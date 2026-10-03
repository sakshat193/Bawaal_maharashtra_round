import { useEffect, useState } from 'react';
import { readEvidence } from './evidence.js';

export default function Verifier({ dropId }) {
  const [evidence, setEvidence] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setEvidence(null);
    setError('');

    fetch(`/api/drops/${encodeURIComponent(dropId)}/snapshot`, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error('The snapshot could not be loaded.');
        setEvidence(readEvidence(response.headers));
      })
      .catch(reason => {
        if (reason.name !== 'AbortError') setError(reason.message || 'The snapshot could not be loaded.');
      });

    return () => controller.abort();
  }, [dropId]);

  if (error) return <p role="alert">{error}</p>;
  if (!evidence) return <p role="status">Loading snapshot…</p>;

  return (
    <section aria-labelledby="verifier-title">
      <h1 id="verifier-title">Verify this drop</h1>
      <dl>
        <dt>Snapshot hash</dt>
        <dd className="mono" style={{ overflowWrap: 'anywhere' }}>{evidence.snapshotHash}</dd>
        <dt>Exclusions hash</dt>
        <dd className="mono" style={{ overflowWrap: 'anywhere' }}>{evidence.exclusionsHash}</dd>
        <dt>Sealed at</dt>
        <dd>{evidence.sealedAt}</dd>
        <dt>Timestamped at</dt>
        <dd>{evidence.timestampedAt}</dd>
      </dl>
    </section>
  );
}
