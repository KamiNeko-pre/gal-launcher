import { useState } from "react";
import {
  Clock3,
  FolderOpen,
  Gamepad2,
  RefreshCw,
  ImagePlus,
  Edit3,
  Trash2,
  ShieldCheck,
  Tags,
  X
} from "lucide-react";
import type { Game } from "../types";
import {
  completeness,
  formatBgmRating,
  formatDate,
  formatPlayTime,
  getRecentTwoWeeksSeconds,
  getTotalPlaySeconds,
  metadataChecks,
  statusMeta
} from "../utils";
import "./SideSheet.css";

interface SideSheetProps {
  game: Game | null;
  isOpen: boolean;
  onClose: () => void;
  clockTick: number;
  onRescanMetadata: (game: Game, keyword: string) => void;
  onFindCovers: (game: Game) => void;
  onEdit: (game: Game) => void;
  onDelete: (game: Game) => void;
  isSearchingMetadata: boolean;
  isFindingCovers: boolean;
  metadataKeyword: string;
}

export function SideSheet({
  game,
  isOpen,
  onClose,
  clockTick,
  onRescanMetadata,
  onFindCovers,
  onEdit,
  onDelete,
  isSearchingMetadata,
  isFindingCovers,
  metadataKeyword
}: SideSheetProps) {
  const [deletePending, setDeletePending] = useState(false);
  const totalSeconds = game ? getTotalPlaySeconds(game, clockTick) : 0;
  const recentTwoWeeks = game ? getRecentTwoWeeksSeconds(game, clockTick) : 0;
  const comp = game ? completeness(game) : 0;
  const checks = game ? metadataChecks(game) : [];
  const missingChecks = checks.filter((c) => !c.ok);
  const hasExtraContent = game
    ? (game.sessions && game.sessions.length > 0) || game.description || game.executablePath
    : false;

  function handleDelete() {
    if (!game) return;
    if (!deletePending) {
      setDeletePending(true);
      return;
    }
    onDelete(game);
    setDeletePending(false);
  }

  return (
    <aside className={`side-sheet ${isOpen ? "open" : ""}`}>
      {game ? (
        <>
          <button className="sheet-close" onClick={onClose} aria-label="关闭详情">
            <X size={18} />
          </button>

          {/* ---- Header ---- */}
          <p className="sheet-kicker">{game.developer || "Visual Novel"}</p>
          <h1>{game.title}</h1>
          <p className="sheet-original">{game.originalTitle || game.releaseDate || "本地游戏"}</p>

          <hr className="sheet-divider" />

          {/* ---- Status tags ---- */}
          <div className="feature-tags">
            <span className={`status-pill ${statusMeta[game.status].tone}`}>{game.status}</span>
            {game.currentSessionStartedAt && <span className="playing-pill">正在游玩</span>}
            {game.releaseDate && <span className="status-pill">{game.releaseDate}</span>}
          </div>

          {/* ---- Action toolbar ---- */}
          <div className="sheet-toolbar">
            <button
              className="toolbar-btn"
              onClick={() => onRescanMetadata(game, metadataKeyword)}
              disabled={isSearchingMetadata}
              aria-label="重搜资料"
            >
              <RefreshCw size={18} className={isSearchingMetadata ? "spinning" : ""} />
            </button>
            <button
              className="toolbar-btn"
              onClick={() => onFindCovers(game)}
              disabled={isFindingCovers}
              aria-label="找横版图"
            >
              <ImagePlus size={18} />
            </button>
            <button
              className="toolbar-btn"
              onClick={() => onEdit(game)}
              aria-label="编辑"
            >
              <Edit3 size={18} />
            </button>
            <button
              className="toolbar-btn danger"
              onClick={handleDelete}
              aria-label="删除"
            >
              <Trash2 size={18} />
            </button>
          </div>

          {/* ---- Delete confirmation ---- */}
          {deletePending && (
            <div className="sheet-delete-confirm">
              <span>确认移除「{game.title}」？</span>
              <div className="confirm-actions">
                <button onClick={() => setDeletePending(false)}>取消</button>
                <button className="confirm-yes" onClick={handleDelete}>确认</button>
              </div>
            </div>
          )}

          {/* ---- Playtime + BGM module ---- */}
          <div className="sheet-section">
            <div className="playtime-hero">
              <span>总时长</span>
              <strong>{formatPlayTime(totalSeconds)}</strong>
            </div>
            <div className="playtime-details">
              <div>
                <span>最近 2 周</span>
                <strong>{formatPlayTime(recentTwoWeeks)}</strong>
              </div>
              <div>
                <span>启动次数</span>
                <strong>{game.playCount} 次</strong>
              </div>
              <div>
                <span>上次游玩</span>
                <strong>{formatDate(game.lastPlayedAt)}</strong>
              </div>
              <div>
                <span>Bangumi</span>
                <strong>{formatBgmRating(game)}</strong>
              </div>
            </div>
          </div>

          {/* ---- Completeness ---- */}
          <div className="sheet-section">
            <div className="completeness-head">
              <ShieldCheck size={16} />
              <span>资料完整度</span>
              <strong>{comp}%</strong>
            </div>
            <div className="completeness-bar">
              <div className="completeness-fill" style={{ width: `${comp}%` }} />
            </div>
            {missingChecks.length > 0 && (
              <div className="completeness-missing">
                {missingChecks.map((item) => (
                  <span key={item.label}>{item.label}</span>
                ))}
              </div>
            )}
          </div>

          {/* ---- More info (collapsible) ---- */}
          {hasExtraContent && (
            <details className="sheet-collapsible" open>
              <summary>
                <Tags size={16} />
                更多信息
              </summary>
              <div className="collapsible-body">
                {game.sessions && game.sessions.length > 0 && (
                  <>
                    <div className="section-heading">
                      <Clock3 size={16} />
                      游玩记录
                    </div>
                    <div className="sessions-list">
                      {game.sessions.slice().reverse().slice(0, 5).map((session, i) => (
                        <div key={session.sessionId || i} className="session-item">
                          <span className="session-date">{formatDate(session.startedAt)}</span>
                          <span className="session-duration">{formatPlayTime(session.durationSeconds)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {!game.sessions || game.sessions.length === 0 ? (
                  <p className="sheet-hint">还没有游玩记录</p>
                ) : null}

                {game.description ? (
                  <p className="sheet-description" style={{ marginTop: 12 }}>{game.description}</p>
                ) : (
                  <p className="sheet-hint" style={{ marginTop: 12 }}>暂无简介</p>
                )}

                {game.executablePath && (
                  <div className="sheet-path">
                    <FolderOpen size={15} />
                    <span>{game.executablePath}</span>
                  </div>
                )}
              </div>
            </details>
          )}

          {/* ---- No extra content fallback ---- */}
          {!hasExtraContent && !game.description && (
            <div className="sheet-section" style={{ textAlign: "center" }}>
              <p className="sheet-hint">暂无更多信息</p>
            </div>
          )}
        </>
      ) : (
        <div className="sheet-empty">
          <Gamepad2 size={36} />
          <p>选择一款游戏查看详情</p>
        </div>
      )}
    </aside>
  );
}
