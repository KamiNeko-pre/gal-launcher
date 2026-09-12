export type GameStatus = "想玩" | "未开始" | "进行中" | "已通关" | "搁置";

export interface PlaySession {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
}

export interface Game {
  id: string;
  title: string;
  originalTitle: string;
  description: string;
  descriptionOriginal?: string;
  descriptionZh?: string;
  translationStatus?: "success" | "already_zh" | "failed" | "partial" | "empty";
  translationUpdatedAt?: string;
  descriptionSourceHash?: string;
  metadataSource?: string;
  metadataSourceId?: string;
  metadataConfidence?: number;
  metadataReviewCandidates?: MetadataCandidate[];
  metadataReviewQueuedAt?: string;
  developer: string;
  releaseDate: string;
  installPath: string;
  executablePath: string;
  savePaths?: string[];
  localeEmulator?: {
    enabled: boolean;
    executablePath: string;
  };
  magpieEnabled?: boolean;
  magpiePresetId?: MagpiePresetId;
  workingDirectory: string;
  coverPath: string;
  backgroundPath: string;
  status: GameStatus;
  tags: string[];
  rating: number;
  bgmScore?: number;
  bgmScoreCount?: number;
  bgmRank?: number;
  bgmId?: number;
  bgmRatingStatus?: "success" | "no_match" | "network_error" | "rate_limited" | "parse_error" | "stale";
  bgmRatingCheckedAt?: string;
  bgmRatingLastAttemptAt?: string;
  bgmRatingNextRetryAt?: string;
  playCount: number;
  totalPlaySeconds?: number;
  currentSessionId?: string | null;
  currentSessionStartedAt?: string | null;
  lastPlayedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sessions?: PlaySession[];
  bookshelfIds?: string[];
}

export interface Bookshelf {
  id: string;
  name: string;
  createdAt: string;
}

export interface LibraryDocument {
  version: 2;
  games: Game[];
  bookshelves: Bookshelf[];
}

export interface LaunchCandidate extends PickedLaunchFile {
  relativePath: string;
  recommended: boolean;
  needsReview: boolean;
}

export interface LaunchScanResult {
  rootPath: string;
  gameFolderCount?: number;
  scannedFiles: number;
  skippedLinks: number;
  skippedDirectories: number;
  limitReached: boolean;
  needsReviewCount?: number;
  candidates: LaunchCandidate[];
}

export interface LaunchScanProgress {
  gameFolderCount?: number;
  scannedFiles: number;
  candidateCount: number;
  needsReviewCount?: number;
  skippedDirectories: number;
  skippedLinks: number;
  limitReached: boolean;
}

export interface LaunchResult {
  launched: boolean;
  reason?: "missing-executable";
  sessionId?: string;
  startedAt?: string;
  integrationWarning?: string;
}

export interface SaveBackup {
  id: string;
  createdAt: string;
  reason: "manual" | "before-restore";
  sources: Array<{ path: string; snapshot: string }>;
  directory: string;
}

export interface IntegrationSettings {
  magpieEnabled?: boolean;
  magpiePath?: string;
  localeEmulatorPath?: string;
}

export type EnhancementToolId = "localeEmulator" | "magpie";

export type MagpiePresetId = "light" | "balanced" | "quality" | "fourK";

export interface MagpiePresetOption {
  id: MagpiePresetId;
  label: string;
  target: string;
  description: string;
  recommendation: string;
}

export interface EnhancementToolStatus {
  id: EnhancementToolId;
  name: string;
  version: string;
  sourceUrl: string;
  license: string;
  executable: string;
  status: "not-installed" | "available";
  executablePath: string | null;
  reused: boolean;
}

export interface EnhancementToolProgress {
  phase: "checking" | "downloading" | "using-local-archive" | "verifying" | "deploying" | "available" | "failed" | "cancelled";
  toolId: EnhancementToolId;
  version: string;
  percent: number | null;
  receivedBytes?: number;
  totalBytes?: number;
  reused?: boolean;
  error?: string;
}

export interface PlaySessionEndedEvent {
  gameId: string;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  totalPlaySeconds?: number;
  sessions?: PlaySession[];
}

export interface PickedLaunchFile {
  title: string;
  originalTitle?: string;
  description?: string;
  descriptionOriginal?: string;
  descriptionZh?: string;
  translationStatus?: "success" | "already_zh" | "failed" | "partial" | "empty";
  translationUpdatedAt?: string;
  descriptionSourceHash?: string;
  metadataSource?: string;
  metadataSourceId?: string;
  metadataConfidence?: number;
  developer?: string;
  releaseDate?: string;
  coverPath?: string;
  backgroundPath?: string;
  tags?: string[];
  executablePath: string;
  installPath: string;
  workingDirectory: string;
}

