const test = require("node:test");
const assert = require("node:assert/strict");

const requests = [];
const mangaId = "11111111-2222-4333-8444-555555555555";
const chapterId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const fixtures = {
  "/manga": {
    result: "ok",
    data: [
      {
        id: mangaId,
        attributes: {
          title: { en: "The Korean Test Manhwa" },
          originalLanguage: "ko",
        },
        relationships: [
          { type: "cover_art", attributes: { fileName: "cover-file" } },
        ],
      },
    ],
    total: 1,
  },
  [`/manga/${mangaId}`]: {
    result: "ok",
    data: {
      id: mangaId,
      attributes: {
        title: { en: "The Korean Test Manhwa" },
        description: { en: "A fixture description." },
        originalLanguage: "ko",
        status: "ongoing",
        year: 2025,
        tags: [{ attributes: { name: { en: "Action" } } }],
      },
      relationships: [
        { type: "author", attributes: { name: "Test Author" } },
        { type: "artist", attributes: { name: "Test Artist" } },
        { type: "cover_art", attributes: { fileName: "cover-file" } },
      ],
    },
  },
  [`/manga/${mangaId}/feed`]: {
    result: "ok",
    data: [
      {
        id: chapterId,
        attributes: { chapter: "12.5", title: "A Test Chapter" },
        relationships: [
          {
            type: "scanlation_group",
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            attributes: { name: "Example Scanlation" },
          },
        ],
      },
    ],
  },
  [`/at-home/server/${chapterId}`]: {
    result: "ok",
    baseUrl: "https://uploads.example.test",
    chapter: {
      hash: "hashvalue",
      data: ["001.jpg", "002.jpg"],
      dataSaver: ["001.jpg"],
    },
  },
};

global.axios = {
  async get(url, config) {
    const parsed = new URL(url);
    requests.push({ url: parsed, config });
    const fixture = fixtures[parsed.pathname];
    if (!fixture) throw new Error(`Unexpected request: ${parsed.pathname}`);
    return { data: fixture };
  },
};

const provider = require("../extensions/Manga/mangadexmanhwa");

test("exports the current StrawVerse runtime hooks and guide aliases", () => {
  assert.equal(provider.name, "mangadexmanhwa");
  assert.equal(provider.version, "1.0.3");

  for (const hook of [
    "latestManga",
    "searchManga",
    "fetchMangaInfo",
    "fetchChapters",
    "fetchChapterPages",
    "SearchManga",
    "MangaInfo",
    "fetchChapterImages",
  ]) {
    assert.equal(typeof provider[hook], "function", `${hook} must be a function`);
  }
});

test("latestManga returns StrawVerse paginated discovery format", async () => {
  const result = await provider.latestManga(1);
  assert.equal(result.current_page, 1);
  assert.equal(result.hasNextPage, false);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].id, `mdko-${mangaId}`);
  assert.equal(result.results[0].title, "The Korean Test Manhwa");
  assert.equal(
    result.results[0].image,
    `https://uploads.mangadex.org/covers/${mangaId}/cover-file.256.jpg`,
  );

  const request = requests.find((entry) => entry.url.pathname === "/manga");
  assert.equal(request.url.searchParams.get("originalLanguage[]"), "ko");
  assert.equal(request.url.searchParams.get("availableTranslatedLanguage[]"), "en");
  assert.equal(request.url.searchParams.get("order[latestUploadedChapter]"), "desc");
  assert.equal(request.config.headers["User-Agent"], undefined, "must not spoof MangaDex User-Agent");
  assert.equal(request.config.headers.Referer, undefined, "API requests must not send a forced Referer");
});

test("searchManga returns paginated results and uses the query", async () => {
  const result = await provider.searchManga("Korean Test", 1);
  assert.equal(result.results.length, 1);
  assert.equal(result.current_page, 1);
  assert.equal(result.results[0].title, "The Korean Test Manhwa");
  const request = requests.filter((entry) => entry.url.pathname === "/manga").at(-1);
  assert.equal(request.url.searchParams.get("title"), "Korean Test");
});

test("fetchMangaInfo returns standard metadata and identifies the title as Manhwa", async () => {
  const info = await provider.fetchMangaInfo(`mdko-${mangaId}`);
  assert.equal(info.id, `mdko-${mangaId}`);
  assert.equal(info.title, "The Korean Test Manhwa");
  assert.equal(info.type, "Manhwa");
  assert.equal(info.author, "Test Author");
  assert.equal(info.artist, "Test Artist");
  assert.deepEqual(info.genres, ["Action"]);
  assert.equal(info.status, "Ongoing");
  assert.equal(info.year, 2025);
});

test("fetchChapters returns StrawVerse chapter-list structure and scanlation credit", async () => {
  const result = await provider.fetchChapters(`mdko-${mangaId}`);
  assert.equal(result.TotalPages, 1);
  assert.equal(result.total, 1);
  assert.equal(result.Chapters[0].id, `mdko-ch-${chapterId}`);
  assert.equal(result.Chapters[0].number, 12.5);
  assert.match(result.Chapters[0].title, /Example Scanlation/);
});

test("fetchChapterPages returns StrawVerse img page objects", async () => {
  const pages = await provider.fetchChapterPages(`mdko-ch-${chapterId}`);
  assert.deepEqual(pages, [
    { page: 1, img: "https://uploads.example.test/data/hashvalue/001.jpg" },
    { page: 2, img: "https://uploads.example.test/data/hashvalue/002.jpg" },
  ]);
});

test("capitalized developer-guide aliases remain available", async () => {
  const results = await provider.SearchManga("Korean Test");
  assert.equal(Array.isArray(results), true);
  assert.equal(results[0].title, "The Korean Test Manhwa");

  const info = await provider.MangaInfo(`mdko-${mangaId}`);
  assert.equal(info.type, "Manhwa");
  assert.equal(info.chapters.length, 1);

  const pages = await provider.fetchChapterImages(`mdko-ch-${chapterId}`);
  assert.equal(pages[0].url, "https://uploads.example.test/data/hashvalue/001.jpg");
});


test("HTTP failures report the MangaDex status, API detail, and retry hint", async () => {
  const originalAxios = global.axios;
  global.axios = {
    async get() {
      const error = new Error("Request failed with status code 403");
      error.response = {
        status: 403,
        data: { errors: [{ detail: "Access temporarily denied." }] },
        headers: { "retry-after": "30" },
      };
      throw error;
    },
  };
  try {
    await assert.rejects(
      provider.searchManga("diagnostic-only-query", 1),
      /MangaDex API returned HTTP 403 for \/manga.*Access temporarily denied.*Retry-After: 30/,
    );
  } finally {
    global.axios = originalAxios;
  }
});
