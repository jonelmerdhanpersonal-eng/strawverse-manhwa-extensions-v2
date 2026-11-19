# StrawVerse Manhwa Extensions

A separate community extension repository for StrawVerse. Its first provider is **MangaDex Manhwa**, which searches Korean-origin titles through the MangaDex public API and returns English chapter pages where available.

## Provider

| Provider | Source | Coverage | Version |
| --- | --- | --- | --- |
| MangaDex Manhwa (`mangadexmanhwa`) | MangaDex public API | Korean-origin titles (`originalLanguage=ko`) with English chapters available | 1.0.2 |

## Compatibility

Version 1.0.2 exports the lower-camel hooks used by StrawVerse's current built-in Manga providers:

- `latestManga(page, filters)`
- `searchManga(query, page, filters)`
- `fetchMangaInfo(id)`
- `fetchChapters(id)`
- `fetchChapterPages(chapterId)`

It also exports the capitalized aliases shown in StrawVerse's public developer guide:

- `SearchManga(query)`
- `MangaInfo(id)`
- `fetchChapterImages(chapterId)`

This dual interface prevents the `latestManga is not a function` runtime failure seen with the previous 1.0.1 package and maintains compatibility with the public guide examples.

## Install in StrawVerse

1. Publish this folder as a public GitHub repository.
2. Open StrawVerse → **Extensions** → **+ Add Repo**.
3. Paste the GitHub repository URL or its direct `marketplace.json` URL.
4. Under Manga, install `mangadexmanhwa`.
5. To update an existing installation, publish the new files with the version increased to `1.0.2`, then use StrawVerse's update/refresh action. If the app keeps using cached code, uninstall the old scraper and reinstall it from the repository.

Direct manifest URL format:

```text
https://raw.githubusercontent.com/<YOUR_GITHUB_USERNAME>/<YOUR_REPOSITORY>/main/marketplace.json
```

## Features

- Search and browse Korean-origin MangaDex titles.
- Restrict results to titles with English-translated chapters available.
- Paginated latest and title-search results.
- Title covers, descriptions, status, year, genres, authors, and artists.
- English chapter lists with scanlation-group credit when supplied by MangaDex.
- Chapter page URLs from MangaDex's official `at-home` endpoint.
- Original images preferred, with data-saver images as fallback.
- Five-minute in-memory response caches for browsing and metadata calls.

The provider does not host, mirror, package, or redistribute image files. It requests current image URLs from MangaDex at runtime. It does not attempt to access member-only, paid, or otherwise restricted chapters.

## MangaDex attribution and usage conditions

MangaDex's API acceptable-use requirements apply. Review the current API documentation and acceptable-use policy before using or distributing this extension:

- https://api.mangadex.org/docs/
- https://api.mangadex.org/docs/redoc.html#section/Acceptable-use-policy

In particular, applications using MangaDex API content must credit MangaDex and scanlation groups where applicable, honor scanlation-group content-removal requests, and must not monetize MangaDex API access with ads or paid services. Chapter labels include scanlation-group attribution when available. If a group requests removal, add its UUID to `REMOVED_SCANLATION_GROUP_IDS` in `extensions/Manga/mangadexmanhwa.js`, increment the extension version in both `marketplace.json` and the JS file, and publish the update.

## Repository layout

```text
strawverse-manhwa-extensions/
├── marketplace.json
├── extensions/Manga/mangadexmanhwa.js
├── ico/mangadexmanhwa.ico
├── ico/mangadexmanhwa.png
├── tests/mangadexmanhwa.test.js
├── DISCLAIMER.md
├── LICENSE
├── package.json
└── README.md
```

## Local checks

Requires Node.js 18 or later. Tests use a mocked HTTP client and do not access or store live manga pages.

```bash
npm test
```
