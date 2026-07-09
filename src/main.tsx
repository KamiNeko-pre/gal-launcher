import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  Edit3,
  Gamepad2,
  ImagePlus,
  Play,
  Search,
  Trash2,
  X
} from "lucide-react";
import type { CoverCandidate, GameStatus, MetadataCandidate } from "./types";
import { themePresets, defaultTheme } from "./theme";
import { statuses } from "./utils";
import { useLibrary } from "./useLibrary";
import { SideSheet } from "./components/SideSheet";
import { CinemaLayout } from "./layouts/CinemaLayout";
import { EditorialLayout } from "./layouts/EditorialLayout";
import { ArcadeLayout } from "./layouts/ArcadeLayout";
import { AtelierLayout } from "./layouts/AtelierLayout";
import { AuroraLayout } from "./layouts/AuroraLayout";
import { MonoLuxLayout } from "./layouts/MonoLuxLayout";
import "./styles.css";
import "./themes/editorial.css";
import "./themes/arcade.css";
import "./themes/atelier.css";
import "./themes/aurora.css";
import "./themes/monolux.css";

const sourceColors: Record<string, string> = {
  "Steam": "#1a9fff",
  "官网": "#4caf50",
  "DLsite": "#00bcd4",
  "VNDB截图": "#5c9ce0",
  "VNDB封面": "#5c9ce0",
  "2DFan": "#3f51b5",
  "量子ACG": "#e91e63",
  "本地文件夹": "#ff9800",
  "当前横版图": "#9c27b0",
  "Bangumi": "#f44336"
};

const layouts: Partial<Record<string, typeof CinemaLayout>> = {
  cinema: CinemaLayout,
  editorial: EditorialLayout,
  arcade: ArcadeLayout,
  atelier: AtelierLayout,
  aurora: AuroraLayout,
  monolux: MonoLuxLayout
};

