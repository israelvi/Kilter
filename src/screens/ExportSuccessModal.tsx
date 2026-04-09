import type { ExportResult, ExportAllResult } from '@models/catalogTypes';

interface Props {
  result: ExportResult | ExportAllResult;
  onClose: () => void;
}

function isAllResult(r: ExportResult | ExportAllResult): r is ExportAllResult {
  return 'count' in r;
}

export function ExportSuccessModal({ result, onClose }: Props) {
  const isAll = isAllResult(result);
  const title = isAll ? 'All boards exported' : (result as ExportResult).boardName + ' exported';
  const climbs = isAll ? (result as ExportAllResult).totalClimbs : (result as ExportResult).climbCount;
  const boards = isAll ? (result as ExportAllResult).count : 1;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="export-modal" onClick={(e) => e.stopPropagation()}>
        {/* Glow accent */}
        <div className="export-modal-glow" />

        {/* Check icon */}
        <div className="export-modal-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        <h3 className="export-modal-title">{title}</h3>

        <div className="export-modal-stats">
          {isAll && (
            <div className="export-modal-stat">
              <span className="export-modal-stat-value">{boards}</span>
              <span className="export-modal-stat-label">boards</span>
            </div>
          )}
          <div className="export-modal-stat">
            <span className="export-modal-stat-value">{climbs.toLocaleString()}</span>
            <span className="export-modal-stat-label">climbs</span>
          </div>
          <div className="export-modal-stat">
            <span className="export-modal-stat-value">{result.sizeMB} MB</span>
            <span className="export-modal-stat-label">
              {result.compressed && result.rawMB ? `compressed from ${result.rawMB} MB` : 'file size'}
            </span>
          </div>
        </div>

        <div className="export-modal-path">
          <span className="export-modal-path-label">Saved to</span>
          <span className="export-modal-path-value">{result.path}</span>
        </div>

        <p className="export-modal-hint">
          Upload this file to Google Drive or Dropbox, then open it in BoardPulse from any device.
        </p>

        <button className="export-modal-btn" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
