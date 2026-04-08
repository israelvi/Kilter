import { promises as fs, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { Logger } from '../logging/Logger';
import type {
  BoardConfig,
  ClimbListItem,
  ClimbDetail,
  ClimbHold,
  ClimbAngleStat,
  ClimbBetaLink,
  CatalogStatus,
  ClimbListQuery
} from '../../models/catalogTypes';

/**
 * KilterCatalogService — opens the recovered Kilter db.sqlite3 (extracted from
 * the recovered APK) and answers queries about boards, climbs, holds, etc.
 *
 * Read-only via better-sqlite3. Backend for the in-app Catalog browser.
 *
 * Two ways to open a catalog:
 *
 *   1. `openFromBundle(bundleDir)` — explicit. The user picks a recovery
 *      bundle directory (any folder containing a `raw/` subdir with the
 *      Kilter APK). We extract `assets/db.sqlite3` and the board images
 *      into a `_catalog/` working dir next to the bundle, then open it.
 *
 *   2. `init()` — best-effort auto-discovery, used as a fallback when no
 *      bundle has been explicitly opened yet. Looks for the most recent
 *      `KilterRecovery_*` folder under `findings/android/`.
 */
export class KilterCatalogService {
  private db: import('better-sqlite3').Database | null = null;
  private dbPath: string | null = null;
  private boardImageDir: string | null = null;
  private currentBundleDir: string | null = null;
  private status: CatalogStatus = { available: false, reason: 'not initialized' };

  // Cached lookup tables
  private gradeNameByDifficulty = new Map<number, string>();
  private placementToHole = new Map<number, number>();
  private placementToSet = new Map<number, number>();
  private holesByProductId = new Map<number, Map<number, { id: number; name: string; x: number; y: number }>>();
  private rolesByProductId = new Map<number, Map<number, { id: number; name: string; full_name: string; screen_color: string }>>();
  private layoutById = new Map<number, { id: number; product_id: number; name: string }>();
  private productById = new Map<number, { id: number; name: string }>();
  private setNameById = new Map<number, string>();
  private sizeById = new Map<number, { id: number; product_id: number; name: string; description: string; edge_left: number; edge_right: number; edge_bottom: number; edge_top: number; image_filename: string }>();

  // Precomputed at open time so list/board screens are instant
  private boardConfigsCached: BoardConfig[] = [];
  /** combo_id → uuids of climbs that match it */
  private climbsByCombo = new Map<number, string[]>();
  /** combo_id → cached board image base64 (if extracted) */
  private boardImageCache = new Map<number, { mime: string; base64: string } | null>();

  constructor(private logger: Logger, private projectRoot: string) {}

  /**
   * Best-effort: if a catalog is already open, return it; otherwise try to
   * auto-discover one under findings/android/. Returns the resulting status.
   * The renderer should call `openFromBundle` (via the picker) for explicit
   * user choice and only rely on `init()` to populate the screen on first
   * load if a previous catalog has already been opened in this session.
   */
  async init(): Promise<CatalogStatus> {
    if (this.db) return this.status;
    // Try auto-discovery as a fallback only.
    const auto = await this.findMostRecentBundle();
    if (auto) {
      return this.openFromBundle(auto);
    }
    this.status = {
      available: false,
      reason: 'No catalog open. Click "Pick recovery bundle" to choose a folder containing a recovered Kilter APK.'
    };
    return this.status;
  }

  /**
   * Open a catalog from a specific recovery bundle directory. The bundle is
   * expected to contain a `raw/` subdirectory with the Kilter base.apk
   * (the same shape ExportService produces). Extracts the SQLite db and the
   * board image set into <bundleDir>/_catalog/ on first call.
   */
  async openFromBundle(bundleDir: string): Promise<CatalogStatus> {
    this.close();
    if (!existsSync(bundleDir)) {
      this.status = { available: false, reason: `Path does not exist: ${bundleDir}` };
      return this.status;
    }
    let stat;
    try { stat = await fs.stat(bundleDir); } catch {
      this.status = { available: false, reason: `Cannot read: ${bundleDir}` };
      return this.status;
    }
    if (!stat.isDirectory()) {
      this.status = { available: false, reason: `Not a directory: ${bundleDir}` };
      return this.status;
    }

    const workDir = join(bundleDir, '_catalog');
    const dbDest = join(workDir, 'db.sqlite3');
    const imageDir = join(workDir, 'board-images');
    await fs.mkdir(workDir, { recursive: true });
    await fs.mkdir(imageDir, { recursive: true });

    // Two ways to populate _catalog/:
    //   1. The bundle already has a Kilter APK in raw/ — extract on first open.
    //   2. _catalog/ was pre-built and committed (sample bundles do this).
    //      In that case the db.sqlite3 + board-images already exist on disk
    //      and we don't need an APK at all.
    const preBuilt = existsSync(dbDest);
    const apk = preBuilt ? null : await this.findKilterApkInDir(bundleDir);

    if (!preBuilt && !apk) {
      this.status = {
        available: false,
        reason: `No Kilter base.apk found inside ${bundleDir}, and no pre-built catalog at ${dbDest}. Either drop a Kilter base.apk in <bundleDir>/raw/, or build a sample catalog with scripts/build-sample-catalog.js.`
      };
      return this.status;
    }

    if (!existsSync(dbDest) && apk) {
      this.logger.info('catalog', 'extracting db.sqlite3 from APK', { apk, dbDest });
      try {
        await runUnzip(apk, 'assets/db.sqlite3', workDir);
        // unzip preserves "assets/db.sqlite3" inside workDir; flatten.
        const nested = join(workDir, 'assets', 'db.sqlite3');
        if (existsSync(nested)) {
          await fs.rename(nested, dbDest);
          try { await fs.rm(join(workDir, 'assets'), { recursive: true, force: true }); } catch { /* ignore */ }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.status = { available: false, reason: `Failed to extract db.sqlite3: ${msg}` };
        return this.status;
      }
    }

    // Extract board images on first open if missing AND we have an APK to extract from.
    const existingImages = await fs.readdir(imageDir).catch(() => [] as string[]);
    if (apk && !existingImages.some((f) => f.endsWith('.png'))) {
      try {
        this.logger.info('catalog', 'extracting board images from APK', { apk });
        await runUnzip(apk, 'assets/img/product_sizes_layouts_sets/*', workDir);
        const nested = join(workDir, 'assets', 'img', 'product_sizes_layouts_sets');
        if (existsSync(nested)) {
          for (const f of await fs.readdir(nested)) {
            try { await fs.rename(join(nested, f), join(imageDir, f)); } catch { /* ignore */ }
          }
          try { await fs.rm(join(workDir, 'assets'), { recursive: true, force: true }); } catch { /* ignore */ }
        }
      } catch (err) {
        // Non-fatal — boards screen will just show placeholders.
        this.logger.warn('catalog', 'failed to extract board images', { err: String(err) });
      }
    }

    // Open the db
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Database = require('better-sqlite3');
      this.db = new Database(dbDest, { readonly: true, fileMustExist: true });
      this.dbPath = dbDest;
      this.boardImageDir = imageDir;
      this.currentBundleDir = bundleDir;
      this.preloadLookups();
      await this.precomputeBoardsAndClimbs();
      this.status = {
        available: true,
        dbPath: dbDest,
        boardImageDir: imageDir,
        bundleDir,
        gradeCount: this.gradeNameByDifficulty.size
      };
      this.logger.info('catalog', 'catalog ready', { ...this.status });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.status = { available: false, reason: `failed to open db: ${msg}` };
      this.logger.error('catalog', 'failed to open db', { err: msg });
    }
    return this.status;
  }

  /** Find the most recent KilterRecovery_* directory under findings/android/. */
  private async findMostRecentBundle(): Promise<string | null> {
    const findingsDir = join(this.projectRoot, 'findings', 'android');
    if (!existsSync(findingsDir)) return null;
    const entries = await fs.readdir(findingsDir, { withFileTypes: true }).catch(() => []);
    const bundles = entries
      .filter((e) => e.isDirectory() && e.name.startsWith('KilterRecovery_'))
      .map((e) => e.name)
      .sort()
      .reverse();
    return bundles.length > 0 ? join(findingsDir, bundles[0]) : null;
  }

  /** Look for a kilterboard base.apk inside a bundle directory. */
  private async findKilterApkInDir(bundleDir: string): Promise<string | null> {
    // First check the canonical bundle layout: <bundleDir>/raw/*.apk
    const rawDir = join(bundleDir, 'raw');
    if (existsSync(rawDir)) {
      const files = await fs.readdir(rawDir).catch(() => []);
      const apk = files.find((f) =>
        f.toLowerCase().includes('kilterboard') &&
        f.toLowerCase().endsWith('base.apk')
      );
      if (apk) return join(rawDir, apk);
    }
    // Otherwise scan one level: maybe the user picked the raw dir directly,
    // or a flat folder containing the APK.
    const top = await fs.readdir(bundleDir).catch(() => []);
    const directApk = top.find((f) =>
      f.toLowerCase().includes('kilterboard') &&
      f.toLowerCase().endsWith('base.apk')
    );
    if (directApk) return join(bundleDir, directApk);
    return null;
  }

  getStatus(): CatalogStatus {
    return this.status;
  }

  // ── Lookup tables ──────────────────────────────────────────────────────
  private preloadLookups(): void {
    if (!this.db) return;

    for (const row of this.db.prepare('SELECT difficulty, boulder_name FROM difficulty_grades').all() as Array<{ difficulty: number; boulder_name: string }>) {
      this.gradeNameByDifficulty.set(row.difficulty, row.boulder_name);
    }

    for (const row of this.db.prepare('SELECT id, hole_id, set_id FROM placements').all() as Array<{ id: number; hole_id: number; set_id: number }>) {
      this.placementToHole.set(row.id, row.hole_id);
      this.placementToSet.set(row.id, row.set_id);
    }

    for (const row of this.db.prepare('SELECT id, product_id, name, x, y FROM holes').all() as Array<{ id: number; product_id: number; name: string; x: number; y: number }>) {
      let m = this.holesByProductId.get(row.product_id);
      if (!m) { m = new Map(); this.holesByProductId.set(row.product_id, m); }
      m.set(row.id, { id: row.id, name: row.name, x: row.x, y: row.y });
    }

    for (const row of this.db.prepare('SELECT id, product_id, name, full_name, screen_color FROM placement_roles').all() as Array<{ id: number; product_id: number; name: string; full_name: string; screen_color: string }>) {
      let m = this.rolesByProductId.get(row.product_id);
      if (!m) { m = new Map(); this.rolesByProductId.set(row.product_id, m); }
      // The DB stores screen_color as a hex string WITHOUT '#'.
      const screenColor = row.screen_color ? `#${row.screen_color}` : '#888888';
      m.set(row.id, { id: row.id, name: row.name, full_name: row.full_name, screen_color: screenColor });
    }

    for (const row of this.db.prepare('SELECT id, product_id, name FROM layouts').all() as Array<{ id: number; product_id: number; name: string }>) {
      this.layoutById.set(row.id, row);
    }
    for (const row of this.db.prepare('SELECT id, name FROM products').all() as Array<{ id: number; name: string }>) {
      this.productById.set(row.id, row);
    }
    for (const row of this.db.prepare('SELECT id, name FROM sets').all() as Array<{ id: number; name: string }>) {
      this.setNameById.set(row.id, row.name);
    }
    for (const row of this.db.prepare('SELECT id, product_id, name, description, edge_left, edge_right, edge_bottom, edge_top, image_filename FROM product_sizes').all() as Array<{ id: number; product_id: number; name: string; description: string; edge_left: number; edge_right: number; edge_bottom: number; edge_top: number; image_filename: string }>) {
      this.sizeById.set(row.id, row);
    }
  }

  // ── Board configurations ───────────────────────────────────────────────

  /**
   * One-shot precompute called immediately after the DB is opened. Builds:
   *   - the full BoardConfig list (with REAL set-aware climb counts, not bbox approximations)
   *   - climbsByCombo map (so listClimbsForCombo doesn't have to parse frames every call)
   *   - boardImageCache (base64-encoded PNGs read once from disk)
   *
   * After this runs everything is in memory and the renderer can fetch boards
   * + climbs + images instantly via cached data.
   */
  private async precomputeBoardsAndClimbs(): Promise<void> {
    if (!this.db) return;
    const t0 = Date.now();
    this.boardConfigsCached = [];
    this.climbsByCombo.clear();
    this.boardImageCache.clear();

    // 1. Pull every official combo
    const combos = this.db.prepare(`
      SELECT pls.id AS combo_id, pls.product_size_id, pls.layout_id, pls.set_id,
             p.name AS product_name,
             ps.name AS size_name, ps.description AS size_description,
             ps.edge_left, ps.edge_right, ps.edge_bottom, ps.edge_top,
             l.name AS layout_name,
             s.name AS set_name,
             pls.image_filename AS combo_image
      FROM product_sizes_layouts_sets pls
      JOIN product_sizes ps ON ps.id = pls.product_size_id
      JOIN layouts l ON l.id = pls.layout_id
      JOIN sets s ON s.id = pls.set_id
      JOIN products p ON p.id = ps.product_id
      WHERE pls.is_listed = 1
    `).all() as Array<any>;

    // Build a tiny lookup of which combos fit each (layout, set) tuple, so we
    // can route a climb to its candidate combos cheaply.
    const combosByLayout = new Map<number, Array<typeof combos[number]>>();
    for (const c of combos) {
      let arr = combosByLayout.get(c.layout_id);
      if (!arr) { arr = []; combosByLayout.set(c.layout_id, arr); }
      arr.push(c);
    }

    // 2. Walk every listed climb once. Determine its set(s) by parsing frames,
    //    then assign the climb to every combo whose layout matches, set matches,
    //    and bbox contains the climb. This is the only correct way to bucket
    //    climbs into the user-facing board grid.
    const climbs = this.db.prepare(`
      SELECT uuid, layout_id, edge_left, edge_right, edge_bottom, edge_top, frames
      FROM climbs
      WHERE is_listed = 1 AND is_draft = 0
        AND layout_id IN (${[...combosByLayout.keys()].join(',') || '0'})
    `).all() as Array<{ uuid: string; layout_id: number; edge_left: number; edge_right: number; edge_bottom: number; edge_top: number; frames: string }>;

    const FRAME_RE = /p(\d+)r(\d+)/g;
    for (const c of climbs) {
      // Determine the set(s) this climb actually uses
      const sets = new Set<number>();
      let m: RegExpExecArray | null;
      FRAME_RE.lastIndex = 0;
      while ((m = FRAME_RE.exec(c.frames))) {
        const sid = this.placementToSet.get(Number.parseInt(m[1], 10));
        if (sid != null) sets.add(sid);
      }
      if (sets.size === 0) continue;

      const candidates = combosByLayout.get(c.layout_id) ?? [];
      for (const cfg of candidates) {
        // Climb's sets must be a subset of {cfg.set_id} → since climbs typically
        // use a single set, we accept iff every set in the climb equals cfg.set_id.
        let setOk = true;
        for (const sid of sets) {
          if (sid !== cfg.set_id) { setOk = false; break; }
        }
        if (!setOk) continue;
        // bbox contain check
        if (c.edge_left   < cfg.edge_left)   continue;
        if (c.edge_right  > cfg.edge_right)  continue;
        if (c.edge_bottom < cfg.edge_bottom) continue;
        if (c.edge_top    > cfg.edge_top)    continue;
        // Match!
        let arr = this.climbsByCombo.get(cfg.combo_id);
        if (!arr) { arr = []; this.climbsByCombo.set(cfg.combo_id, arr); }
        arr.push(c.uuid);
      }
    }

    // 3. Build the user-facing BoardConfig list — drop empties, sort by popularity,
    //    and synchronously read the corresponding board image PNG into memory.
    for (const c of combos) {
      const matchedClimbs = this.climbsByCombo.get(c.combo_id) ?? [];
      if (matchedClimbs.length === 0) continue;
      const cfg: BoardConfig = {
        comboId: c.combo_id,
        productName: c.product_name,
        sizeName: c.size_name,
        sizeDescription: c.size_description,
        layoutName: c.layout_name,
        setName: c.set_name,
        productSizeId: c.product_size_id,
        layoutId: c.layout_id,
        setId: c.set_id,
        boundingBox: {
          left: c.edge_left,
          right: c.edge_right,
          bottom: c.edge_bottom,
          top: c.edge_top
        },
        imageFilename: c.combo_image,
        climbCount: matchedClimbs.length
      };
      this.boardConfigsCached.push(cfg);
    }
    this.boardConfigsCached.sort((a, b) => b.climbCount - a.climbCount);

    // 4. Load all board images into base64 in parallel.
    await Promise.all(this.boardConfigsCached.map(async (cfg) => {
      const img = await this.readBoardImageFromDisk(cfg.imageFilename);
      this.boardImageCache.set(cfg.comboId, img);
    }));

    this.logger.info('catalog', 'precompute done', {
      combos: this.boardConfigsCached.length,
      totalMatched: this.boardConfigsCached.reduce((a, b) => a + b.climbCount, 0),
      ms: Date.now() - t0
    });
  }

  private async readBoardImageFromDisk(imageFilename: string): Promise<{ mime: string; base64: string } | null> {
    if (!this.boardImageDir) return null;
    const baseName = imageFilename.split('/').pop() ?? imageFilename;
    const file = join(this.boardImageDir, baseName);
    if (!existsSync(file)) return null;
    try {
      const buf = await fs.readFile(file);
      return { mime: 'image/png', base64: buf.toString('base64') };
    } catch {
      return null;
    }
  }

  /**
   * Returns every official board configuration that has at least one climb in
   * the catalog. Used to populate the BoardsScreen grid.
   */
  listBoardConfigs(): BoardConfig[] {
    return this.boardConfigsCached;
  }

  // ── Climb list ─────────────────────────────────────────────────────────

  listClimbsForCombo(comboId: number, query: ClimbListQuery): { items: ClimbListItem[]; total: number } {
    if (!this.db) return { items: [], total: 0 };

    const uuids = this.climbsByCombo.get(comboId);
    if (!uuids || uuids.length === 0) return { items: [], total: 0 };

    // Pull metadata for all matching climbs in one query, then sort/filter in JS.
    // SQLite has a limit on the number of params in IN(), so we batch.
    const items: ClimbListItem[] = [];
    const BATCH = 500;
    for (let i = 0; i < uuids.length; i += BATCH) {
      const slice = uuids.slice(i, i + BATCH);
      const placeholders = slice.map(() => '?').join(',');
      const rows = this.db.prepare(`
        SELECT c.uuid, c.setter_id, c.setter_username, c.name, c.description,
               c.frames_count, c.created_at,
               ccf.ascensionist_count, ccf.quality_average, ccf.display_difficulty
        FROM climbs c
        LEFT JOIN climb_cache_fields ccf ON ccf.climb_uuid = c.uuid
        WHERE c.uuid IN (${placeholders})
      `).all(...slice) as Array<any>;
      for (const row of rows) {
        const grade = row.display_difficulty != null
          ? this.gradeNameByDifficulty.get(Math.round(row.display_difficulty)) ?? null
          : null;
        items.push({
          uuid: row.uuid,
          name: row.name,
          setterUsername: row.setter_username,
          setterId: row.setter_id,
          description: row.description,
          ascensionistCount: row.ascensionist_count ?? 0,
          qualityAverage: row.quality_average ?? null,
          displayDifficulty: row.display_difficulty ?? null,
          grade,
          framesCount: row.frames_count,
          createdAt: row.created_at
        });
      }
    }

    // Apply name + setter + grade filters (each is independent)
    const nameQ = query.name?.trim().toLowerCase() ?? '';
    const setterQ = query.setter?.trim().toLowerCase() ?? '';
    const grade = query.grade?.trim() ?? '';
    let filtered = items;
    if (nameQ) {
      filtered = filtered.filter((c) => c.name.toLowerCase().includes(nameQ));
    }
    if (setterQ) {
      filtered = filtered.filter((c) => c.setterUsername.toLowerCase().includes(setterQ));
    }
    if (grade) {
      filtered = filtered.filter((c) => extractVGrade(c.grade) === grade);
    }

    // Sort
    const sortBy = query.sortBy ?? 'popularity';
    const sortFn: Record<typeof sortBy, (a: ClimbListItem, b: ClimbListItem) => number> = {
      popularity: (a, b) => (b.ascensionistCount ?? 0) - (a.ascensionistCount ?? 0),
      quality:    (a, b) => (b.qualityAverage ?? 0) - (a.qualityAverage ?? 0),
      difficulty: (a, b) => (b.displayDifficulty ?? 0) - (a.displayDifficulty ?? 0),
      newest:     (a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
      name:       (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    };
    filtered.sort(sortFn[sortBy]);

    const total = filtered.length;
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 100;
    return { items: filtered.slice(offset, offset + limit), total };
  }

  /** Distinct V-grade labels (e.g. "V4", "V5") for a board, for the filter dropdown. */
  listGradesForCombo(comboId: number): string[] {
    if (!this.db) return [];
    const uuids = this.climbsByCombo.get(comboId);
    if (!uuids || uuids.length === 0) return [];
    const seen = new Set<string>();
    const BATCH = 500;
    for (let i = 0; i < uuids.length; i += BATCH) {
      const slice = uuids.slice(i, i + BATCH);
      const placeholders = slice.map(() => '?').join(',');
      const rows = this.db.prepare(`
        SELECT ccf.display_difficulty
        FROM climb_cache_fields ccf
        WHERE ccf.climb_uuid IN (${placeholders})
          AND ccf.display_difficulty IS NOT NULL
      `).all(...slice) as Array<{ display_difficulty: number }>;
      for (const r of rows) {
        const name = this.gradeNameByDifficulty.get(Math.round(r.display_difficulty));
        if (!name) continue;
        const v = extractVGrade(name);
        if (v) seen.add(v);
      }
    }
    // Sort by numeric V-grade
    return [...seen].sort((a, b) => parseVGrade(a) - parseVGrade(b));
  }

  // ── Climb detail ───────────────────────────────────────────────────────

  getClimbDetail(uuid: string): ClimbDetail | null {
    if (!this.db) return null;
    const climb = this.db.prepare(`
      SELECT c.uuid, c.layout_id, c.setter_id, c.setter_username, c.name, c.description,
             c.edge_left, c.edge_right, c.edge_bottom, c.edge_top, c.frames, c.frames_count, c.created_at,
             ccf.ascensionist_count, ccf.quality_average, ccf.display_difficulty
      FROM climbs c
      LEFT JOIN climb_cache_fields ccf ON ccf.climb_uuid = c.uuid
      WHERE c.uuid = ?
    `).get(uuid) as any;
    if (!climb) return null;

    const layout = this.layoutById.get(climb.layout_id);
    const product = layout ? this.productById.get(layout.product_id) : null;
    if (!layout || !product) return null;

    const productHoles = this.holesByProductId.get(product.id) ?? new Map();
    const productRoles = this.rolesByProductId.get(product.id) ?? new Map();

    const FRAME_RE = /p(\d+)r(\d+)/g;
    const holds: ClimbHold[] = [];
    let m: RegExpExecArray | null;
    while ((m = FRAME_RE.exec(climb.frames))) {
      const placementId = Number.parseInt(m[1], 10);
      const roleId = Number.parseInt(m[2], 10);
      const holeId = this.placementToHole.get(placementId);
      const hole = holeId != null ? productHoles.get(holeId) : null;
      const role = productRoles.get(roleId);
      if (!hole) continue;
      holds.push({
        placementId,
        roleId,
        roleName: role?.name ?? 'unknown',
        roleFullName: role?.full_name ?? 'unknown',
        roleColor: role?.screen_color ?? '#888888',
        holeId: hole.id,
        holeName: hole.name,
        x: hole.x,
        y: hole.y
      });
    }

    const stats: ClimbAngleStat[] = (this.db.prepare(`
      SELECT angle, display_difficulty, benchmark_difficulty, ascensionist_count,
             difficulty_average, quality_average, fa_username, fa_at
      FROM climb_stats WHERE climb_uuid = ? ORDER BY ascensionist_count DESC
    `).all(uuid) as Array<any>).map((s) => ({
      angle: s.angle,
      displayDifficulty: s.display_difficulty,
      grade: this.gradeNameByDifficulty.get(Math.round(s.display_difficulty)) ?? null,
      benchmarkDifficulty: s.benchmark_difficulty,
      ascensionistCount: s.ascensionist_count,
      qualityAverage: s.quality_average,
      faUsername: s.fa_username,
      faAt: s.fa_at
    }));

    const beta: ClimbBetaLink[] = (this.db.prepare(`
      SELECT link, foreign_username, angle, thumbnail
      FROM beta_links WHERE climb_uuid = ? AND is_listed = 1
      LIMIT 50
    `).all(uuid) as Array<any>).map((b) => ({
      link: b.link,
      username: b.foreign_username,
      angle: b.angle,
      thumbnail: b.thumbnail
    }));

    // Pick the matching combo to know the bounding box used for SVG viewBox.
    // We pick the smallest bbox combo of this layout that fully contains the climb.
    const combos = this.listBoardConfigs().filter((c) => c.layoutId === climb.layout_id);
    let chosen = combos.find((c) =>
      climb.edge_left   >= c.boundingBox.left &&
      climb.edge_right  <= c.boundingBox.right &&
      climb.edge_bottom >= c.boundingBox.bottom &&
      climb.edge_top    <= c.boundingBox.top
    ) ?? combos[0] ?? null;

    return {
      uuid: climb.uuid,
      name: climb.name,
      description: climb.description,
      setterUsername: climb.setter_username,
      setterId: climb.setter_id,
      layoutId: climb.layout_id,
      layoutName: layout.name,
      productName: product.name,
      boundingBox: {
        left: climb.edge_left,
        right: climb.edge_right,
        bottom: climb.edge_bottom,
        top: climb.edge_top
      },
      framesCount: climb.frames_count,
      rawFrames: climb.frames,
      createdAt: climb.created_at,
      ascensionistCount: climb.ascensionist_count ?? 0,
      qualityAverage: climb.quality_average ?? null,
      displayDifficulty: climb.display_difficulty ?? null,
      grade: climb.display_difficulty != null
        ? this.gradeNameByDifficulty.get(Math.round(climb.display_difficulty)) ?? null
        : null,
      holds,
      angleStats: stats,
      betaLinks: beta,
      renderConfig: chosen ? {
        comboId: chosen.comboId,
        boundingBox: chosen.boundingBox,
        imageFilename: chosen.imageFilename
      } : null
    };
  }

  // ── Board image data ───────────────────────────────────────────────────

  /**
   * Returns the base64-encoded PNG of a board configuration's render. Used by
   * the renderer for both the BoardsScreen tiles and the ClimbDetailScreen.
   */
  async getBoardImageBase64(comboId: number): Promise<{ mime: string; base64: string } | null> {
    return this.boardImageCache.get(comboId) ?? null;
  }

  private findCombo(comboId: number): BoardConfig | null {
    return this.boardConfigsCached.find((c) => c.comboId === comboId) ?? null;
  }

  close(): void {
    try { this.db?.close(); } catch { /* ignore */ }
    this.db = null;
    this.dbPath = null;
    this.boardImageDir = null;
    this.currentBundleDir = null;
    this.gradeNameByDifficulty.clear();
    this.placementToHole.clear();
    this.placementToSet.clear();
    this.holesByProductId.clear();
    this.rolesByProductId.clear();
    this.layoutById.clear();
    this.productById.clear();
    this.setNameById.clear();
    this.sizeById.clear();
    this.boardConfigsCached = [];
    this.climbsByCombo.clear();
    this.boardImageCache.clear();
  }
}

/**
 * Extracts the V-grade portion (e.g. "V4") from a Kilter difficulty_grades
 * boulder_name like "6b/V4" or "6b+/V4". Returns null if no V-grade is present.
 */
function extractVGrade(boulderName: string | null): string | null {
  if (!boulderName) return null;
  const m = boulderName.match(/V\d+/);
  return m ? m[0] : null;
}

/** "V4" → 4. Returns -1 for unparseable values so they sort first. */
function parseVGrade(v: string): number {
  const m = v.match(/V(\d+)/);
  return m ? Number.parseInt(m[1], 10) : -1;
}

/** Wraps `unzip` so we can extract specific entries from an APK without a heavy dep. */
function runUnzip(zipPath: string, pattern: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-o', zipPath, pattern, '-d', destDir], { windowsHide: true });
    let stderr = '';
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`unzip exited ${code}: ${stderr}`));
    });
  });
}
