// Types for the in-app Kilter Catalog browser. Imported by both main and renderer.

export interface CatalogStatus {
  available: boolean;
  reason?: string;
  dbPath?: string;
  boardImageDir?: string;
  /** The recovery bundle directory the catalog was opened from. */
  bundleDir?: string;
  gradeCount?: number;
}

export interface BoardConfig {
  comboId: number;
  productName: string;
  sizeName: string;
  sizeDescription: string;
  layoutName: string;
  setName: string;
  productSizeId: number;
  layoutId: number;
  setId: number;
  boundingBox: { left: number; right: number; bottom: number; top: number };
  imageFilename: string;
  /** Approximate climb count (bbox + layout match — set match is enforced at list time). */
  climbCount: number;
}

export interface ClimbListItem {
  uuid: string;
  name: string;
  setterUsername: string;
  setterId: number;
  description: string;
  ascensionistCount: number;
  qualityAverage: number | null;
  displayDifficulty: number | null;
  grade: string | null;
  framesCount: number;
  createdAt: string;
}

export type ClimbSortBy = 'popularity' | 'quality' | 'difficulty' | 'newest' | 'name';

export interface ClimbListQuery {
  sortBy?: ClimbSortBy;
  /** Substring match against climb.name (case-insensitive). */
  name?: string;
  /** Substring match against climb.setter_username (case-insensitive). */
  setter?: string;
  /** Boulder grade to filter to (e.g. "V4", "V5"). Empty string / undefined = all grades. */
  grade?: string;
  offset?: number;
  limit?: number;
}

export interface ClimbHold {
  placementId: number;
  roleId: number;
  roleName: string;
  roleFullName: string;
  /** Hex color including the leading '#'. */
  roleColor: string;
  holeId: number;
  holeName: string;
  x: number;
  y: number;
}

export interface ClimbAngleStat {
  angle: number;
  displayDifficulty: number;
  grade: string | null;
  benchmarkDifficulty: number | null;
  ascensionistCount: number;
  qualityAverage: number;
  faUsername: string;
  faAt: string;
}

export interface ClimbBetaLink {
  link: string;
  username: string | null;
  angle: number | null;
  thumbnail: string | null;
}

export interface ClimbDetail {
  uuid: string;
  name: string;
  description: string;
  setterUsername: string;
  setterId: number;
  layoutId: number;
  layoutName: string;
  productName: string;
  boundingBox: { left: number; right: number; bottom: number; top: number };
  framesCount: number;
  rawFrames: string;
  createdAt: string;
  ascensionistCount: number;
  qualityAverage: number | null;
  displayDifficulty: number | null;
  grade: string | null;
  holds: ClimbHold[];
  angleStats: ClimbAngleStat[];
  betaLinks: ClimbBetaLink[];
  /** Combo whose bounding box we should use as the SVG viewBox + image background. */
  renderConfig: { comboId: number; boundingBox: { left: number; right: number; bottom: number; top: number }; imageFilename: string } | null;
}

export interface CatalogIpc {
  init(): Promise<CatalogStatus>;
  status(): Promise<CatalogStatus>;
  /** Open a specific recovery bundle directory. */
  openBundle(bundleDir: string): Promise<CatalogStatus>;
  /** Show a directory picker, then open the chosen bundle. */
  pickAndOpenBundle(): Promise<CatalogStatus | null>;
  listBoardConfigs(): Promise<BoardConfig[]>;
  listClimbsForCombo(comboId: number, query: ClimbListQuery): Promise<{ items: ClimbListItem[]; total: number }>;
  /** All boulder grades that have at least one climb on this board (for the filter dropdown). */
  listGradesForCombo(comboId: number): Promise<string[]>;
  getClimbDetail(uuid: string): Promise<ClimbDetail | null>;
  getBoardImage(comboId: number): Promise<{ mime: string; base64: string } | null>;
}
