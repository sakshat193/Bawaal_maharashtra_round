import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import fallbackResults from '../../../contracts/fixtures/results.json';
import Grain from '../components/Grain.jsx';
import { useDrops, useInvariants } from '../api/hooks.js';
import { messageForError } from '../api/messages.js';
import { createJudgeScenes } from '../three/judgeScenes.js';
import { isLite, prefersReduced } from '../lib/constants.js';
import { invariantFailures, sceneCounts, summarizeMode, viewMode } from './dashboardData.js';

const MODES = [
  ['naive_fcfs', 'Naive first come'],
  ['hardened_fcfs', 'Hardened first come'],
  ['lottery', 'Fair Drop lottery']
];

function validResults(value) {
  return MODES.every(([id]) => value?.modes?.[id]?.profiles && typeof value.modes[id].profiles === 'object');
}

function SeatGrid({ view }) {
  return (
    <div className="fd-seat-profiles" aria-label={`Ticket allocation grid, one dot equals ${view.unitSize} tickets`}>
      {view.profiles.map(profile => (
        <div className="fd-seat-profile" key={profile.name}>
          <div><span>{profile.name.replaceAll('_', ' ')}</span><b>{profile.tickets.toLocaleString('en-IN')}</b></div>
          <div className="fd-seat-dots" role="img" aria-label={`${profile.tickets} tickets, ${profile.bot ? 'bot' : 'honest'} profile${profile.group ? ', group' : ''}`}>
            {Array.from({ length: profile.dots }, (_, index) => (
              <i key={index} className={`${profile.bot ? 'bot' : 'honest'}${profile.group ? ' group' : ''}`} aria-hidden="true" />
            ))}
          </div>
        </div>
      ))}
      {!view.profiles.length && <p>No ticket profiles were published.</p>}
    </div>
  );
}

function ModeCard({ title, mode }) {
  const summary = summarizeMode(mode);
  const view = viewMode(mode);
  const botPercent = summary.botTicketShare * 100;
  return (
    <article className="fd-dashboard-card">
      <header><h2>{title}</h2><span>{summary.tickets.toLocaleString('en-IN')} tickets</span></header>
      <div className="fd-dash-share" aria-label={`${botPercent.toFixed(1)} percent of tickets assigned to bot profiles`}>
        <i className="honest" style={{ width: `${100 - botPercent}%` }} />
        <i className="bot" style={{ width: `${botPercent}%` }} />
      </div>
      <p className="fd-dash-caption">Bot ticket share <b>{botPercent.toFixed(1)}%</b> · {summary.botTickets.toLocaleString('en-IN')} of {summary.tickets.toLocaleString('en-IN')}</p>
      <SeatGrid view={view} />
      <small className="fd-dash-caption">1 dot = {view.unitSize.toLocaleString('en-IN')} ticket{view.unitSize === 1 ? '' : 's'}</small>
    </article>
  );
}

function InvariantsPanel({ invariants, error }) {
  const failures = invariantFailures(invariants);
  const state = failures === null ? 'loading' : failures.length ? 'fail' : 'pass';
  return (
    <section className={`fd-invariants ${state}`} aria-labelledby="invariants-title">
      <div className="fd-panel-heading">
        <div><p className="c-kicker">Live API check</p><h2 id="invariants-title" className="c-h2">Inventory invariants</h2></div>
        <b>{state === 'pass' ? 'All clear' : state === 'fail' ? 'Needs attention' : error ? 'Unavailable' : 'Loading'}</b>
      </div>
      {error && <p role="alert" className="fd-error">{messageForError(error)}</p>}
      {invariants && (
        <>
          <div className="fd-invariant-checks">
            <span>Held does not exceed capacity</span>
            <span>Held equals active quantity</span>
            <span>Multiple active offers: {invariants.entries_with_multiple_offers}</span>
          </div>
          <div className="fd-invariant-table">
            <div><b>Tier</b><b>Held</b><b>Active</b><b>Capacity</b></div>
            {invariants.tiers.map(tier => (
              <div key={tier.tier_id}>
                <span>{tier.tier_id}</span>
                <span>{tier.held.toLocaleString('en-IN')}</span>
                <span>{tier.active_quantity.toLocaleString('en-IN')}</span>
                <span>{tier.capacity.toLocaleString('en-IN')}</span>
              </div>
            ))}
          </div>
          {failures?.length > 0 && <ul>{failures.map(failure => <li key={failure}>{failure}</li>)}</ul>}
        </>
      )}
    </section>
  );
}

