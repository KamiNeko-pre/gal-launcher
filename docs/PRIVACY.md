# Privacy

Gal Launcher is a local-first desktop launcher.

## Stored Locally

The app stores the following on your machine:

- Game title and metadata
- Launch file paths and working directories
- Cover/background cache
- Play count and play time
- Metadata/search cache
- Backup files you export manually

Typical Windows location:

```text
%APPDATA%\gal-launcher\library
```

## Network Requests

The app may contact third-party services when you use features such as:

- Search metadata
- Find cover/background candidates
- Lookup Bangumi rating
- Download a selected image candidate

Search queries may include game titles, folder names, or names you type manually. Local absolute paths are not intentionally sent as search queries, but users should still avoid typing private information into search fields.

## What Is Not Included

The project does not include:

- Game files
- DRM bypass tools
- Built-in game downloads
- A cloud account system
- Telemetry or analytics

## Backups

Exported backups may contain absolute local paths and cached metadata. Treat backup files as private unless you manually sanitize them.
