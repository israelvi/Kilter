import { useEffect, useMemo, useState } from 'react';
import { ipc } from '../ipc/bridge';
import { store, useStore } from '../state/store';
import type { BoardConfig, ClimbListItem, ClimbSortBy } from '@models/catalogTypes';

const PAGE_SIZE = 100;

export function ClimbsScreen() {
  const comboId = useStore((s) => s.selectedComboId);
  const [board, setBoard] = useState<BoardConfig | null>(null);
  const [items, setItems] = useState<ClimbListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameQ, setNameQ] = useState('');
  const [setterQ, setSetterQ] = useState('');
  const [sortBy, setSortBy] = useState<ClimbSortBy>('popularity');
  const [grade, setGrade] = useState('');
  const [grades, setGrades] = useState<string[]>([]);
  const [page, setPage] = useState(0);

  // Resolve the board metadata + grade list once
  useEffect(() => {
    if (comboId == null) return;
    let cancelled = false;
    (async () => {
      const [list, gs] = await Promise.all([
        ipc().catalog.listBoardConfigs(),
        ipc().catalog.listGradesForCombo(comboId)
      ]);
      if (cancelled) return;
      setBoard(list.find((x) => x.comboId === comboId) ?? null);
      setGrades(gs);
    })();
    return () => { cancelled = true; };
  }, [comboId]);

  // Reload items whenever search/sort/page changes
  useEffect(() => {
    if (comboId == null) return;
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const r = await ipc().catalog.listClimbsForCombo(comboId, {
          name: nameQ,
          setter: setterQ,
          sortBy,
          grade,
          offset: page * PAGE_SIZE,
          limit: PAGE_SIZE
        });
        if (cancelled) return;
        setItems(r.items);
        setTotal(r.total);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [comboId, nameQ, setterQ, sortBy, grade, page]);

  // Reset to page 0 when any filter changes
  useEffect(() => { setPage(0); }, [nameQ, setterQ, sortBy, grade]);

  const open = (uuid: string) => {
    store.set({ selectedClimbUuid: uuid, screen: 'climb-detail' });
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const sortLabel: Record<ClimbSortBy, string> = useMemo(() => ({
    popularity: 'Most ascended',
    quality:    'Highest quality',
    difficulty: 'Hardest',
    newest:     'Newest first',
    name:       'Name (A→Z)'
  }), []);

  if (comboId == null) {
    return (
      <>
        <h2>Catalog · Climbs</h2>
        <p className="lede">Pick a board first.</p>
        <button className="primary" onClick={() => store.set({ screen: 'boards' })}>← Back to Boards</button>
      </>
    );
  }

  return (
    <>
      <div className="row spread">
        <div>
          <h2>Catalog · Climbs</h2>
          <p className="lede" style={{ marginBottom: 0 }}>
            {board ? <>{board.productName} · {board.sizeName} · {board.setName}</> : <>Loading board…</>}
          </p>
        </div>
        <button onClick={() => store.set({ screen: 'boards' })}>← Boards</button>
      </div>

      <div className="card">
        <div className="filter-bar">
          <label className="filter-field">
            <span className="filter-label">Climb name</span>
            <input
              type="search"
              placeholder="e.g. bell of the wall"
              value={nameQ}
              onChange={(e) => setNameQ(e.target.value)}
            />
          </label>
          <label className="filter-field">
            <span className="filter-label">Setter</span>
            <input
              type="search"
              placeholder="e.g. kilterstudio"
              value={setterQ}
              onChange={(e) => setSetterQ(e.target.value)}
            />
          </label>
          <label className="filter-field" style={{ flex: '0 0 140px' }}>
            <span className="filter-label">Grade</span>
            <select
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              className="select-input"
            >
              <option value="">All grades</option>
              {grades.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </label>
          <label className="filter-field" style={{ flex: '0 0 220px' }}>
            <span className="filter-label">Sort by</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as ClimbSortBy)}
              className="select-input"
            >
              {(['popularity','quality','difficulty','newest','name'] as ClimbSortBy[]).map((k) => (
                <option key={k} value={k}>{sortLabel[k]}</option>
              ))}
            </select>
          </label>
          {(nameQ || setterQ || grade || sortBy !== 'popularity') && (
            <button
              className="filter-clear"
              onClick={() => { setNameQ(''); setSetterQ(''); setGrade(''); setSortBy('popularity'); }}
            >
              Clear filters
            </button>
          )}
        </div>
        <div className="meta" style={{ marginTop: 12 }}>
          {loading
            ? 'Loading…'
            : `${total.toLocaleString()} climb${total === 1 ? '' : 's'} match${(nameQ || setterQ || grade) ? ' your filters' : ' this board'}`}
        </div>
      </div>

      {error && <div className="notice bad">{error}</div>}

      {!loading && items.length === 0 && (
        <div className="empty">No climbs match.</div>
      )}

      {items.length > 0 && (
        <div className="climb-list">
          {items.map((c) => (
            <button key={c.uuid} className="climb-row" onClick={() => open(c.uuid)}>
              <div className="climb-row-grade">
                <span className="grade-badge">{c.grade ?? '—'}</span>
              </div>
              <div className="climb-row-main">
                <div className="climb-row-name">{c.name}</div>
                <div className="climb-row-meta">
                  by <strong>{c.setterUsername}</strong>
                  {c.description ? <> · <em>{c.description.slice(0, 90)}{c.description.length > 90 ? '…' : ''}</em></> : null}
                </div>
              </div>
              <div className="climb-row-stats">
                <div className="stat">
                  <div className="stat-num">{c.ascensionistCount.toLocaleString()}</div>
                  <div className="stat-label">ascents</div>
                </div>
                <div className="stat">
                  <div className="stat-num">{c.qualityAverage != null ? c.qualityAverage.toFixed(1) : '—'}</div>
                  <div className="stat-label">★ avg</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="row spread" style={{ marginTop: 16 }}>
          <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>← Prev</button>
          <span className="meta">Page {page + 1} of {totalPages}</span>
          <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next →</button>
        </div>
      )}
    </>
  );
}
