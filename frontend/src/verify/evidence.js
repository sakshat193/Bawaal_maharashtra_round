export function readEvidence(response) {
  const { headers } = response;
  return {
    snapshotHash: headers.get('X-Fairdrop-Snapshot-Sha256'),
    exclusionsHash: headers.get('X-Fairdrop-Exclusions-Sha256'),
    sealedAt: headers.get('X-Fairdrop-Sealed-At'),
    timestampedAt: headers.get('X-Fairdrop-Timestamped-At') || 'Not timestamped yet'
  };
}
