/**
 * StrawVerse community Manga extension: MangaDex Korean-origin Manhwa.
 *
 * Runtime hooks match the current official MangaDex-backed MangaFire
 * extension in TheYogMehta/extensions:
 *   latestManga, searchManga, fetchMangaInfo, fetchChapters,
 *   fetchChapterPages.
 *
 * Also exports the capitalized methods in the public developer guide:
 *   SearchManga, MangaInfo, fetchChapterImages.
 *
 * MangaDex usage requirements:
 * - Credit MangaDex and scanlation groups when showing chapter content.
 * - Respect content removal requests and MangaDex's acceptable-use policy.
 * - Do not repeatedly retry a 403/429 response.
 */

const name = "mangadexmanhwa";
const version = "1.0.5";
const baseUrl = "https://api.mangadex.org";
const PAGE_SIZE = 30; // Same page size as the official MangaFire extension.
const FEED_PAGE_SIZE = 500; // MangaDex feed endpoint supports up to 500.
const CONTENT_RATINGS = ["safe", "suggestive"];
const TRANSLATED_LANGUAGES = ["en"];
const CACHE_TTL_MS = 2 * 60 * 1000;
const MIN_REQUEST_INTERVAL_MS = 350; // Stay comfortably below the global API limit.

const responseCache = new Map();
const inFlightRequests = new Map();
let requestQueue = Promise.resolve();
let nextRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cacheGet(key) {
  const entry = responseCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    responseCache.delete(key);
    return undefined;
  }
  return entry.data;
}

function cacheSet(key, data) {
  responseCache.set(key, { createdAt: Date.now(), data });
  return data;
}

function getRetryHint(headers = {}) {
  const raw = headers["x-ratelimit-retry-after"] || headers["retry-after"];
  if (!raw) return "";
  const value = String(raw).trim();
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    // MangaDex's X-RateLimit-Retry-After is commonly an epoch timestamp.
    if (numeric > 1_000_000_000) {
      const seconds = Math.max(0, Math.ceil(numeric - Date.now() / 1000));
      return seconds ? ` Retry after approximately ${seconds} seconds.` : " Retry window has elapsed.";
    }
    return ` Retry after ${Math.max(1, Math.ceil(numeric))} seconds.`;
  }
  return ` Retry after: ${value}.`;
}

function describeApiError(error, path) {
  const status = error?.response?.status;
  const body = error?.response?.data;
  const headers = error?.response?.headers || {};
  let detail = "";

  if (Array.isArray(body?.errors)) {
    detail = body.errors
      .map((item) => item?.detail || item?.title)
      .filter(Boolean)
      .join("; ");
  } else if (typeof body === "string") {
    detail = body.replace(/\s+/g, " ").trim().slice(0, 180);
  }

  if (status) {
    const retryHint = getRetryHint(headers);
    const rateLimitHint = status === 429
      ? " MangaDex rate limit reached; the extension will not retry automatically."
      : status === 403
        ? " MangaDex refused this request. If the response indicates a temporary IP ban, stop requests and allow the block to expire before testing again."
        : "";
    return `MangaDex API returned HTTP ${status} for ${path}.${detail ? ` ${detail}` : ""}${retryHint}${rateLimitHint}`;
  }

  return `MangaDex API request failed for ${path}: ${error?.message || "Unknown network error"}`;
}

function getAxios() {
  // Use StrawVerse's shared client exactly as the official MangaFire scraper does.
  // The shared client supplies the app's normal networking configuration.
  const client = global.axios;
  if (!client || typeof client.get !== "function") {
    throw new Error("StrawVerse global.axios is unavailable; cannot contact MangaDex.");
  }
  return client;
}

async function queuedGet(url) {
  const run = requestQueue.then(async () => {
    const wait = Math.max(0, nextRequestAt - Date.now());
    if (wait) await sleep(wait);
    nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
    const response = await getAxios().get(url);
    return response?.data;
  });

  // Keep the queue usable even when one request fails.
  requestQueue = run.catch(() => undefined);
  return run;
}

async function getJson(path, params) {
  const query = params ? params.toString() : "";
  const url = `${baseUrl}${path}${query ? `?${query}` : ""}`;
  const cached = cacheGet(url);
  if (cached !== undefined) return cached;
  if (inFlightRequests.has(url)) return inFlightRequests.get(url);

  const request = queuedGet(url)
    .then((data) => cacheSet(url, data))
    .catch((error) => {
      throw new Error(describeApiError(error, path));
    })
    .finally(() => inFlightRequests.delete(url));

  inFlightRequests.set(url, request);
  return request;
}

