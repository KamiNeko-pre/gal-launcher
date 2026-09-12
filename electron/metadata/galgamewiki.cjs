const crypto = require("node:crypto");

const BASE_URL = "https://www.galgamewiki.com";
const MAX_DETAIL_REQUESTS_PER_LOOKUP = 3;
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;

const namedEntities = new Map([
  ["amp", "&"], ["apos", "'"], ["gt", ">"], ["lt", "<"],
  ["nbsp", " "], ["quot", '"'], ["hellip", "…"],
  ["#8211", "–"], ["#8212", "—"], ["#8216", "‘"],
  ["#8217", "’"], ["#8220", "“"], ["#8221", "”"]
]);

function decodeHtmlEntities(value) {
  return String(value || "").replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    const key = entity.toLowerCase();
    if (namedEntities.has(key)) return namedEntities.get(key);
    if (key.startsWith("#x")) return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
    if (key.startsWith("#")) return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
    return match;
  });
}

function htmlToText(value) {
  return decodeHtmlEntities(String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[\t\r ]+/g, " ")
    .replace(/ *\n+ */g, "\n")
    .trim();
}

function tableFields(contentHtml) {
  const fields = new Map();
  for (const row of String(contentHtml || "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => htmlToText(match[1]));
    if (cells.length >= 2 && cells[0]) fields.set(cells[0].replace(/[：:]+$/, "").trim(), cells[1].trim());
  }
  return fields;
}

function firstField(fields, names) {
  for (const name of names) if (fields.get(name)) return fields.get(name);
  return "";
}

function normalizeDate(value) {
  const match = String(value || "").match(/((?:19|20)\d{2})\s*[年\/.\-]\s*(\d{1,2})\s*[月\/.\-]\s*(\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : "";
}

function titleParts(value) {
  const clean = htmlToText(value).replace(/^【[^】]{1,80}】\s*/, "").trim();
  // The wiki combines translated and original names. A slash in Fate/stay
  // night is not an alias separator; a script transition or spaced slash is.
  const parts = clean.split(/\s+[\/／]\s+|(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])[\/／]|[\/／](?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/u)
    .flatMap(part => {
      const bilingual = part.match(/^([^（(]+)[（(]([^）)]+)[）)]$/);
      return bilingual && !/[ぁ-ヿ]/.test(bilingual[1]) && /[ぁ-ヿ]/.test(bilingual[2])
        ? bilingual.slice(1) : [part];
    }).map(part => part.trim()).filter(Boolean);
  return { title: parts[0] || clean, alternate: parts[1] || "", aliases: parts };
}

function compactTitle(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}+]/gu, "");
}

function titleScore(query, values, similarity = () => 0) {
  const left = compactTitle(query);
  return values.reduce((best, value) => {
    const right = compactTitle(value);
    if (!left || !right) return best;
    // Never discard edition/sequel numbers while normalizing typography.
    const edition = text => (String(text).normalize("NFKC").match(/\d+(?:\.\d+)*|\+/g) || []).join(",");
    if (edition(query) !== edition(value)) return best;
    const compactScore = left === right ? 1 : (left.includes(right) || right.includes(left)) ? 0.86 : 0;
    return Math.max(best, compactScore, similarity(query, value));
  }, 0);
}

function leadDescription(contentHtml, fallback) {
  const paragraphs = [...String(contentHtml || "").matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => htmlToText(match[1]))
    .filter((text) => text.length >= 12);
  const text = paragraphs.join("\n\n") || htmlToText(fallback);
  return text.slice(0, 1600).trim();
}

function normalizeGalgameWikiDetail(detail = {}) {
  const fields = tableFields(detail.content_html);
  const titles = titleParts(detail.title);
  const originalTitle = firstField(fields, ["原始名称", "原版名称", "日文原名", "原名"]) || titles.alternate || titles.title;
  return {
    id: String(detail.post_id || ""),
    title: titles.title,
    originalTitle,
    titleAliases: titles.aliases,
    developer: firstField(fields, ["开发商", "制作公司", "制作会社", "游戏品牌", "品牌"]),
    releaseDate: normalizeDate(firstField(fields, ["发行日期", "发售日期", "初版发行日期"])),
    description: leadDescription(detail.content_html, detail.excerpt),
    coverUrl: /^https:\/\//i.test(String(detail.cover_url || "")) ? String(detail.cover_url) : "",
    permalink: /^https:\/\//i.test(String(detail.permalink || "")) ? String(detail.permalink) : "",
    categories: Array.isArray(detail.categories) ? detail.categories.map(htmlToText).filter(Boolean) : [],
    tags: Array.isArray(detail.tags) ? detail.tags.map(htmlToText).filter(Boolean).slice(0, 8) : []
  };
}