export interface CoverCandidate {
  id: string;
  title: string;
  source: string;
  path: string;
  width: number;
  height: number;
  score: number;
  reason: string;
}

export interface MetadataCandidate {
  source: string;
  sourceId: string;
  confidence: number;
  matchedQuery?: string;
  title: string;
  originalTitle: string;
  developer: string;
  releaseDate: string;
  descriptionPreview: string;
  coverUrl: string;
}

export type BulkMetadataEnrichmentResult =
  | { kind: "apply"; metadata: Partial<PickedLaunchFile> }
  | { kind: "review"; candidates: MetadataCandidate[]; confidence: number }
  | { kind: "unmatched"; confidence: number };

export interface LauncherApi {
  loadLibrary: () => Promise<Game[]>;
  saveLibrary: (games: Game[]) => Promise<Game[]>;
  loadLibraryDocument: () => Promise<LibraryDocument>;
  saveLibraryDocument: (document: LibraryDocument) => Promise<LibraryDocument>;
  scanLaunchCandidates: (rootPath: string) => Promise<LaunchScanResult>;
  cancelLaunchScan: () => Promise<boolean>;
  onLaunchScanProgress?: (callback: (progress: LaunchScanProgress) => void) => () => void;
  exportLibrary: (document: LibraryDocument | Game[]) => Promise<string>;
  importLibrary: () => Promise<LibraryDocument | null>;
  pickLaunchFile: () => Promise<PickedLaunchFile | null>;
  getEnhancementTools: () => Promise<EnhancementToolStatus[]>;
  installEnhancementTool: (toolId: EnhancementToolId, options?: { localArchivePath?: string }) => Promise<EnhancementToolStatus>;
  selectExistingEnhancementTool: (toolId: EnhancementToolId, executablePath: string) => Promise<EnhancementToolStatus>;
  validateEnhancementTool: (toolId: EnhancementToolId, executablePath: string) => Promise<EnhancementToolStatus | null>;
  pickEnhancementToolArchive: (toolId: EnhancementToolId) => Promise<string | null>;
  getMagpiePresets: () => Promise<MagpiePresetOption[]>;
  onEnhancementToolProgress?: (callback: (progress: EnhancementToolProgress) => void) => () => void;
  pickImage: () => Promise<string | null>;
  pickFolder: () => Promise<string | null>;
  toggleFullscreen: () => Promise<boolean>;
  isFullscreen: () => Promise<boolean>;
  onFullscreenChanged?: (callback: (isFullscreen: boolean) => void) => () => void;
  saveBackups: (game: Game) => Promise<SaveBackup[]>;
  createSaveBackup: (game: Game) => Promise<SaveBackup>;
  restoreSaveBackup: (game: Game, backupId: string) => Promise<{ backup: SaveBackup; preRestoreBackup: SaveBackup }>;
  openPath: (path: string) => Promise<void>;
  rescanMetadata: (game: Game) => Promise<Partial<PickedLaunchFile>>;
  enrichOnlineMetadata: (game: Game, options?: { forceTranslation?: boolean }) => Promise<Partial<PickedLaunchFile> & { confidence?: number; source?: string; sourceId?: string }>;
  enrichBulkMetadata: (game: Game) => Promise<BulkMetadataEnrichmentResult>;
  searchMetadataCandidates: (game: Game, keyword?: string) => Promise<MetadataCandidate[]>;
  applyMetadataCandidate: (game: Game, candidate: MetadataCandidate) => Promise<Partial<PickedLaunchFile> & { confidence?: number; source?: string; sourceId?: string }>;
  findCoverCandidates: (game: Game) => Promise<CoverCandidate[]>;
  lookupBangumiRating: (game: Game) => Promise<Partial<Game>>;
  openBangumi: (game: Game) => Promise<{ rating: Partial<Game>; url: string }>;
  readImageDataUrl: (path: string) => Promise<string>;
  launchGame: (game: Game, integrationSettings?: IntegrationSettings) => Promise<LaunchResult>;
  onPlaySessionEnded: (callback: (event: PlaySessionEndedEvent) => void) => () => void;
  reportFirstPaint?: () => void;
}

declare global {
  interface Window {
    galLauncher: LauncherApi;
  }
}
