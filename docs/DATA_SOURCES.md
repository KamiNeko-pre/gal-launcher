# Data Sources

Gal Launcher can search third-party sources to help users fill metadata and find cover/background candidates. These integrations should be treated as optional helpers, not as bundled content.

## Principles

- Prefer official APIs over webpage scraping.
- Keep request rates conservative.
- Cache only what the local user selects or needs.
- Show the source of each candidate.
- Let users manually choose the correct image.
- Do not commit or redistribute downloaded images, screenshots, descriptions, or local caches.
- Disable a source if it becomes unreliable or if its rules disallow this use.

## Current Source Types

### VNDB

Used for visual novel metadata, covers, and screenshots.

Recommended handling:

- Use the official API where possible.
- Respect VNDB API usage limits and data license requirements.
- Store only local user cache.
- Attribute candidates as VNDB.

### Steam

Used as a high-priority source for games that have Steam pages, especially library hero images and capsules.

Recommended handling:

- Use public Steam endpoints conservatively.
- Do not imply endorsement by Valve or Steam.
- Do not bundle Steam-hosted artwork in the repository.

### Bangumi

Used for subject search and rating lookup.

Recommended handling:

- Prefer API responses where possible.
- Keep webpage fallback conservative.
- Attribute ratings as Bangumi.

### GalgameWiki

Used as an independent Chinese metadata source for game titles, studios, release dates, descriptions, tags, and portrait covers.

Recommended handling:

- Use the public WordPress search index only to locate post IDs, then load details through the site's read-only `galgame-launcher/v1/games/{id}` endpoint.
- Accept only entries whose detail categories explicitly include `游戏`; articles, tools, and general wiki pages must not become game candidates.
- Use it only after VNDB returns no reliable candidate, before the Bangumi fallback. This prevents a community lookup from delaying a successful VNDB search or winning an equal-score automatic match.
  - Rank up to 30 lightweight index titles before requesting at most three details (two in flight). If the full-title index is empty, allow one main-title query, but score results against the complete original title, including edition numbers. Cache the same normalized title locally for five minutes.
- Let VNDB/Bangumi continue when GalgameWiki is unavailable.
- Treat returned HTML as untrusted input: extract plain text only and never execute or render embedded markup.
- Attribute every candidate and saved record as GalgameWiki.
- Cache selected cover images only for the local user. The site's text license does not automatically establish redistribution rights for externally hosted images.

### Community/Index Sites

Some sites may provide article pages with images and summaries. These are higher risk than official APIs.

Recommended handling:

- Keep them optional.
- Avoid background bulk crawling.
- Limit request count and concurrency.
- Display candidates for manual selection rather than applying automatically.
- Remove or disable a provider if requested by the site owner.

## Legal And Copyright Notes

This document is not legal advice. In general:

- Game covers, screenshots, logos, and descriptions are copyrighted or trademarked by their respective owners.
- Local personal caching is different from redistribution.
- Do not upload downloaded artwork or metadata caches to GitHub.
- Do not package third-party artwork inside releases unless you have permission.

## Recommended Future Refactor

The source lookup code should eventually be split into provider modules:

```text
metadata-providers/
  vndb.ts
  steam.ts
  bangumi.ts
  community-example.ts
```

Each provider should declare:

- `id`
- `displayName`
- `defaultEnabled`
- `sourceType`
- `rateLimit`
- `searchMetadata()`
- `searchImages()`
- `attribution`

This makes source behavior auditable and easier to disable.
