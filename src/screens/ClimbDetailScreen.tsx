import { useEffect, useMemo, useState } from 'react';
import { ipc } from '../ipc/bridge';
import { store, useStore } from '../state/store';
import type { ClimbDetail } from '@models/catalogTypes';

const HOLD_RADIUS = 5.5;
const HOLD_STROKE = 1.6;

export function ClimbDetailScreen() {
  const uuid = useStore((s) => s.selectedClimbUuid);
  const [detail, setDetail] = useState<ClimbDetail | null>(null);
  const [boardImage, setBoardImage] = useState<{ mime: string; base64: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uuid) return;
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null); setDetail(null); setBoardImage(null);
      try {
        const d = await ipc().catalog.getClimbDetail(uuid);
        if (cancelled) return;
        setDetail(d);
        if (d?.renderConfig) {
          const img = await ipc().catalog.getBoardImage(d.renderConfig.comboId);
          if (cancelled) return;
          setBoardImage(img);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [uuid]);

  const roleSummary = useMemo(() => {
    if (!detail) return [] as Array<{ name: string; color: string; count: number }>;
    const byName = new Map<string, { name: string; color: string; count: number }>();
    for (const h of detail.holds) {
      const cur = byName.get(h.roleFullName) ?? { name: h.roleFullName, color: h.roleColor, count: 0 };
      cur.count++;
      byName.set(h.roleFullName, cur);
    }
    return [...byName.values()];
  }, [detail]);

  if (!uuid) {
    return (
      <>
        <h2>Catalog · Climb detail</h2>
        <p className="lede">Pick a climb first.</p>
        <button className="primary" onClick={() => store.set({ screen: 'climbs' })}>← Back to Climbs</button>
      </>
    );
  }

  if (loading) return <><h2>Loading climb…</h2></>;
  if (error) return <><h2>Error</h2><div className="notice bad">{error}</div></>;
  if (!detail) return <><h2>Climb not found</h2></>;

  const bbox = detail.renderConfig?.boundingBox ?? detail.boundingBox;
  const w = bbox.right - bbox.left;
  const h = bbox.top - bbox.bottom;
  const svgX = (x: number) => x - bbox.left;
  const svgY = (y: number) => bbox.top - y;

  return (
    <>
      <div className="row spread">
        <div>
          <h2 style={{ margin: 0 }}>{detail.name}</h2>
          <p className="lede" style={{ marginBottom: 0 }}>
            by <strong>{detail.setterUsername}</strong> · created {detail.createdAt.split('.')[0]}
          </p>
        </div>
        <button onClick={() => store.set({ screen: 'climbs' })}>← Back to list</button>
      </div>

      <div className="climb-detail-layout">
        <div className="climb-detail-board">
          <div className="board-wrap">
            {boardImage && (
              <img src={`data:${boardImage.mime};base64,${boardImage.base64}`} alt="board" />
            )}
            <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
              <defs>
                <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="0.8" result="blur"/>
                  <feMerge>
                    <feMergeNode in="blur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
              </defs>
              {detail.holds.map((h, i) => (
                <g key={i}>
                  <circle cx={svgX(h.x)} cy={svgY(h.y)} r={HOLD_RADIUS + 0.4} fill="none" stroke="#000" strokeWidth={HOLD_STROKE + 1.5} opacity={0.55} />
                  <circle cx={svgX(h.x)} cy={svgY(h.y)} r={HOLD_RADIUS} fill="none" stroke={h.roleColor} strokeWidth={HOLD_STROKE} filter="url(#glow)">
                    <title>{h.holeName} — {h.roleFullName}</title>
                  </circle>
                </g>
              ))}
            </svg>
          </div>
          <div className="legend">
            {roleSummary.map((r) => (
              <span key={r.name} className="legend-item">
                <span className="dot" style={{ borderColor: r.color }} />
                {r.name} ({r.count})
              </span>
            ))}
          </div>
        </div>

        <div className="climb-detail-meta">
          {detail.description && (
            <>
              <h3 className="section-title">Description</h3>
              <p className="desc">{detail.description}</p>
            </>
          )}

          <h3 className="section-title">Identity</h3>
          <table className="kv-table">
            <tbody>
              <tr><th>UUID</th><td><code>{detail.uuid}</code></td></tr>
              <tr><th>Setter</th><td>{detail.setterUsername} (id {detail.setterId})</td></tr>
              <tr><th>Layout</th><td>{detail.layoutName} ({detail.productName})</td></tr>
              <tr><th>Bounding box</th><td>L={detail.boundingBox.left} R={detail.boundingBox.right} B={detail.boundingBox.bottom} T={detail.boundingBox.top}</td></tr>
              <tr><th>Frames</th><td>{detail.framesCount}</td></tr>
              <tr><th>Total holds</th><td>{detail.holds.length}</td></tr>
              <tr><th>Created at</th><td>{detail.createdAt}</td></tr>
            </tbody>
          </table>

          <h3 className="section-title">Cached aggregate</h3>
          <table className="kv-table">
            <tbody>
              <tr><th>Ascensionists</th><td>{detail.ascensionistCount.toLocaleString()}</td></tr>
              <tr><th>Quality avg</th><td>{detail.qualityAverage?.toFixed(2) ?? '—'} / 3</td></tr>
              <tr><th>Display difficulty</th><td>{detail.displayDifficulty?.toFixed(2) ?? '—'} → {detail.grade ?? '—'}</td></tr>
            </tbody>
          </table>

          <h3 className="section-title">Per-angle stats ({detail.angleStats.length} angles)</h3>
          {detail.angleStats.length === 0 ? <p className="meta"><em>(no per-angle data)</em></p> : (
            <table className="data-table">
              <thead><tr><th>Angle</th><th>Difficulty</th><th>Grade</th><th>Ascents</th><th>Quality</th><th>FA</th><th>FA at</th></tr></thead>
              <tbody>
                {detail.angleStats.map((s, i) => (
                  <tr key={i}>
                    <td>{s.angle}°</td>
                    <td>{s.displayDifficulty.toFixed(2)}</td>
                    <td>{s.grade ?? ''}</td>
                    <td>{s.ascensionistCount}</td>
                    <td>{s.qualityAverage.toFixed(2)}</td>
                    <td>{s.faUsername}</td>
                    <td>{s.faAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 className="section-title">Beta links ({detail.betaLinks.length})</h3>
          {detail.betaLinks.length === 0 ? <p className="meta"><em>(no Instagram beta videos)</em></p> : (
            <table className="data-table">
              <thead><tr><th>Link</th><th>Posted by</th><th>Angle</th></tr></thead>
              <tbody>
                {detail.betaLinks.map((b, i) => (
                  <tr key={i}>
                    <td><a href={b.link} target="_blank" rel="noreferrer">{b.link}</a></td>
                    <td>{b.username ?? ''}</td>
                    <td>{b.angle ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 className="section-title">Raw frames string</h3>
          <pre className="raw-frames">{detail.rawFrames}</pre>
        </div>
      </div>
    </>
  );
}
