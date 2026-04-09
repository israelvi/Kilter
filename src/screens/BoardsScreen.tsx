import { useEffect, useState } from 'react';
import { ipc } from '../ipc/bridge';
import { store } from '../state/store';
import type { BoardConfig, CatalogStatus, ExportResult, ExportAllResult } from '@models/catalogTypes';
import { ExportSuccessModal } from './ExportSuccessModal';

interface BoardWithImage extends BoardConfig {
  image?: { mime: string; base64: string } | null;
}

export function BoardsScreen() {
  const [status, setStatus] = useState<CatalogStatus | null>(null);
  const [boards, setBoards] = useState<BoardWithImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // On first mount: only check current status; do NOT auto-pick anything.
  // The user explicitly chooses a bundle via the picker button.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await ipc().catalog.status();
        if (cancelled) return;
        setStatus(s);
        if (s.available) {
          await loadBoards();
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function loadBoards() {
    setLoading(true); setError(null); setBoards([]);
    try {
      // Backend precomputes everything (counts + base64 images) at openBundle time,
      // so this is a single fast call. Then we hydrate images in parallel.
      const list = await ipc().catalog.listBoardConfigs();
      setBoards(list);
      const withImages = await Promise.all(list.map(async (b) => {
        const image = await ipc().catalog.getBoardImage(b.comboId);
        return { ...b, image };
      }));
      setBoards(withImages);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function pickBundle() {
    setError(null);
    try {
      const s = await ipc().catalog.pickAndOpenBundle();
      if (!s) return; // user cancelled
      setStatus(s);
      if (s.available) {
        await loadBoards();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const openBoard = (b: BoardConfig) => {
    store.set({ selectedComboId: b.comboId, screen: 'climbs' });
  };

  const [exporting, setExporting] = useState<number | null>(null);
  const [exportingAll, setExportingAll] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number; boardName: string; percent: number } | null>(null);
  const [exportModalResult, setExportModalResult] = useState<ExportResult | ExportAllResult | null>(null);

  useEffect(() => {
    const unsub = ipc().events.onExportProgress((p) => setExportProgress(p));
    return unsub;
  }, []);

  const exportAll = async () => {
    setExportingAll(true);
    setExportProgress(null);
    setError(null);
    try {
      const result = await ipc().catalog.exportAllForBoardPulse();
      if (result) {
        setExportModalResult(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExportingAll(false);
      setExportProgress(null);
    }
  };

  const exportForBoardPulse = async (comboId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setExporting(comboId);
    setError(null);
    try {
      const result = await ipc().catalog.exportForBoardPulse(comboId);
      if (result) {
        setExportModalResult(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(null);
    }
  };

  const hasCatalog = status?.available === true;

  return (
    <>
      <div className="row spread">
        <div>
          <h2 style={{ margin: 0 }}>Catalog · Boards</h2>
          <p className="lede" style={{ marginBottom: 0 }}>
            Browse the recovered Kilter catalog by board configuration.
          </p>
        </div>
        {hasCatalog && (
          <div className="row" style={{ gap: 8 }}>
            <button
              onClick={() => void exportAll()}
              disabled={exportingAll || boards.length === 0}
              className="primary"
            >
              {exportingAll ? 'Exporting…' : 'Export All for BoardPulse'}
            </button>
            <button onClick={() => void pickBundle()}>Switch bundle</button>
          </div>
        )}
      </div>

      {/* Bundle status panel */}
      <div className="card">
        {hasCatalog ? (
          <>
            <div className="row spread">
              <div>
                <div className="meta" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px' }}>Open bundle</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 12, marginTop: 4, wordBreak: 'break-all' }}>
                  {status?.bundleDir ?? status?.dbPath ?? '—'}
                </div>
              </div>
              <span className="badge good">ready</span>
            </div>
          </>
        ) : (
          <>
            <h3>No catalog open</h3>
            <p style={{ color: 'var(--text-dim)', margin: '8px 0 16px' }}>
              {status?.reason ?? 'Pick a recovery bundle folder (the kind exported from the Recovery → Export screen, or any folder containing a Kilter Board base.apk).'}
            </p>
            <button className="primary" onClick={() => void pickBundle()}>
              Pick recovery bundle…
            </button>
          </>
        )}
      </div>

      {exportProgress && (
        <div className="card" style={{ padding: '12px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
            <span>Exporting: {exportProgress.boardName}</span>
            <span>{exportProgress.current}/{exportProgress.total}</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--surface)', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              borderRadius: 3,
              background: 'var(--accent)',
              width: `${exportProgress.percent}%`,
              transition: 'width 0.3s ease-out'
            }} />
          </div>
        </div>
      )}
      {error && <div className="notice bad">{error}</div>}

      {/* Export success modal */}
      {exportModalResult && (
        <ExportSuccessModal
          result={exportModalResult}
          onClose={() => setExportModalResult(null)}
        />
      )}

      {loading && hasCatalog && <div className="empty">Loading boards…</div>}

      {!loading && hasCatalog && boards.length === 0 && (
        <div className="empty">No board configurations have any climbs.</div>
      )}

      {hasCatalog && boards.length > 0 && (
        <div className="boards-grid">
          {boards.map((b) => (
            <button key={b.comboId} className="board-card" onClick={() => openBoard(b)}>
              <div className="board-card-image">
                {b.image
                  ? <img src={`data:${b.image.mime};base64,${b.image.base64}`} alt={`${b.productName} ${b.sizeName}`} />
                  : <div className="board-card-placeholder">…</div>}
              </div>
              <div className="board-card-body">
                <div className="board-card-title">{b.productName}</div>
                <div className="board-card-sub">{b.sizeName}</div>
                <div className="board-card-set">{b.setName}</div>
                <div className="board-card-count">{b.climbCount.toLocaleString()} climbs</div>
                <button
                  className="export-bp-btn"
                  onClick={(e) => void exportForBoardPulse(b.comboId, e)}
                  disabled={exporting === b.comboId}
                  title="Export this board's catalog for BoardPulse"
                >
                  {exporting === b.comboId ? 'Exporting…' : 'Export for BoardPulse'}
                </button>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
