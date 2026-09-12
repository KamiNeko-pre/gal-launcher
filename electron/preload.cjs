const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("galLauncher", {
  loadLibrary: () => ipcRenderer.invoke("library:load"),
  saveLibrary: (games) => ipcRenderer.invoke("library:save", games),
  loadLibraryDocument: () => ipcRenderer.invoke("library:loadDocument"),
  saveLibraryDocument: (document) => ipcRenderer.invoke("library:saveDocument", document),
  scanLaunchCandidates: (rootPath) => ipcRenderer.invoke("library:scanLaunchCandidates", rootPath),
  cancelLaunchScan: () => ipcRenderer.invoke("library:cancelLaunchScan"),
  onLaunchScanProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("library:scanProgress", listener);
    return () => ipcRenderer.removeListener("library:scanProgress", listener);
  },
  pickLaunchFile: () => ipcRenderer.invoke("dialog:pickLaunchFile"),
  getEnhancementTools: () => ipcRenderer.invoke("tools:status"),
  installEnhancementTool: (toolId, options) => ipcRenderer.invoke("tools:install", toolId, options),
  selectExistingEnhancementTool: (toolId, executablePath) => ipcRenderer.invoke("tools:selectExisting", toolId, executablePath),
  validateEnhancementTool: (toolId, executablePath) => ipcRenderer.invoke("tools:validateExisting", toolId, executablePath),
  pickEnhancementToolArchive: (toolId) => ipcRenderer.invoke("dialog:pickToolArchive", toolId),
  getMagpiePresets: () => ipcRenderer.invoke("tools:magpiePresets"),
  onEnhancementToolProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("tools:progress", listener);
    return () => ipcRenderer.removeListener("tools:progress", listener);
  },
  exportLibrary: (games) => ipcRenderer.invoke("library:export", games),
  importLibrary: () => ipcRenderer.invoke("library:import"),
  pickImage: () => ipcRenderer.invoke("dialog:pickImage"),
  pickFolder: () => ipcRenderer.invoke("dialog:pickFolder"),
  toggleFullscreen: () => ipcRenderer.invoke("window:toggleFullscreen"),
  isFullscreen: () => ipcRenderer.invoke("window:isFullscreen"),
  onFullscreenChanged: (callback) => {
    const listener = (_event, value) => callback(Boolean(value));
    ipcRenderer.on("window:fullscreenChanged", listener);
    return () => ipcRenderer.removeListener("window:fullscreenChanged", listener);
  },
  saveBackups: (game) => ipcRenderer.invoke("game:saveBackups", game),
  createSaveBackup: (game) => ipcRenderer.invoke("game:createSaveBackup", game),
  restoreSaveBackup: (game, backupId) => ipcRenderer.invoke("game:restoreSaveBackup", game, backupId),
  openPath: (targetPath) => ipcRenderer.invoke("shell:openPath", targetPath),
  rescanMetadata: (game) => ipcRenderer.invoke("game:rescanMetadata", game),
  enrichOnlineMetadata: (game, options) => ipcRenderer.invoke("game:enrichOnlineMetadata", game, options),
  enrichBulkMetadata: (game) => ipcRenderer.invoke("game:enrichBulkMetadata", game),
  searchMetadataCandidates: (game, keyword) => ipcRenderer.invoke("game:searchMetadataCandidates", game, keyword),
  applyMetadataCandidate: (game, candidate) => ipcRenderer.invoke("game:applyMetadataCandidate", game, candidate),
  findCoverCandidates: (game) => ipcRenderer.invoke("game:findCoverCandidates", game),
  lookupBangumiRating: (game) => ipcRenderer.invoke("game:lookupBangumiRating", game),
  openBangumi: (game) => ipcRenderer.invoke("game:openBangumi", game),
  readImageDataUrl: (path) => ipcRenderer.invoke("image:readDataUrl", path),
  launchGame: (game, integrationSettings) => ipcRenderer.invoke("game:launch", game, integrationSettings),
  onPlaySessionEnded: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("game:sessionEnded", listener);
    return () => ipcRenderer.removeListener("game:sessionEnded", listener);
  },
  reportFirstPaint: () => ipcRenderer.send("perf:first-paint-ack")
});
