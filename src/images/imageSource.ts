export function resolveImageSource(imagePath: string) {
  const value = String(imagePath || "");
  if (!value) return "";
  if (/^(?:data:|https?:|local-file:)/i.test(value)) return value;
  const normalized = value.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/");
  return `local-file://localhost/${normalized}`;
}
