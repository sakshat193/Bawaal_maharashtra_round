import { useEffect, useMemo, useRef } from 'react';
import { createVenue, layout } from '../../three/venue.js';
import { isLite, prefersReduced } from '../../lib/constants.js';

function heldFor(held, tierId) {
  if (held instanceof Map) return held.get(tierId);
  if (Array.isArray(held)) return held.find(item => item.tier_id === tierId)?.held;
  return held?.[tierId];
}

function inventoryDescription(tiers, held) {
  return tiers.map(section => {
    const count = heldFor(held, section.tier_id);
    return Number.isFinite(Number(count))
      ? `${section.name}: ${Number(count)} held of ${section.capacity}`
      : `${section.name}: inventory loading`;
  }).join('. ');
}

function StaticVenue({ model, held, tier }) {
  return (
    <div className="fd-venue-static" role="img" aria-label={`Static venue inventory. ${inventoryDescription(model.tiers, held)}`}>
      <div className="fd-static-stage">STAGE</div>
      <div className="fd-static-sections">
        {model.tiers.map(section => (
          <div className={`fd-static-section${tier === section.tier_id ? ' selected' : ''}`} key={section.tier_id} style={{ '--tier-color': section.color }}>
            <span>{section.name}</span>
            <div className="fd-static-rows">
              {section.rows.map((row, rowIndex) => (
                <div className="fd-static-row" key={`${section.tier_id}-${rowIndex}`}>
                  {row.dots.map(dot => {
                    const count = Number(heldFor(held, section.tier_id));
                    const taken = Number.isFinite(count) && dot.shuffleIndex < count / section.unitSize;
                    return <i key={`${section.tier_id}-${dot.index}`} className={taken ? 'held' : 'free'} aria-hidden="true" />;
                  })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Draws the API's tier capacities and invariant held counts as ticket dots. */
export default function VenueCanvas({
  tiers = [],
  held = {},
  tier,
  mode = 'event',
  onPick,
  controls = true
}) {
  const host = useRef(null);
  const engine = useRef(null);
  const onPickRef = useRef(onPick);
  const lite = isLite();
  const model = useMemo(() => layout(tiers), [tiers]);
  onPickRef.current = onPick;

  useEffect(() => {
    if (lite) return undefined;
    const active = createVenue(host.current, {
      tiers,
      reduced: prefersReduced(),
      onPick: id => onPickRef.current?.(id)
    });
    engine.current = active;
    return () => {
      active.dispose();
      engine.current = null;
    };
  }, [lite]);

  useEffect(() => {
    const active = engine.current;
    if (!active) return;
    active.setTiers(tiers);
    active.setHeld(held);
    active.setTier(tier);
    active.setMode(mode);
  }, [tiers, held, tier, mode, lite]);

  return (
    <section className="fd-venue-panel" aria-label="Venue inventory">
      <div className="fd-venue-heading">
        <h2 className="c-h2">Venue inventory</h2>
        <span>{model.unitSize === 1 ? '1 dot = 1 ticket' : `1 dot = ${model.unitSize} tickets`}</span>
      </div>
      {lite
        ? <StaticVenue model={model} held={held} tier={tier} />
        : <div ref={host} className="fd-venue-canvas" role="img" aria-label={`Venue inventory. ${inventoryDescription(tiers, held)}`} />}
      <div className="fd-venue-legend" aria-hidden="true">
        <span><i className="held" /> Held</span>
        <span><i className="free" /> Free</span>
        {controls && !lite && (
          <div className="fd-venue-controls">
            <button type="button" aria-label="Zoom in" onClick={() => engine.current?.zoomBy(0.8)}>+</button>
            <button type="button" aria-label="Zoom out" onClick={() => engine.current?.zoomBy(1.25)}>−</button>
            <button type="button" aria-label="Reset view" onClick={() => engine.current?.resetView()}>Reset</button>
          </div>
        )}
      </div>
    </section>
  );
}
