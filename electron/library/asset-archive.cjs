const fs = require("node:fs");
const path = require("node:path");

function isManagedPath(filePath, libraryRoot) {
  if (!filePath) return true;
  const relative = path.relative(libraryRoot, filePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function archiveImage(filePath, gameId, kind, libraryRoot) {
  if (!filePath || isManagedPath(filePath, libraryRoot) || !fs.existsSync(filePath)) return filePath || "";
  const extension = path.extname(filePath).toLowerCase();
  const safeExtension = [".jpg", ".jpeg", ".png", ".webp", ".bmp"].includes(extension) ? extension : ".jpg";
  const destination = path.join(libraryRoot, "assets", `${gameId}-${kind}${safeExtension}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(filePath, destination);
  return destination;
}

function archiveGameImages(games, userDataPath) {
  const libraryRoot = path.join(userDataPath, "library");
  return (Array.isArray(games) ? games : []).map((game) => {
    const coverPath = archiveImage(game.coverPath, game.id, "cover", libraryRoot);
    const backgroundPath = game.backgroundPath === game.coverPath && coverPath
      ? coverPath
      : archiveImage(game.backgroundPath, game.id, "background", libraryRoot);
    return { ...game, coverPath, backgroundPath };
  });
}

module.exports = { archiveGameImages };
