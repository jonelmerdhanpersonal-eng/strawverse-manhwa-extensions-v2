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
          { type: "scanlation_group", attributes: { name: "Example Scanlation" } },
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

test("exports the exact StrawVerse Manga extension hooks", () => {
  assert.equal(provider.name, "mangadexmanhwa");
  assert.equal(provider.version, "1.0.1");
  assert.equal(typeof provider.SearchManga, "function");
  assert.equal(typeof provider.MangaInfo, "function");
  assert.equal(typeof provider.fetchChapterImages, "function");
});

test("SearchManga returns the expected result array and Korean/English filters", async () => {
  const results = await provider.SearchManga("Korean Test");
  assert.equal(Array.isArray(results), true);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, `mdko-${mangaId}`);
  assert.equal(results[0].title, "The Korean Test Manhwa");
  assert.equal(
    results[0].image,
    `https://uploads.mangadex.org/covers/${mangaId}/cover-file.256.jpg`,
  );

  const request = requests.find((entry) => entry.url.pathname === "/manga");
  assert.equal(request.url.searchParams.get("originalLanguage[]"), "ko");
  assert.equal(request.url.searchParams.get("availableTranslatedLanguage[]"), "en");
});

test("MangaInfo returns standard StrawVerse metadata and a chapter array", async () => {
  const info = await provider.MangaInfo(`mdko-${mangaId}`);
  assert.equal(info.id, `mdko-${mangaId}`);
  assert.equal(info.title, "The Korean Test Manhwa");
  assert.equal(info.type, "Manhwa");
  assert.equal(info.studio, "Test Author, Test Artist");
  assert.deepEqual(info.genres, ["Action"]);
  assert.equal(info.status, "Ongoing");
  assert.equal(info.chapters.length, 1);
  assert.equal(info.chapters[0].id, `mdko-ch-${chapterId}`);
  assert.equal(info.chapters[0].chapter, 12.5);
  assert.match(info.chapters[0].title, /Example Scanlation/);
});

test("fetchChapterImages returns reader pages using the documented url field", async () => {
  const pages = await provider.fetchChapterImages(`mdko-ch-${chapterId}`);
  assert.deepEqual(pages, [
    {
      page: 1,
      url: "https://uploads.example.test/data/hashvalue/001.jpg",
    },
    {
      page: 2,
      url: "https://uploads.example.test/data/hashvalue/002.jpg",
    },
  ]);
});
