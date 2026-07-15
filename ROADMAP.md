# Roadmap

Gal Launcher is still young. The goal is to become a polished local launcher for visual novels and galgames.

## Near Term

- [x] Fix proxy-aware metadata requests and retriable Bangumi / translation states
- [x] Remove full-library Base64 image residency and establish startup / memory budgets
- [ ] Make metadata providers configurable in the UI
- [ ] Improve VNDB / Bangumi matching accuracy
- [ ] Add provider attribution beside every metadata candidate
- [ ] Add a cleaner first-run guide for empty libraries
- [ ] Improve error messages for failed metadata and cover searches
- [ ] Add screenshots and GIFs to the README

## Library Experience

- [ ] Batch folder scan with a review queue, duplicate warnings, and cancellable metadata matching
- [ ] Custom collections
- [ ] Batch collection and metadata actions
- [ ] Favorite / pinned games
- [ ] More sorting modes: title, last played, play time, release date
- [ ] Tag filtering
- [ ] Manual play time editing
- [ ] Better duplicate detection when adding games

## Metadata And Covers

- [ ] Provider settings: enable/disable VNDB, Steam, Bangumi, community sources
- [ ] Request throttling and clearer cache controls
- [ ] Better support for Chinese/Japanese/English title aliases
- [ ] Persist source IDs, field provenance, confidence, and manual VNDB / Bangumi binding
- [ ] User-controlled cover/background replacement history

## Optional Integrations

- [x] User-configured launch presets for Magpie; validate Magpie 0.12.1 locally with `E:\magpie\Magpie.exe` without hard-coding that path for releases
- [ ] User-configured launch presets for Locale Emulator and external translators
- [ ] Save-folder shortcuts and manual local backup / restore
- [ ] Local play-statistics cards generated on demand
- [ ] Importers for selected LunaBox, PotatoVN, Playnite, or Vnite exports when there is user demand

## Platform

- [ ] Signed Windows release
- [ ] Portable release polish
- [ ] Optional installer build
- [ ] Investigate Linux support

## Not Planned

- Bundling games
- Downloading game files
- DRM bypassing
- Cloud sync by default
- A plugin marketplace, account system, or always-on online backend in the near term
- Bundling OCR, Hook, or large-model translation engines when external-tool integration is sufficient
