const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createGalgameWikiClient,
  normalizeGalgameWikiDetail,
  toMetadataCandidate,
  toMetadataPatch
} = require("./galgamewiki.cjs");

const gameDetail = {
  post_id: 25,
  title: "【Key社】CLANNAD / クラナド",
  excerpt: "不应优先采用这段被截断的简介……",
  cover_url: "https://img.yyddtj.top/file/clannad.jpg",
  permalink: "https://www.galgamewiki.com/wiki/31.html",
  content_html: `
    <h1>CLANNAD</h1>
    <p><strong>《CLANNAD》</strong>&nbsp;是一部以“家族”为主题的恋爱冒险游戏。</p>
    <table>
      <tr><td><strong>原版名称</strong></td><td>CLANNAD</td></tr>
      <tr><td><strong>开发商</strong></td><td>Key (Visual Arts)</td></tr>
      <tr><td><strong>发行日期</strong></td><td>初版：2004年4月28日</td></tr>
    </table>
    <script>alert("untrusted")</script>
  `,
  categories: ["Key", "支持搜索工具", "游戏", "百科"],
  tags: ["CLANNAD", "Key", "催泪"]
};

test("normalizes a GalgameWiki game without retaining HTML or executable content", () => {
  const item = normalizeGalgameWikiDetail(gameDetail);

  assert.equal(item.id, "25");
  assert.equal(item.title, "CLANNAD");
  assert.equal(item.originalTitle, "CLANNAD");
  assert.equal(item.developer, "Key (Visual Arts)");
  assert.equal(item.releaseDate, "2004-04-28");
  assert.equal(item.description, "《CLANNAD》 是一部以“家族”为主题的恋爱冒险游戏。");
  assert.equal(item.coverUrl, "https://img.yyddtj.top/file/clannad.jpg");
  assert.deepEqual(item.tags, ["CLANNAD", "Key", "催泪"]);
  assert.equal(item.description.includes("script"), false);
  assert.equal(item.description.includes("alert"), false);
});

