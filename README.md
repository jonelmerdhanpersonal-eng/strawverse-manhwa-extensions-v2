# StrawVerse Manhwa Extensions — MangaDex Manhwa 1.0.5

A community Manga extension for StrawVerse that searches Korean-origin MangaDex titles and returns English chapter listings when available.

## What changed in 1.0.5

- Reworked catalog requests to follow the current official MangaFire MangaDex scraper pattern: `global.axios.get()`, a 30-title page, and `cover_art` expansion for catalog results.
- Preserved Manhwa filtering (`originalLanguage[]=ko`) and English-translation filtering (`availableTranslatedLanguage[]=en`).
- Removed the redundant `hasAvailableChapters` query parameter and the extra author/artist expansions from catalog search requests.
- Added a serialized request queue (one request at a time, at least 350 ms apart) to reduce bursts against MangaDex.
- Added two-minute response caching and identical in-flight request deduplication.
- Added clearer 403/429 error text and Retry-After header reporting. The extension never automatically retries a denied request.
- Kept the current StrawVerse runtime hooks and the public developer-guide aliases.

## Repository layout

```text
marketplace.json
extensions/
  Manga/
    mangadexmanhwa.js
ico/
  mangadexmanhwa.ico
README.md
DISCLAIMER.md
LICENSE
package.json
tests/
  mangadexmanhwa.test.js
```

## Install/update

1. Upload the contents of this repository (not the containing folder) to the root of your public GitHub repository.
2. Confirm `marketplace.json` is at the repository root and reports version `1.0.5`.
3. In StrawVerse, refresh the repository and update `mangadexmanhwa`. If the app keeps the old module cached, uninstall the scraper, restart StrawVerse, then install it again.
4. Test Discover/search after the update.

## Compatibility

The runtime hooks match the current official MangaFire provider:

- `latestManga(page, filters)`
- `searchManga(query, page, filters)`
- `fetchMangaInfo(id)`
- `fetchChapters(id)`
- `fetchChapterPages(chapterId)`

It also exports the public developer-guide hooks:

- `SearchManga(query)`
- `MangaInfo(id)`
- `fetchChapterImages(chapterId)`

## HTTP 403 and rate limits

MangaDex applies IP-based API rate limits. If MangaDex temporarily blocks the public IP due to excessive requests, changing the extension code cannot remove that block. Stop retrying, wait for the block/rate-limit window to clear, and test once. This version deliberately does not retry 403 or 429 responses.

The extension uses StrawVerse's shared `global.axios` client, exactly like the official MangaFire scraper. It does not set a custom User-Agent or Referer on API requests. A Referer rule is declared only for the cover-image host.

## MangaDex requirements

MangaDex requires credit to MangaDex and scanlation groups when chapters are made available. Respect content removal requests and review MangaDex's current acceptable-use policy before distributing or using this extension. Do not add advertising or paid access to MangaDex-provided content.

## Tests

Run:

```bash
npm test
```

Tests use mocked MangaDex responses. They validate the extension contract and mapping logic; they do not claim to verify live MangaDex availability from your network or StrawVerse installation.
