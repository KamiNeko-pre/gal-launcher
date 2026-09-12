function isLandscapeCoverDimensions({ width = 0, height = 0, ratio = 0 } = {}) {
  return width >= 1080 && height >= 600 && ratio >= 1.18 && ratio <= 2.8;
}

module.exports = { isLandscapeCoverDimensions };