test("searches the public index, loads launcher details, and excludes non-game posts", async () => {
  const calls = [];
  const requestJson = async (url) => {
    calls.push(url);
    if (url.includes("/wp/v2/search?")) {
      return {
        status: "success",
        data: [
          { id: 25, title: "【Key社】CLANNAD", type: "post", subtype: "post" },
          { id: 430, title: "Galgame 引擎百科", type: "post", subtype: "post" }
        ]
      };
    }
    if (url.endsWith("/games/25")) return { status: "success", data: gameDetail };
    if (url.endsWith("/games/430")) {
      return { status: "success", data: { ...gameDetail, post_id: 430, title: "Galgame 引擎百科", categories: ["工具", "百科"] } };
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  const client = createGalgameWikiClient({ requestJson });

  const results = await client.search("CLANNAD & Key");

  assert.equal(results.length, 1);
  assert.equal(results[0].id, "25");
  assert.match(calls[0], /search=CLANNAD%20%26%20Key/);
  assert.equal(calls.filter((url) => url.includes("/games/")).length, 2);
});

test("rejects malformed detail ids before making a request", async () => {
  let requested = false;
  const client = createGalgameWikiClient({ requestJson: async () => {
    requested = true;
    return { status: "success", data: gameDetail };
  } });

  await assert.rejects(() => client.getById("25/../../me"), /无效的 GalgameWiki 条目/);
  assert.equal(requested, false);
});

test("reports an unavailable search endpoint instead of pretending there were no matches", async () => {
  const client = createGalgameWikiClient({ requestJson: async () => ({ status: "network_error" }) });
  await assert.rejects(() => client.search("CLANNAD"), /GalgameWiki 搜索不可用/);
});

test("limits a lookup to three detail requests with at most two in flight", async () => {
  let active = 0;
  let peak = 0;
  let detailCalls = 0;
  const client = createGalgameWikiClient({ requestJson: async (url) => {
    if (url.includes("/wp/v2/search?")) {
      return { status: "success", data: [1, 2, 3, 4, 5].map((id) => ({ id, type: "post", subtype: "post" })) };
    }
    detailCalls++;
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active--;
    return { status: "success", data: { ...gameDetail, post_id: Number(url.match(/\/(\d+)$/)[1]) } };
  } });

  await client.search("CLANNAD");

  assert.equal(peak, 2);
  assert.equal(detailCalls, 3);
});

test("caches a successful lookup for the same normalized query", async () => {
  let searchCalls = 0;
  let detailCalls = 0;
  const client = createGalgameWikiClient({ requestJson: async (url) => {
    if (url.includes("/wp/v2/search?")) {
      searchCalls++;
      return { status: "success", data: [{ id: 25, type: "post", subtype: "post" }] };
    }
    detailCalls++;
    return { status: "success", data: gameDetail };
  } });

  const first = await client.search("  CLANNAD  ");
  const second = await client.search("CLANNAD");

  assert.equal(searchCalls, 1);
  assert.equal(detailCalls, 1);
  assert.deepEqual(second, first);
});

test("identifies the launcher on public search and detail requests", async () => {
  const optionsSeen = [];
  const client = createGalgameWikiClient({
    userAgent: "Gal Launcher/0.3.0 (+https://github.com/KamiNeko-pre/gal-launcher)",
    requestJson: async (url, options) => {
      optionsSeen.push(options);
      if (url.includes("/wp/v2/search?")) return { status: "success", data: [{ id: 25, type: "post", subtype: "post" }] };
      return { status: "success", data: gameDetail };
    }
  });

  await client.search("CLANNAD");

  assert.deepEqual(optionsSeen.map((options) => options.headers?.["User-Agent"]), [
    "Gal Launcher/0.3.0 (+https://github.com/KamiNeko-pre/gal-launcher)",
    "Gal Launcher/0.3.0 (+https://github.com/KamiNeko-pre/gal-launcher)"
  ]);
});

test("maps a normalized game to a labeled metadata candidate", () => {
  const item = normalizeGalgameWikiDetail(gameDetail);
  const candidate = toMetadataCandidate("CLANNAD", item, (left, right) => left.toLowerCase() === right.toLowerCase() ? 1 : 0);

  assert.deepEqual(candidate, {
    source: "galgamewiki",
    sourceId: "25",
    confidence: 1,
    matchedQuery: "CLANNAD",
    title: "CLANNAD",
    originalTitle: "CLANNAD",
    developer: "Key (Visual Arts)",
    releaseDate: "2004-04-28",
    descriptionPreview: "《CLANNAD》 是一部以“家族”为主题的恋爱冒险游戏。",
    coverUrl: "https://img.yyddtj.top/file/clannad.jpg"
  });
});

test("hydrates Chinese metadata with source attribution without using a portrait cover as background", () => {
  const item = normalizeGalgameWikiDetail(gameDetail);
  const patch = toMetadataPatch(item, 0.96);

  assert.equal(patch.source, "galgamewiki");
  assert.equal(patch.metadataSource, "galgamewiki");
  assert.equal(patch.metadataSourceId, "25");
  assert.equal(patch.translationStatus, "already_zh");
  assert.equal(patch.descriptionZh, item.description);
  assert.equal(patch.coverPath, item.coverUrl);
  assert.equal(patch.backgroundPath, undefined);
  assert.match(patch.descriptionSourceHash, /^[a-f0-9]{64}$/);
});

test("ranks matching index titles before applying the detail budget", async () => {
  for (const query of ["樱之诗", "大图书馆的牧羊人"]) {
    const fetched = [];
    const client = createGalgameWikiClient({ requestJson: async url => {
      if (url.includes("/wp/v2/search?")) return { status: "success", data: [
        ...Array.from({ length: 8 }, (_, i) => ({ id: i + 1, title: "无关的百科文章" })),
        { id: 90, title: `【会社】${query}` }
      ] };
      const id = Number(url.split("/").pop());
      fetched.push(id);
      return { status: "success", data: { ...gameDetail, post_id: id, title: id === 90 ? query : "无关的百科文章" } };
    } });
    const result = await client.search(query);
    assert.equal(result[0].id, "90");
    assert.ok(fetched.length <= 3);
  }
});

test("separates bilingual titles but preserves slashes inside a single-language title", () => {
  for (const title of ["大图书馆的牧羊人（大図書館の羊飼い）", "大图书馆的牧羊人/大図書館の羊飼い"]) {
    const item = normalizeGalgameWikiDetail({ title });
    assert.equal(item.title, "大图书馆的牧羊人");
    assert.equal(item.originalTitle, "大図書館の羊飼い");
  }
  assert.equal(normalizeGalgameWikiDetail({ title: "Fate/stay night" }).title, "Fate/stay night");
});

test("genre and series tags do not establish game identity", () => {
  const exact = (a, b) => a === b ? 1 : 0;
  const item = normalizeGalgameWikiDetail({ ...gameDetail, title: "其他作品", content_html: "", tags: ["CLANNAD"] });
  assert.equal(toMetadataCandidate("CLANNAD", item, exact).confidence, 0);
});

test("typographic matching cannot erase edition numbers or plus editions", () => {
  const score = (query, title) => toMetadataCandidate(query,
    normalizeGalgameWikiDetail({ title }), () => 0).confidence;
  assert.equal(score("作品2.1", "作品21"), 0);
  assert.equal(score("作品2+", "作品2"), 0);
  assert.equal(score("作品2", "作品3"), 0);
  assert.equal(score("作品２.１", "作品2.1"), 1);
});

test("subtitle fallback is retrieval only and retains the full query for ranking", async () => {
  const searches = [];
  const client = createGalgameWikiClient({ requestJson: async url => {
    if (url.includes("/wp/v2/search?")) {
      const q = new URL(url).searchParams.get("search"); searches.push(q);
      return { status: "success", data: q === "作品2" ? [{ id: 25, title: "作品2 -副标题" }] : [] };
    }
    return { status: "success", data: { ...gameDetail, title: "作品2 -副标题" } };
  } });
  assert.equal((await client.search("作品2－副标题")).length, 1);
  assert.deepEqual(searches, ["作品2－副标题", "作品2"]);
});