function isGameDetail(item) {
  return item.categories.includes("游戏");
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const output = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      try { output[index] = await mapper(values[index]); } catch { output[index] = null; }
    }
  });
  await Promise.all(workers);
  return output;
}

function toMetadataCandidate(query, item, similarity) {
  const aliases = [item.title, item.originalTitle, ...(item.titleAliases || [])].filter(Boolean);
  const confidence = titleScore(query, aliases, similarity);
  return {
    source: "galgamewiki",
    sourceId: item.id,
    confidence,
    matchedQuery: query,
    title: item.title,
    originalTitle: item.originalTitle,
    developer: item.developer,
    releaseDate: item.releaseDate,
    descriptionPreview: item.description.slice(0, 220),
    coverUrl: item.coverUrl
  };
}

function toMetadataPatch(item, confidence = 0) {
  const description = item.description || "";
  return {
    source: "galgamewiki",
    sourceId: item.id,
    confidence,
    metadataSource: "galgamewiki",
    metadataSourceId: item.id,
    metadataConfidence: confidence,
    title: item.title,
    originalTitle: item.originalTitle,
    developer: item.developer,
    releaseDate: item.releaseDate,
    description,
    descriptionOriginal: description,
    descriptionZh: description,
    descriptionSourceHash: crypto.createHash("sha256").update(description, "utf8").digest("hex"),
    translationStatus: description ? "already_zh" : "empty",
    translationUpdatedAt: new Date().toISOString(),
    coverPath: item.coverUrl,
    tags: item.tags
  };
}

function createGalgameWikiClient({ requestJson, userAgent = "Gal Launcher" } = {}) {
  if (typeof requestJson !== "function") throw new TypeError("createGalgameWikiClient requires requestJson");
  const searchCache = new Map();

  async function getById(id) {
    const value = String(id || "");
    if (!/^\d+$/.test(value)) throw new Error("无效的 GalgameWiki 条目");
    const result = await requestJson(`${BASE_URL}/wp-json/galgame-launcher/v1/games/${value}`, {
      headers: { "User-Agent": userAgent }, timeoutMs: 7000
    });
    if (result.status !== "success" || !result.data?.post_id) throw new Error("GalgameWiki 详情不可用");
    return normalizeGalgameWikiDetail(result.data);
  }

  async function search(query) {
    const keyword = String(query || "").trim().replace(/\s+/g, " ");
    if (!keyword) return [];
    const cacheKey = keyword.toLocaleLowerCase();
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < SEARCH_CACHE_TTL_MS) return cached.items;
    const searchIndex = async term => {
      const url = `${BASE_URL}/wp-json/wp/v2/search?search=${encodeURIComponent(term)}&type=post&subtype=post&page=1&per_page=30`;
      const result = await requestJson(url, { headers: { "User-Agent": userAgent }, timeoutMs: 6500 });
      if (result.status !== "success" || !Array.isArray(result.data)) throw new Error("GalgameWiki 搜索不可用");
      return result.data;
    };
    let index = await searchIndex(keyword);
    const mainTitle = keyword.split(/[～~－—：:]|\s+-\s*/)[0].trim();
    if (!index.length && mainTitle !== keyword && compactTitle(mainTitle).length >= 3) {
      index = await searchIndex(mainTitle);
    }
    // Full-text order is not title relevance. Rank the lightweight index first,
    // then spend the bounded detail budget, always against the complete query.
    const ids = [...new Map(index.map(item => [String(item?.id || ""), item])).values()]
      .filter(item => /^\d+$/.test(String(item?.id || "")))
      .map(item => ({ id: String(item.id), score: titleScore(keyword, titleParts(item.title).aliases) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_DETAIL_REQUESTS_PER_LOOKUP).map(item => item.id);
    const available = (await mapWithConcurrency(ids, 2, getById)).filter(Boolean);
    if (ids.length && !available.length) throw new Error("GalgameWiki 详情不可用");
    const items = available.filter(isGameDetail);
    searchCache.set(cacheKey, { createdAt: Date.now(), items });
    return items;
  }

  return { getById, search };
}

module.exports = {
  createGalgameWikiClient,
  normalizeGalgameWikiDetail,
  toMetadataCandidate,
  toMetadataPatch
};
