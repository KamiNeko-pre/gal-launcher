# Contributing

Thanks for improving Gal Launcher.

## Development

```bash
npm install
npm run dev
```

Before submitting changes:

```bash
npm run build
```

## Guidelines

- Keep the app local-first.
- Do not add game downloads or links to pirated content.
- Do not commit third-party artwork, screenshots, or user cache files.
- Prefer official APIs for metadata sources.
- Keep network requests conservative and cancellable.
- Preserve Windows support unless the change explicitly targets another platform.

## Metadata Providers

When adding a source:

- Document it in `docs/DATA_SOURCES.md`.
- Add clear source attribution in the UI.
- Avoid automatic bulk crawling.
- Prefer candidate selection over automatic replacement.
