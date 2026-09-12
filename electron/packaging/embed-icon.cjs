const fs = require("node:fs");
const path = require("node:path");
const { Data, NtExecutable, NtExecutableResource, Resource } = require("resedit");

function replaceExeIcon(exePath, iconPath) {
  const executable = NtExecutable.from(fs.readFileSync(exePath));
  const resources = NtExecutableResource.from(executable);
  const iconFile = Data.IconFile.from(fs.readFileSync(iconPath));
  const iconGroups = Resource.IconGroupEntry.fromEntries(resources.entries);

  if (iconGroups.length === 0) {
    throw new Error(`Cannot embed icon: no icon group found in ${exePath}`);
  }

  for (const iconGroup of iconGroups) {
    Resource.IconGroupEntry.replaceIconsForResource(
      resources.entries,
      iconGroup.id,
      iconGroup.lang,
      iconFile.icons.map((item) => item.data),
    );
  }

  resources.outputResource(executable);
  fs.writeFileSync(exePath, Buffer.from(executable.generate()));
}

async function afterPack(context) {
  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const iconPath = path.join(context.packager.projectDir, "build", "icon.ico");
  replaceExeIcon(exePath, iconPath);
}

module.exports = afterPack;
module.exports.replaceExeIcon = replaceExeIcon;
