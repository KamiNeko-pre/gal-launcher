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
  developer: string;
  releaseDate: string;
  installPath: string;
  executablePath: string;
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
  bgmRatingCheckedAt?: string;
  playCount: number;
  totalPlaySeconds?: number;
  currentSessionId?: string | null;
  currentSessionStartedAt?: string | null;
  lastPlayedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sessions?: PlaySession[];
}

export interface LaunchResult {
  launched: boolean;
  sessionId?: string;
  startedAt?: string;
}

export interface PlaySessionEndedEvent {
  gameId: string;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
}

export interface PickedLaunchFile {
  title: string;
  originalTitle?: string;
  description?: string;
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

export interface LauncherApi {
  loadLibrary: () => Promise<Game[]>;
  saveLibrary: (games: Game[]) => Promise<Game[]>;
  exportLibrary: (games: Game[]) => Promise<string>;
  importLibrary: () => Promise<Game[] | null>;
  pickLaunchFile: () => Promise<PickedLaunchFile | null>;
  pickImage: () => Promise<string | null>;
  pickFolder: () => Promise<string | null>;
  rescanMetadata: (game: Game) => Promise<Partial<PickedLaunchFile>>;
  enrichOnlineMetadata: (game: Game) => Promise<Partial<PickedLaunchFile> & { confidence?: number; source?: string; sourceId?: string }>;
  searchMetadataCandidates: (game: Game, keyword?: string) => Promise<MetadataCandidate[]>;
  applyMetadataCandidate: (game: Game, candidate: MetadataCandidate) => Promise<Partial<PickedLaunchFile> & { confidence?: number; source?: string; sourceId?: string }>;
  findCoverCandidates: (game: Game) => Promise<CoverCandidate[]>;
  lookupBangumiRating: (game: Game) => Promise<Partial<Game>>;
  readImageDataUrl: (path: string) => Promise<string>;
  launchGame: (game: Game) => Promise<LaunchResult>;
  onPlaySessionEnded: (callback: (event: PlaySessionEndedEvent) => void) => () => void;
}

declare global {
  interface Window {
    galLauncher: LauncherApi;
  }
}
