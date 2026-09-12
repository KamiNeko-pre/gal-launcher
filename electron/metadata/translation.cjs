function hasCjk(value) {
  return /[\u3400-\u9fff]/.test(value);
}

function isAlreadyChinese(value) {
  const text = String(value || "");
  const han = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const kana = (text.match(/[\u3040-\u30ff]/g) || []).length;
  return han >= 20 && kana === 0 && han >= latin;
}

function acceptableTranslation(source, translated) {
  const value = String(translated || "").trim();
  if (!value) return false;
  if (hasCjk(source)) return true;
  return hasCjk(value);
}

function successfulTranslation(text) {
  return { status: "success", text: String(text || "") };
}

function translationText(candidate, { requireStructuredResults }) {
  if (requireStructuredResults) {
    return candidate?.status === "success" ? candidate.text : "";
  }
  return candidate;
}

async function translateLongText(text, {
  chunkSize = 450,
  translateChunk,
  fallbackChunk,
  requireStructuredResults = false
} = {}) {
  const source = String(text || "");
  if (!source) return { text: source, status: "empty", usedFallback: false };
  if (isAlreadyChinese(source) && !/QUERY LENGTH LIMIT EXCEEDED|MAX ALLOWED QUERY/i.test(source)) {
    return { text: source, status: "already_zh", usedFallback: false };
  }
  if (typeof translateChunk !== "function" && typeof fallbackChunk !== "function") {
    return { text: source, status: "failed", usedFallback: false };
  }

  const chunks = [];
  for (let index = 0; index < source.length; index += chunkSize) chunks.push(source.slice(index, index + chunkSize));
  const translated = [];
  let failed = false;
  let failedChunks = 0;
  let usedFallback = false;

  for (const chunk of chunks) {
    let translatedChunk = "";
    if (translateChunk) {
      try {
        const candidate = translationText(await translateChunk(chunk), { requireStructuredResults });
        if (acceptableTranslation(chunk, candidate)) translatedChunk = String(candidate).trim();
      } catch {
        // Try the fallback provider for this same chunk.
      }
    }
    if (!translatedChunk && fallbackChunk) {
      try {
        const candidate = translationText(await fallbackChunk(chunk), { requireStructuredResults });
        if (acceptableTranslation(chunk, candidate)) {
          translatedChunk = String(candidate).trim();
          usedFallback = true;
        }
      } catch {
        // Preserve the source chunk below.
      }
    }
    if (!translatedChunk) {
      translatedChunk = chunk;
      failed = true;
      failedChunks++;
    }
    translated.push(translatedChunk);
  }

  return {
    text: failedChunks === chunks.length ? source : translated.join("\n").trim(),
    status: failed ? (failedChunks === chunks.length ? "failed" : "partial") : "success",
    usedFallback
  };
}

module.exports = { successfulTranslation, translateLongText };