function getPage(page) {
  const value = Number.parseInt(page, 10);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function appendMany(params, key, values) {
  for (const value of values) params.append(key, String(value));
}

function getTitle(attributes = {}) {
  const titles = attributes.title || {};
  return titles.en || titles["en-us"] || titles["en-gb"] || Object.values(titles)[0] || "Untitled Manhwa";
}

function getDescription(attributes = {}) {
  const descriptions = attributes.description || {};
  return descriptions.en || Object.values(descriptions)[0] || "";
}

function getCoverUrl(mangaId, relationships = [], thumbnail = true) {
  const cover = relationships.find((relationship) => relationship.type === "cover_art");
  const fileName = cover?.attributes?.fileName;
  if (!fileName) return null;
  const suffix = thumbnail ? ".256.jpg" : "";
  return `https://uploads.mangadex.org/covers/${mangaId}/${encodeURIComponent(fileName)}${suffix}`;
}

function getPerson(relationships = [], type) {
  return relationships
    .filter((relationship) => relationship.type === type)
    .map((relationship) => relationship.attributes?.name)
    .filter(Boolean)
    .join(", ");
}

function getGenres(attributes = {}) {
  return [...new Set(
    (attributes.tags || [])
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

function getRealMangaId(id) {
  return String(id || "").replace(/^mdko-/, "");
}

function getRealChapterId(id) {
  return String(id || "").replace(/^mdko-ch-/, "");
}

function applyMangaFilters(params, filters = {}, isDiscover = false) {
  // The official MangaFire scraper supports these same UI filter mappings.
  const genreValue = filters?.genre;
  const genreIds = genreValue == null || genreValue === ""
    ? []
    : (Array.isArray(genreValue) ? genreValue : String(genreValue).split(","));
  for (const genreId of genreIds) {
    const value = String(genreId).trim();
    if (value) params.append("includedTags[]", value);
  }

  const status = String(filters?.status || "").trim().toLowerCase();
  if (["ongoing", "completed", "hiatus", "cancelled"].includes(status)) {
    params.append("status[]", status);
  }

  const sort = String(filters?.sort || "").trim().toLowerCase();
  if (sort === "most-followed") {
    params.append("order[followedCount]", "desc");
  } else if (sort === "rating") {
    params.append("order[rating]", "desc");
  } else if (sort === "title-az") {
    params.append("order[title]", "asc");
  } else if (isDiscover) {
    // Match the official MangaFire Discover ordering.
    params.append("order[updatedAt]", "desc");
  }
}

function buildCatalogParams(page, query = "", filters = {}) {
  const safePage = getPage(page);
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String((safePage - 1) * PAGE_SIZE),
    "includes[]": "cover_art",
  });

  // Retain Manhwa + English filtering, but otherwise stay close to the
  // official MangaFire request shape to avoid unnecessary API parameters.
  params.append("originalLanguage[]", "ko");
  appendMany(params, "availableTranslatedLanguage[]", TRANSLATED_LANGUAGES);
  appendMany(params, "contentRating[]", CONTENT_RATINGS);

  if (query) params.set("title", query);
  applyMangaFilters(params, filters, !query);
  return params;
}

function mapMangaResults(response) {
  return (response?.data || []).map((manga) => ({
    id: `mdko-${manga.id}`,
    title: getTitle(manga.attributes),
    image: getCoverUrl(manga.id, manga.relationships || [], true),
  }));
}

async function fetchCatalog(query = "", page = 1, filters = {}) {
  const params = buildCatalogParams(page, String(query || "").trim(), filters);
  const data = await getJson("/manga", params);
  const results = mapMangaResults(data);
  const currentPage = getPage(page);
  const total = Number(data?.total || 0);

  return {
    current_page: currentPage,
    hasNextPage: currentPage * PAGE_SIZE < total,
    results,
  };
}

async function latestManga(page = 1, filters = {}) {
  return fetchCatalog("", page, filters);
}

async function searchManga(query, page = 1, filters = {}) {
  const safeQuery = String(query || "").trim();
  if (!safeQuery) return latestManga(page, filters);
  return fetchCatalog(safeQuery, page, filters);
}

async function fetchMangaInfo(mangaId) {
  const id = getRealMangaId(mangaId);
  if (!id) throw new Error("A MangaDex manga ID is required.");

  const params = new URLSearchParams({ "includes[]": "cover_art" });
  params.append("includes[]", "author");
  const data = await getJson(`/manga/${encodeURIComponent(id)}`, params);
  const manga = data?.data;
  if (!manga?.id || !manga.attributes) {
    throw new Error("MangaDex did not return details for this title.");
  }

  const attributes = manga.attributes;
  return {
    id: `mdko-${manga.id}`,
    title: getTitle(attributes),
    image: getCoverUrl(manga.id, manga.relationships || [], false),
    type: attributes.originalLanguage === "ko" ? "Manhwa" : "Manga",
    description: getDescription(attributes),
    genres: getGenres(attributes),
    author: getPerson(manga.relationships || [], "author"),
    released: attributes.year ? String(attributes.year) : "",
    year: attributes.year ? Number(attributes.year) : null,
    status: normaliseStatus(attributes.status),
  };
}

function getScanlationGroup(chapter) {
  const relationship = (chapter?.relationships || []).find(
    (item) => item.type === "scanlation_group",
  );
  return {
    id: relationship?.id || "",
    name: relationship?.attributes?.name || "",
  };
}

async function fetchChapters(mangaId) {
  const id = getRealMangaId(mangaId);
  if (!id) return { TotalPages: 0, total: 0, Chapters: [] };

  const params = new URLSearchParams({
    limit: String(FEED_PAGE_SIZE),
    offset: "0",
    "order[chapter]": "desc",
    includeFuturePublishAt: "0",
  });
  appendMany(params, "translatedLanguage[]", TRANSLATED_LANGUAGES);
  appendMany(params, "contentRating[]", CONTENT_RATINGS);
  params.append("includes[]", "scanlation_group");

  const data = await getJson(`/manga/${encodeURIComponent(id)}/feed`, params);
  const chapters = (data?.data || []).map((chapter) => {
    const attributes = chapter.attributes || {};
    const group = getScanlationGroup(chapter);
    const rawNumber = attributes.chapter;
    const number = rawNumber == null ? 0 : (Number.parseFloat(rawNumber) || 0);
    const chapterName = attributes.title || (number ? `Chapter ${number}` : "Chapter");
    const groupCredit = group.name ? `Scanlation group: ${group.name}` : "Scanlation group: not listed";

    return {
      id: `mdko-ch-${chapter.id}`,
      number,
      title: `${chapterName} · ${groupCredit}`,
      group: group.name,
    };
  });

  return {
    TotalPages: 1,
    total: chapters.length,
    Chapters: chapters,
  };
}

async function fetchChapterPages(chapterId) {
  const id = getRealChapterId(chapterId);
  if (!id) return [];

  const data = await getJson(`/at-home/server/${encodeURIComponent(id)}`);
  const chapter = data?.chapter;
  const serverBase = String(data?.baseUrl || "").replace(/\/$/, "");
  const hash = chapter?.hash;
  const originalFiles = Array.isArray(chapter?.data) ? chapter.data : [];
  const saverFiles = Array.isArray(chapter?.dataSaver) ? chapter.dataSaver : [];
  const useOriginal = originalFiles.length > 0;
  const files = useOriginal ? originalFiles : saverFiles;
  const quality = useOriginal ? "data" : "data-saver";

  if (!serverBase || !hash || files.length === 0) return [];
  return files.map((file, index) => ({
    page: index + 1,
    img: `${serverBase}/${quality}/${encodeURIComponent(hash)}/${encodeURIComponent(file)}`,
  }));
}

// Public developer-guide aliases.
async function SearchManga(query) {
  const response = await searchManga(query, 1);
  return response.results;
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
  return pages.map((page) => ({ page: page.page, url: page.img }));
}

module.exports = {
  name,
  version,
  baseUrl,
  // Cover images are hosted on this separate MangaDex domain.
  headerRules: [
    {
      match: ["uploads.mangadex.org"],
      headers: { Referer: "https://mangadex.org/" },
    },
  ],
  latestManga,
  searchManga,
  fetchMangaInfo,
  fetchChapters,
  fetchChapterPages,
  SearchManga,
  MangaInfo,
  fetchChapterImages,
};