function App() {
  const lib = useLibrary();
  const {
    statusFilter,
    isEditing,
    isInfoOpen, setIsInfoOpen,
    isThemeOpen, setIsThemeOpen,
    theme, setTheme,
    draft, setDraft,
    notice, setNotice,
    imageCache,
    coverCandidates,
    isCoverPickerOpen, setIsCoverPickerOpen,
    isFindingCovers,
    metadataCandidates,
    candidateGameId,
    isCandidatePickerOpen, setIsCandidatePickerOpen,
    isSearchingMetadata,
    metadataKeyword, setMetadataKeyword,
    clockTick,
    ctxMenu,
    selected,
    usesCoverFallback,
    games,
    openMetadataCandidates,
    applyMetadataCandidate,
    launch,
    rescanMetadata,
    findCovers,
    chooseCover,
    deleteGame,
    startEdit,
    closeEdit,
    closeContextMenu,
    saveDraft,
    chooseImage,
    persistGame
  } = lib;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme.id);
    const linkId = "theme-font";
    let link = document.getElementById(linkId) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = theme.fontHref;
  }, [theme]);

  const Layout = layouts[theme.id] ?? CinemaLayout;

  return (
    <div className={`app-shell ${usesCoverFallback ? "cover-fallback-mode" : "keyvisual-mode"} ${isInfoOpen ? "info-open" : ""}`}>
      <Layout lib={lib} />

      <SideSheet
        game={selected}
        isOpen={isInfoOpen}
        onClose={() => setIsInfoOpen(false)}
        clockTick={clockTick}
        onRescanMetadata={openMetadataCandidates}
        onFindCovers={findCovers}
        onEdit={startEdit}
        onDelete={deleteGame}
        isSearchingMetadata={isSearchingMetadata}
        isFindingCovers={isFindingCovers}
        metadataKeyword={metadataKeyword}
      />

      {isEditing && draft && (
        <div className="modal-backdrop">
          <section className="modal">
            <div className="modal-header">
              <h2>编辑资料</h2>
              <button className="icon-button" onClick={closeEdit}>
                <X size={18} />
              </button>
            </div>

            <div className="form-grid">
              <label>
                标题
                <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
              </label>
              <label>
                原名
                <input value={draft.originalTitle} onChange={(event) => setDraft({ ...draft, originalTitle: event.target.value })} />
              </label>
              <label>
                会社
                <input value={draft.developer} onChange={(event) => setDraft({ ...draft, developer: event.target.value })} />
              </label>
              <label>
                发售日期
                <input value={draft.releaseDate} onChange={(event) => setDraft({ ...draft, releaseDate: event.target.value })} placeholder="YYYY-MM-DD" />
              </label>
              <label>
                状态
                <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as GameStatus })}>
                  {statuses.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </label>
              <label className="full">
                标签
                <input value={draft.tags.join(", ")} onChange={(event) => setDraft({ ...draft, tags: event.target.value.split(/[，,]/).map((item) => item.trim()).filter(Boolean) })} placeholder="纯爱, 悬疑, 汉化" />
              </label>
              <label className="full">
                简介
                <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
              </label>
              <label className="full">
                启动文件
                <input value={draft.executablePath} onChange={(event) => setDraft({ ...draft, executablePath: event.target.value })} />
              </label>
              <label className="full">
                工作目录
                <input value={draft.workingDirectory} onChange={(event) => setDraft({ ...draft, workingDirectory: event.target.value })} />
              </label>
            </div>

            <div className="asset-row">
              <button onClick={() => chooseImage("coverPath")}>
                <ImagePlus size={18} />
                选择封面
              </button>
              <button onClick={() => chooseImage("backgroundPath")}>
                <ImagePlus size={18} />
                选择背景图
              </button>
            </div>

            <div className="modal-actions">
              <button className="soft-button" onClick={closeEdit}>取消</button>
              <button className="play-button" onClick={saveDraft}>保存</button>
            </div>
          </section>
        </div>
      )}

      {isCoverPickerOpen && (
        <div className="modal-backdrop">
          <section className="modal cover-picker">
            <div className="modal-header">
              <h2>选择横版封面</h2>
              <button className="icon-button" onClick={() => setIsCoverPickerOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="candidate-grid">
              {isFindingCovers
                ? Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="candidate-card skeleton">
                      <div className="candidate-image skeleton-pulse" />
                      <div className="skeleton-line" style={{ width: "60%" }} />
                      <div className="skeleton-line" style={{ width: "40%" }} />
                    </div>
                  ))
                : coverCandidates.map((candidate: CoverCandidate) => (
                    <button key={candidate.id} className="candidate-card" onClick={() => chooseCover(candidate)}>
                      <div className="candidate-image">
                        {imageCache[candidate.path] ? <img src={imageCache[candidate.path]} alt="" /> : <Gamepad2 size={30} />}
                      </div>
                      <span
                        className="source-badge"
                        style={{ "--badge-color": sourceColors[candidate.source] || "#888" } as React.CSSProperties}
                      >
                        {candidate.source}
                      </span>
                      <span>{candidate.width} x {candidate.height}</span>
                      <small>{candidate.reason}</small>
                    </button>
                  ))}
              {!isFindingCovers && coverCandidates.length === 0 && <p className="candidate-empty">没有找到符合横版比例的候选图。</p>}
            </div>
          </section>
        </div>
      )}

      {isCandidatePickerOpen && (
        <div className="modal-backdrop">
          <section className="modal metadata-picker">
            <div className="modal-header">
              <h2>确认作品资料</h2>
              <button className="icon-button" onClick={() => setIsCandidatePickerOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="metadata-search-row">
              <input value={metadataKeyword} onChange={(event) => setMetadataKeyword(event.target.value)} placeholder="输入标题重新搜索，例如 サクラノ刻 / WHITE ALBUM2" />
              <button className="soft-button" onClick={() => {
                const game = games.find((item) => item.id === candidateGameId);
                if (game) openMetadataCandidates(game, metadataKeyword);
              }}>
                <Search size={18} />
                搜索
              </button>
            </div>
            <div className="metadata-candidate-list">
              {metadataCandidates.map((candidate: MetadataCandidate) => (
                <button key={`${candidate.source}-${candidate.sourceId}`} className="metadata-candidate" onClick={() => applyMetadataCandidate(candidate)}>
                  <div className="metadata-cover">
                    {candidate.coverUrl ? <img src={candidate.coverUrl} alt="" /> : <Gamepad2 size={30} />}
                  </div>
                  <div>
                    <strong>{candidate.title}</strong>
                    <span>{candidate.originalTitle || candidate.releaseDate || candidate.sourceId}</span>
                    <small>{candidate.developer || "未知会社"} · 匹配度 {Math.round(candidate.confidence * 100)}%</small>
                    <p>{candidate.descriptionPreview || "暂无简介预览"}</p>
                  </div>
                </button>
              ))}
              {metadataCandidates.length === 0 && <p className="candidate-empty">没有找到候选。可以换日文原名、英文名或会社名再搜。</p>}
            </div>
          </section>
        </div>
      )}

      {ctxMenu && (
        <>
          <div className="ctx-backdrop" onClick={closeContextMenu} onContextMenu={(e) => { e.preventDefault(); closeContextMenu(); }} />
          <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            <button onClick={() => { launch(ctxMenu.game); closeContextMenu(); }}><Play size={16} /> 启动</button>
            <div className="ctx-divider" />
            <div className="ctx-subheader">修改状态</div>
            {statuses.map((s) => (
              <button key={s} className={ctxMenu.game.status === s ? "ctx-active" : ""} onClick={() => { persistGame({ ...ctxMenu.game, status: s }); closeContextMenu(); }}>
                {ctxMenu.game.status === s ? "✓ " : ""}{s}
              </button>
            ))}
            <div className="ctx-divider" />
            <button onClick={() => { startEdit(ctxMenu.game); closeContextMenu(); }}><Edit3 size={16} /> 编辑</button>
            <button className="ctx-danger" onClick={() => { deleteGame(ctxMenu.game); closeContextMenu(); }}><Trash2 size={16} /> 删除</button>
          </div>
        </>
      )}

      {isThemeOpen && (
        <div className="modal-backdrop">
          <section className="modal theme-modal">
            <div className="modal-header">
              <h2>主题设置</h2>
              <button className="icon-button" onClick={() => setIsThemeOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="theme-presets">
              {themePresets.map((preset) => (
                <button
                  key={preset.id}
                  className={`theme-card ${theme.id === preset.id ? "active" : ""}`}
                  onClick={() => setTheme(preset)}
                >
                  <span className={`theme-preview theme-preview-${preset.id}`} />
                  <strong>{preset.name}</strong>
                  <small>{preset.description}</small>
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button className="soft-button" onClick={() => setTheme(defaultTheme)}>恢复默认</button>
              <button className="play-button" onClick={() => setIsThemeOpen(false)}>完成</button>
            </div>
          </section>
        </div>
      )}

      {notice && (
        <button className="toast" onClick={() => setNotice("")} role="status" aria-live="polite">
          {notice}
        </button>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
