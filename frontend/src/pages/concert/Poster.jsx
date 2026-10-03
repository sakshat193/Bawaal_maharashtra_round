/** Artist photo + the concert's gradient duotone + scanlines. */
export default function Poster({ d, className = '', style, as: Tag = 'div', onClick, children }) {
  return (
    <Tag className={'poster ' + className} style={{ background: d.poster, ...style }} onClick={onClick}>
      <img src={d.photoUrl} alt="" loading="lazy" />
      <div className="tint" style={{ background: d.tint }} />
      <div className="glow" style={{ background: d.tint }} />
      <div className="shade" />
      <div className="scan" />
      <div className="body">{children}</div>
    </Tag>
  );
}

export function Pill({ d, short = false, pulse = false }) {
  return (
    <span className="pill" style={{ background: d.pillBg, color: d.pillColor }}>
      <i className={pulse ? 'pulse' : ''} />{short ? d.pillShort : d.pill}
    </span>
  );
}

export function DateChip({ d }) {
  return <div className="datechip"><span>{d.mon}</span><span>{d.day}</span></div>;
}