export default function JudgeDashboard() {
  const [results, setResults] = useState(fallbackResults);
  const [resultsSource, setResultsSource] = useState('fixture');
  const [dropId, setDropId] = useState('');
  const cloudEl = useRef(null);
  const arenaEl = useRef(null);
  const engine = useRef(null);
  const drops = useDrops();
  const dropList = drops.data?.drops || [];
  const selectedDropId = dropId || dropList[0]?.drop_id || '';
  const selectedDrop = dropList.find(drop => drop.drop_id === selectedDropId);
  const invariants = useInvariants(selectedDropId, selectedDrop?.phase);
  const lottery = results.modes.lottery;
  const lotterySummary = summarizeMode(lottery);
  const sceneData = useMemo(() => sceneCounts(lottery), [lottery]);
  const lite = isLite();

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}results.json`, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error('results.json is not available');
        return response.json();
      })
      .then(value => {
        if (!validResults(value)) throw new Error('results.json does not match the dashboard schema');
        setResults(value);
        setResultsSource('results.json');
      })
      .catch(reason => {
        if (reason.name !== 'AbortError') {
          setResults(fallbackResults);
          setResultsSource('fixture');
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (lite) return undefined;
    const active = createJudgeScenes(cloudEl.current, arenaEl.current, {
      reduced: prefersReduced(),
      data: sceneData
    });
    engine.current = active;
    return () => {
      active.dispose();
      engine.current = null;
    };
  }, [lite]);

  useEffect(() => { engine.current?.setData(sceneData); }, [sceneData]);

  const ratio = lotterySummary.botShareRatio;
  const groupShare = lotterySummary.identities
    ? lotterySummary.groupIdentities / lotterySummary.identities * 100
    : 0;
  const exclusions = lotterySummary.exclusions;

  return (
    <div className="c-shell fd-dashboard">
      <header className="c-nav">
        <div className="c-nav-in">
          <Link className="c-brand" to="/" aria-label="Fair Drop home"><i /><b>FAIR DROP</b></Link>
          <nav className="c-nav-r" aria-label="Fair Drop links">
            <Link className="c-iconbtn" to="/verify">Verify</Link>
            <Link className="c-iconbtn" to="/demo">Demo controls</Link>
          </nav>
        </div>
      </header>
      <main className="c-main fd-dashboard-main">
        <div className="fd-dashboard-title">
          <div><p className="c-kicker">Fair Drop · evidence dashboard</p><h1 className="c-title">Draw outcomes</h1></div>
          <span>Results source: {resultsSource}</span>
        </div>

        <section className="fd-modes" aria-label="Bot ticket share by allocation mode">
          {MODES.map(([id, title]) => <ModeCard key={id} title={title} mode={results.modes[id]} />)}
        </section>

        <section className="fd-dashboard-metrics" aria-label="Lottery metrics">
          <article className="fd-dashboard-card">
            <p className="c-kicker">Bot share ratio</p>
            <strong>{ratio.toFixed(2)}×</strong>
            <p className="fd-dash-caption">Bot ticket share ÷ bot identity share</p>
            <div className="fd-share-pair"><span>Tickets {(lotterySummary.botTicketShare * 100).toFixed(1)}%</span><span>Identities {(lotterySummary.botIdentityShare * 100).toFixed(1)}%</span></div>
          </article>
          <article className="fd-dashboard-card">
            <p className="c-kicker">Groups and singles</p>
            <div className="fd-dash-share"><i className="group" style={{ width: `${groupShare}%` }} /><i className="single" style={{ width: `${100 - groupShare}%` }} /></div>
            <div className="fd-share-pair"><span>{lotterySummary.groupIdentities.toLocaleString('en-IN')} group members</span><span>{lotterySummary.singleIdentities.toLocaleString('en-IN')} singles</span></div>
            <p className="fd-dash-caption">Tickets: {lotterySummary.groupTickets.toLocaleString('en-IN')} group · {lotterySummary.singleTickets.toLocaleString('en-IN')} singles</p>
          </article>
          <article className="fd-dashboard-card">
            <p className="c-kicker">Exclusions by rule</p>
            {exclusions.length
              ? <ul className="fd-exclusion-list">{exclusions.map(item => <li key={item.rule}><span>{item.rule.replaceAll('_', ' ')}</span><b>{item.count.toLocaleString('en-IN')}</b></li>)}</ul>
              : <p className="fd-dash-caption">No exclusions were published.</p>}
          </article>
        </section>

        <section className="fd-judge-scenes" aria-label="Lottery visual summaries">
          <article className="fd-dashboard-card">
            <h2>Entry profile</h2>
            {!lite
              ? <div ref={cloudEl} className="fd-judge-canvas" role="img" aria-label={`${sceneData.honest} honest entries and ${sceneData.bots} bot entries`} />
              : <div className="fd-judge-static"><span>{sceneData.honest.toLocaleString('en-IN')} honest entries</span><span>{sceneData.bots.toLocaleString('en-IN')} bot entries</span></div>}
            <p className="fd-dash-caption">1 point = {Math.max(1, Math.ceil(Math.max(sceneData.honest + sceneData.bots, sceneData.seats) / 6000)).toLocaleString('en-IN')} entries</p>
          </article>
          <article className="fd-dashboard-card">
            <h2>Allocated tickets</h2>
            {!lite
              ? <div ref={arenaEl} className="fd-judge-canvas" role="img" aria-label={`${sceneData.seats} tickets allocated in the lottery results`} />
              : <div className="fd-judge-static"><span>{sceneData.seats.toLocaleString('en-IN')} lottery tickets</span><span>Inventory remains governed by the live API below.</span></div>}
            <p className="fd-dash-caption">Allocation visualization uses lottery results; current inventory is checked live below.</p>
          </article>
        </section>

        <section className="fd-inventory-live">
          <div className="fd-panel-heading">
            <div><p className="c-kicker">Live API check</p><h2 className="c-h2">Current inventory</h2></div>
            {dropList.length > 0 && (
              <label className="fd-label">Drop
                <select value={selectedDropId} onChange={event => setDropId(event.target.value)}>
                  {dropList.map(drop => <option key={drop.drop_id} value={drop.drop_id}>{drop.name} · {drop.phase}</option>)}
                </select>
              </label>
            )}
          </div>
          {drops.error && <p role="alert" className="fd-error">{messageForError(drops.error)}</p>}
          {!selectedDropId && !drops.error && <p role="status">Loading drops…</p>}
          <InvariantsPanel invariants={invariants.data} error={invariants.error} />
        </section>
      </main>
      <Grain opacity={0.07} />
    </div>
  );
}
