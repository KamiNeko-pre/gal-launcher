const path = require("node:path");

function getAppIconPath({ isPackaged, resourcesPath, projectRoot }) {
  return path.join(isPackaged ? resourcesPath : path.join(projectRoot, "build"), "icon.ico");
}

module.exports = { getAppIconPath };
