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
