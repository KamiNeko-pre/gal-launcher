export function selectDisplayImage(
  imageCache: Record<string, string>,
  backgroundPath: string,
  coverPath: string
) {
  return imageCache[backgroundPath] || imageCache[coverPath] || "";
}
