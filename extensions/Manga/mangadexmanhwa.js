/**
 * StrawVerse community Manga extension: MangaDex Korean-origin Manhwa.
 *
 * The current StrawVerse runtime uses the lower-camel hooks exported below:
 *   latestManga, searchManga, fetchMangaInfo, fetchChapters, fetchChapterPages
 *
 * The capitalized aliases at the bottom are also provided for compatibility
 * with the public developer-guide examples:
 *   SearchManga, MangaInfo, fetchChapterImages
 *
 * Uses MangaDex's public API. This extension does not host, mirror, or package
 * image files. Review MangaDex's current API acceptable-use policy before use.
 */
const name = "mangadexmanhwa";
const version = "1.0.3";
const baseUrl = "https://api.mangadex.org";
const pageSize = 20;
const chapterPageSize = 500;
const allowedContentRatings = ["safe", "suggestive"];
const allowedTranslatedLanguages = ["en"];

// Add MangaDex scanlation-group UUIDs here if a group requests content removal.
const REMOVED_SCANLATION_GROUP_IDS = new Set([]);
const CACHE_TTL_MS = 5 * 60 * 1000;
const searchCache = new Map();
const infoCache = new Map();
const chapterCache = new Map();
const chapterPageCache = new Map();

function cacheGet(cache, key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(cache, key, value) {
  cache.set(key, { createdAt: Date.now(), value });
  return value;
}

function getAxios() {
  const client = global.axios || require("axios");
  if (!client || typeof client.get !== "function") {
    throw new Error("StrawVerse HTTP client is unavailable.");
  }
  return client;
}

async function getJson(path, params) {
  const query = params ? params.toString() : "";
  const url = `${baseUrl}${path}${query ? `?${query}` : ""}`;
  try {
    // Let StrawVerse's native Axios/Node transport provide its real User-Agent.
    // MangaDex requires a genuine, non-spoofed User-Agent; do not override it.
    const response = await getAxios().get(url, {
      headers: { Accept: "application/json" },
      timeout: 20000,
    });
    return response?.data;
  } catch (error) {
    const status = error?.response?.status;
    const apiErrors = error?.response?.data?.errors;
    const detail = Array.isArray(apiErrors)
      ? apiErrors.map((item) => item?.detail || item?.title).filter(Boolean).join("; ")
      : "";
    const retryAfter = error?.response?.headers?.["retry-after"];
    if (status) {
      const retryHint = retryAfter ? ` Retry-After: ${retryAfter}.` : "";
      throw new Error(
        `MangaDex API returned HTTP ${status} for ${path}.${detail ? ` ${detail}` : ""}${retryHint}`,
      );
    }
    throw new Error(`MangaDex API request failed for ${path}: ${error?.message || "Unknown network error"}`);
  }
}

function addRepeated(params, key, values) {
  for (const value of values) params.append(key, String(value));
}

function getPage(page) {
  const parsed = Number.parseInt(page, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function getTitle(attributes) {
  const titles = attributes?.title || {};
  return (
    titles.en ||
    titles["en-us"] ||
    titles["en-gb"] ||
    Object.values(titles)[0] ||
    "Untitled Manhwa"
  );
}

function getDescription(attributes) {
  const descriptions = attributes?.description || {};
  return descriptions.en || Object.values(descriptions)[0] || "";
}

function getCoverUrl(mangaId, relationships, thumbnail = true) {
  const cover = (relationships || []).find((item) => item.type === "cover_art");
  const fileName = cover?.attributes?.fileName;
  if (!fileName) return "";
  const suffix = thumbnail ? ".256.jpg" : "";
  return `https://uploads.mangadex.org/covers/${mangaId}/${encodeURIComponent(fileName)}${suffix}`;
}

function getPeople(relationships, type) {
  const people = (relationships || [])
    .filter((item) => item.type === type)
    .map((item) => item.attributes?.name)
    .filter(Boolean);
  return [...new Set(people)].join(", ");
}

function getGenres(attributes) {
  return [...new Set(
    (attributes?.tags || [])
      .map((tag) => tag.attributes?.name?.en)
      .filter(Boolean),
  )];
}

function normaliseStatus(status) {
  const value = String(status || "ongoing").toLowerCase();
  if (value === "completed") return "Completed";
  if (value === "hiatus" || value === "cancelled") return "Ongoing";
  return "Ongoing";
}

function unwrapMangaId(mangaId) {
  return String(mangaId || "").replace(/^mdko-/, "");
}

function unwrapChapterId(chapterId) {
  return String(chapterId || "").replace(/^mdko-ch-/, "");
}

function buildSearchParams(page, query = "", filters = {}) {
  const safePage = getPage(page);
  const params = new URLSearchParams();
  params.set("limit", String(pageSize));
  params.set("offset", String((safePage - 1) * pageSize));
  params.set("originalLanguage[]", "ko");
  params.set("hasAvailableChapters", "true");
  params.set("availableTranslatedLanguage[]", "en");
  addRepeated(params, "contentRating[]", allowedContentRatings);
  addRepeated(params, "includes[]", ["cover_art", "author", "artist"]);
  if (query) params.set("title", query);

  const status = String(filters?.status || "").trim().toLowerCase();
  if (["ongoing", "completed", "hiatus", "cancelled"].includes(status)) {
    params.append("status[]", status);
  }

  const sort = String(filters?.sort || "").trim().toLowerCase();
  if (sort === "most-followed") {
    params.set("order[followedCount]", "desc");
  } else if (sort === "rating") {
    params.set("order[rating]", "desc");
  } else if (sort === "title-az") {
    params.set("order[title]", "asc");
  } else if (query) {
    params.set("order[relevance]", "desc");
  } else {
    params.set("order[latestUploadedChapter]", "desc");
  }
  return params;
}

function mapMangaResults(data) {
  return (data?.data || []).map((manga) => ({
    id: `mdko-${manga.id}`,
    title: getTitle(manga.attributes),
    image: getCoverUrl(manga.id, manga.relationships, true),
  }));
}

async function fetchMangaPage(query = "", page = 1, filters = {}) {
  const safeQuery = String(query || "").trim();
  const safePage = getPage(page);
  const cacheKey = JSON.stringify({ query: safeQuery, page: safePage, filters });
  const cached = cacheGet(searchCache, cacheKey);
  if (cached) return cached;

  const params = buildSearchParams(safePage, safeQuery, filters);
  const data = await getJson("/manga", params);
  const results = mapMangaResults(data);
  const total = Number(data?.total || 0);

  return cacheSet(searchCache, cacheKey, {
    current_page: safePage,
    hasNextPage: safePage * pageSize < total,
    results,
  });
}

/** Current StrawVerse runtime hook: browse recently updated titles. */
async function latestManga(page = 1, filters = {}) {
  return fetchMangaPage("", page, filters);
}

/** Current StrawVerse runtime hook: search titles by name. */
async function searchManga(query, page = 1, filters = {}) {
  if (!String(query || "").trim()) return latestManga(page, filters);
  return fetchMangaPage(query, page, filters);
}

function getScanlationGroup(chapter) {
  const group = (chapter?.relationships || []).find(
    (relationship) => relationship.type === "scanlation_group",
  );
  return {
    id: group?.id || "",
    name: group?.attributes?.name || "",
  };
}

/** Retrieve English chapters and preserve group credit in the chapter label. */
async function fetchChapters(mangaId) {
  const id = unwrapMangaId(mangaId);
  if (!id) return { TotalPages: 0, total: 0, Chapters: [] };

  const cached = cacheGet(chapterCache, id);
  if (cached) return cached;

  const params = new URLSearchParams();
  params.set("limit", String(chapterPageSize));
  params.set("offset", "0");
  params.set("order[chapter]", "desc");
  params.set("includeFuturePublishAt", "0");
  addRepeated(params, "translatedLanguage[]", allowedTranslatedLanguages);
  addRepeated(params, "contentRating[]", allowedContentRatings);
  params.append("includes[]", "scanlation_group");

  const data = await getJson(`/manga/${encodeURIComponent(id)}/feed`, params);
  const chapters = (data?.data || []).reduce((items, chapter) => {
    const group = getScanlationGroup(chapter);
    if (group.id && REMOVED_SCANLATION_GROUP_IDS.has(group.id)) return items;

    const attributes = chapter.attributes || {};
    const rawNumber = attributes.chapter;
    const number = rawNumber !== null && rawNumber !== undefined
      ? (Number.parseFloat(rawNumber) || 0)
      : 0;
    const chapterTitle = attributes.title || (number ? `Chapter ${number}` : "Chapter");
    const groupCredit = group.name
      ? `Scanlation group: ${group.name}`
      : "Scanlation group: not listed";

    items.push({
      id: `mdko-ch-${chapter.id}`,
      number,
      title: `${chapterTitle} · ${groupCredit}`,
      group: group.name,
    });
    return items;
  }, []);

  return cacheSet(chapterCache, id, {
    TotalPages: 1,
    total: chapters.length,
    Chapters: chapters,
  });
}

/** Current StrawVerse runtime hook: fetch a title's metadata. */
async function fetchMangaInfo(mangaId) {
  const id = unwrapMangaId(mangaId);
  if (!id) throw new Error("A MangaDex manga ID is required.");

  const cached = cacheGet(infoCache, id);
  if (cached) return cached;

  const params = new URLSearchParams();
  addRepeated(params, "includes[]", ["cover_art", "author", "artist"]);
  const data = await getJson(`/manga/${encodeURIComponent(id)}`, params);
  const manga = data?.data;
  if (!manga?.id || !manga.attributes) {
    throw new Error("MangaDex did not return manga details for this title.");
  }

  const attributes = manga.attributes;
  const info = {
    id: `mdko-${manga.id}`,
    title: getTitle(attributes),
    image: getCoverUrl(manga.id, manga.relationships, false),
    type: attributes.originalLanguage === "ko" ? "Manhwa" : "Manga",
    description: getDescription(attributes),
    genres: getGenres(attributes),
    author: getPeople(manga.relationships, "author"),
    artist: getPeople(manga.relationships, "artist"),
    released: attributes.year ? String(attributes.year) : "",
    year: attributes.year ? Number(attributes.year) : null,
    status: normaliseStatus(attributes.status),
  };
  return cacheSet(infoCache, id, info);
}

/** Current StrawVerse runtime hook: fetch image URLs for one chapter. */
async function fetchChapterPages(chapterId) {
  const id = unwrapChapterId(chapterId);
  if (!id) return [];

  const cached = cacheGet(chapterPageCache, id);
  if (cached) return cached;

  const data = await getJson(`/at-home/server/${encodeURIComponent(id)}`);
  const chapter = data?.chapter;
  const serverBase = String(data?.baseUrl || "").replace(/\/$/, "");
  const hash = chapter?.hash;
  const originalFiles = Array.isArray(chapter?.data) ? chapter.data : [];
  const saverFiles = Array.isArray(chapter?.dataSaver) ? chapter.dataSaver : [];
  const useOriginal = originalFiles.length > 0;
  const files = useOriginal ? originalFiles : saverFiles;
  const qualityPath = useOriginal ? "data" : "data-saver";

  if (!serverBase || !hash || files.length === 0) return [];

  const pages = files.map((file, index) => ({
    page: index + 1,
    img: `${serverBase}/${qualityPath}/${encodeURIComponent(hash)}/${encodeURIComponent(file)}`,
  }));
  return cacheSet(chapterPageCache, id, pages);
}

// Compatibility aliases for the public developer-guide examples.
async function SearchManga(query) {
  const result = await searchManga(query, 1);
  return result.results;
}

async function MangaInfo(mangaId) {
  const [info, chapterData] = await Promise.all([
    fetchMangaInfo(mangaId),
    fetchChapters(mangaId),
  ]);
  return {
    ...info,
    chapters: chapterData.Chapters.map((chapter) => ({
      id: chapter.id,
      chapter: chapter.number,
      title: chapter.title,
    })),
  };
}

async function fetchChapterImages(chapterId) {
  const pages = await fetchChapterPages(chapterId);
  return pages.map((page) => ({
    page: page.page,
    url: page.img,
  }));
}

module.exports = {
  name,
  version,
  baseUrl,
  // Cover CDN may require a MangaDex Referer. Do not inject a Referer into
  // API requests; search/detail/feed requests are server-to-server JSON calls.
  headerRules: [
    {
      match: ["uploads.mangadex.org"],
      headers: { Referer: "https://mangadex.org/" },
    },
  ],
  // Current StrawVerse runtime hooks (match its official Manga providers).
  latestManga,
  searchManga,
  fetchMangaInfo,
  fetchChapters,
  fetchChapterPages,
  // Developer-guide compatibility hooks.
  SearchManga,
  MangaInfo,
  fetchChapterImages,
};
