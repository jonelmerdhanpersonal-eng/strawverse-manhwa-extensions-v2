# StrawVerse Manhwa Extensions

A small, independent extension repository for **StrawVerse**. The first provider is **MangaDex Manhwa**, which searches Korean-origin titles through the public MangaDex API and returns English chapter pages where available.

This repository is designed for StrawVerse's existing **Add Repo** workflow. It does not require changes to StrawVerse itself.

## Included provider

| Provider | Source | Coverage | Version |
| --- | --- | --- | --- |
| MangaDex Manhwa (`mangadexmanhwa`) | MangaDex public API | Korean-origin titles (`originalLanguage=ko`) with English chapters available | 1.0.1 |

The provider uses the official StrawVerse Manga extension interface (`SearchManga`, `MangaInfo`, and `fetchChapterImages`). The title metadata is labeled `Manhwa` when MangaDex reports Korean as its original language.

## Install in StrawVerse

1. Publish this folder as a public GitHub repository.
2. Open StrawVerse and go to **Extensions**.
3. Select **+ Add Repo**.
4. Paste either the GitHub repository URL or the direct URL to this repository's `marketplace.json`.
5. Find **mangadexmanhwa** in the Manga extension list and click **Install Scraper**.

Direct manifest URL format:

```text
https://raw.githubusercontent.com/<YOUR_GITHUB_USERNAME>/<YOUR_REPOSITORY>/main/marketplace.json
```

Replace the placeholders with the GitHub account and repository name you choose.

## What it supports

- Search Korean-origin manhwa by title.
- Browse recently updated Korean-origin titles.
- Filter by status, sort order, and MangaDex genres when StrawVerse supplies those filters.
- Fetch title metadata, cover art, genres, authors/artists, and English chapter lists.
- Fetch chapter page URLs through MangaDex's official `at-home` endpoint.
- Prefer original-quality pages, with data-saver pages as a fallback.
- Include the scanlation-group name in the chapter label when MangaDex provides it.
- Exclude chapters from group UUIDs added to `REMOVED_SCANLATION_GROUP_IDS` after a valid removal request.

The source is intentionally restricted to MangaDex's `ko` original-language catalogue and English-translated chapters. It does not attempt to access member-only, paid, or otherwise restricted chapters.

## MangaDex attribution and usage conditions

This provider uses the MangaDex public API. MangaDex's published acceptable-use policy requires applications that use its API to:

- Credit MangaDex.
- Credit scanlation groups when offering chapter reading, and honor scanlation-group content-removal requests.
- Not run ads or paid services on applications using MangaDex API content.

Chapter labels include the scanlation-group name when MangaDex exposes it in the chapter metadata. The provider does not host, mirror, package, or redistribute image files; it asks MangaDex for the chapter's current image URLs at runtime.

Before using or distributing this extension, review MangaDex's current API documentation and acceptable-use policy:

- https://api.mangadex.org/docs/
- https://api.mangadex.org/docs/redoc.html#section/Acceptable-use-policy

Only access and retain content you are authorized to use. A public API response does not itself establish that every work is licensed for every downstream use. If a scanlation group or rights holder requests removal, the repository maintainer must promptly add the affected scanlation-group UUID to `REMOVED_SCANLATION_GROUP_IDS` in `extensions/Manga/mangadexmanhwa.js`, increment the provider version in both `marketplace.json` and the extension file, and publish the update.

## Repository layout

```text
strawverse-manhwa-extensions/
├── marketplace.json
├── extensions/
│   └── Manga/
│       └── mangadexmanhwa.js
├── ico/
│   └── mangadexmanhwa.ico
├── tests/
│   └── mangadexmanhwa.test.js
├── DISCLAIMER.md
├── LICENSE
├── package.json
└── README.md
```

## Local validation

Requires Node.js 18 or later. No npm dependencies are required for the included mock tests.

```bash
npm test
```

The tests use a mocked HTTP client and do not fetch or store manga pages.

## Compatibility

The manifest declares `MinAppVersion: 11.1.0`. The provider exports the exact Manga hooks documented in the StrawVerse extension developer guide. If StrawVerse changes its scraper interface, update the provider and compatibility version together.
