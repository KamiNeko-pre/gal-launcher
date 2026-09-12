import { useEffect, useState } from "react";
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
  Languages,
  Sparkles,
  X
} from "lucide-react";
import type { EnhancementToolId, Game } from "../types";
import {
  completeness,
  formatBgmRating,
  formatDate,
  formatPlayTime,
  getRecentTwoWeeksSeconds,
  getTotalPlaySeconds,
  metadataSourceLabel,
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
  onRetryBangumiRating: (game: Game) => void;
  onOpenBangumi: (game: Game) => void;
  onRetryTranslation: (game: Game) => void;
  isSearchingMetadata: boolean;
  isFindingCovers: boolean;
  metadataKeyword: string;
  onToggleEnhancement: (game: Game, toolId: EnhancementToolId) => void | Promise<void>;
  isEnhancementBusy: boolean;
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
  onRetryBangumiRating,
  onOpenBangumi,
  onRetryTranslation,
  isSearchingMetadata,
  isFindingCovers,
  metadataKeyword,
  onToggleEnhancement,
  isEnhancementBusy
}: SideSheetProps) {
  const [deletePending, setDeletePending] = useState(false);
  const [showOriginalDescription, setShowOriginalDescription] = useState(false);
  useEffect(() => setShowOriginalDescription(false), [game?.id]);
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
    <aside className={`side-sheet ${isOpen ? "open" : ""}`} inert={!isOpen} aria-hidden={!isOpen}>
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
            {game.metadataSource && <span className="status-pill">资料来源：{metadataSourceLabel(game.metadataSource)}</span>}
            {game.localeEmulator?.enabled && <span className="status-pill">转区启动</span>}
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
              <ImagePlus size={18} className={isFindingCovers ? "spinning" : ""} />
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

          <div className="sheet-enhancement">
            <div className="sheet-enhancement-head">
              <span>游戏增强</span>
              <small>按作品独立设置</small>
            </div>
            <div className="sheet-enhancement-actions">
              <button
                type="button"
                className={`enhancement-quick ${game.localeEmulator?.enabled ? "enabled" : ""}`}
                disabled={isEnhancementBusy}
                aria-pressed={game.localeEmulator?.enabled === true}
                onClick={() => void onToggleEnhancement(game, "localeEmulator")}
              >
                <Languages size={16} />
                <span>{game.localeEmulator?.enabled ? "已启用转区" : "一键转区"}</span>
              </button>
              <button
                type="button"
                className={`enhancement-quick ${game.magpieEnabled ? "enabled" : ""}`}
                disabled={isEnhancementBusy}
                aria-pressed={game.magpieEnabled === true}
                onClick={() => void onToggleEnhancement(game, "magpie")}
              >
                <Sparkles size={16} />
                <span>{game.magpieEnabled ? "已启用超分" : "一键超分"}</span>
              </button>
            </div>
            <small className="sheet-enhancement-hint">
              {isEnhancementBusy ? "正在检查或部署官方工具…" : "首次使用可选择已有程序或一键安装；仅对当前作品生效"}
            </small>
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
                {game.bgmRatingStatus && game.bgmRatingStatus !== "success" && (
                  <button className="text-button" onClick={() => onRetryBangumiRating(game)} style={{ marginTop: 6 }}>
                    <RefreshCw size={13} /> 重新查询
                  </button>
                )}
                <button className="text-button" onClick={() => onOpenBangumi(game)} style={{ marginTop: 6 }}>
                  在 Bangumi 查看
                </button>
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
                <details className="session-collapsible" open>
                  <summary>
                    <Clock3 size={16} />
                    游玩记录
                    {game.sessions && game.sessions.length > 0 ? <span>{game.sessions.length} 次</span> : null}
                  </summary>
                  <div className="session-collapsible-body">
                    {game.sessions && game.sessions.length > 0 ? (
                      <div className="sessions-list">
                        {game.sessions.slice().reverse().slice(0, 5).map((session, i) => (
                          <div key={session.sessionId || i} className="session-item">
                            <span className="session-date">{formatDate(session.startedAt)}</span>
                            <span className="session-duration">{formatPlayTime(session.durationSeconds)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="sheet-hint">还没有游玩记录</p>
                    )}
                  </div>
                </details>

                {game.description ? (
                  <>
                    {game.translationStatus === "failed" && (
                      <>
                        <p className="sheet-hint" style={{ marginTop: 12 }}>翻译暂不可用，当前显示原文</p>
                        <button className="text-button" onClick={() => onRetryTranslation(game)} style={{ marginTop: 6 }}>重新翻译</button>
                      </>
                    )}
                    {game.translationStatus === "partial" && (
                      <>
                        <p className="sheet-hint" style={{ marginTop: 12 }}>翻译未完全完成，未成功部分保留原文</p>
                        <button className="text-button" onClick={() => onRetryTranslation(game)} style={{ marginTop: 6 }}>重新翻译</button>
                      </>
                    )}
                    {(game.descriptionOriginal || game.descriptionZh) && (
                      <button className="text-button" onClick={() => setShowOriginalDescription((value) => !value)} style={{ marginTop: 8 }}>
                        {showOriginalDescription ? "显示中文" : "显示原文"}
                      </button>
                    )}
                    <p className="sheet-description" style={{ marginTop: 12 }}>{showOriginalDescription ? (game.descriptionOriginal || game.description) : game.description}</p>
                  </>
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
