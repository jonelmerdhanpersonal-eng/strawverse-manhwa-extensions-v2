/**
 * StrawVerse community extension: MangaDex Korean-origin Manhwa
 *
 * Compatible with the StrawVerse Manga Extension Developer Guide:
 *   - SearchManga(query)
 *   - MangaInfo(id)
 *   - fetchChapterImages(chapterId)
 *
 * Uses MangaDex's public API. It does not host, mirror, or package media.
 * MangaDex attribution and scanlation-group attribution are included in
 * the returned metadata/chapter titles where the API provides them.
 */
const name = "mangadexmanhwa";
const version = "1.0.1";
const baseUrl = "https://api.mangadex.org";
const pageSize = 20;
const chapterPageSize = 500;
const allowedContentRatings = ["safe", "suggestive"];
const allowedTranslatedLanguages = ["en"];
const userAgent = "StrawVerse community extension mangadexmanhwa/1.0.1 (+https://github.com/TheYogMehta/StrawVerse)";

// Add MangaDex scanlation-group UUIDs here if a group requests content removal.
const REMOVED_SCANLATION_GROUP_IDS = new Set([]);
const CACHE_TTL_MS = 5 * 60 * 1000;
const searchCache = new Map();
const infoCache = new Map();
const chapterImageCache = new Map();

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

const axios = global.axios || require("axios");

async function getJson(path, params) {
  const query = params ? params.toString() : "";
  const url = `${baseUrl}${path}${query ? `?${query}` : ""}`;
  const response = await axios.get(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": userAgent,
    },
    timeout: 20000,
  });
  return response?.data;
}

function addRepeated(params, key, values) {
  for (const value of values) params.append(key, String(value));
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

function getPeople(relationships) {
  const people = (relationships || [])
    .filter((item) => item.type === "author" || item.type === "artist")
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

function buildSearchParams(query) {
  const params = new URLSearchParams();
  params.set("limit", String(pageSize));
  params.set("offset", "0");
  params.set("originalLanguage[]", "ko");
  params.set("hasAvailableChapters", "true");
  params.set("availableTranslatedLanguage[]", "en");
  addRepeated(params, "contentRating[]", allowedContentRatings);
  addRepeated(params, "includes[]", ["cover_art", "author", "artist"]);
  params.set("order[latestUploadedChapter]", "desc");
  if (query) params.set("title", query);
  return params;
}

function mapSearchResults(data) {
  return (data?.data || []).map((manga) => ({
    id: `mdko-${manga.id}`,
    title: getTitle(manga.attributes),
    image: getCoverUrl(manga.id, manga.relationships, true),
  }));
}

/** Search Korean-origin titles with available English chapters. */
async function SearchManga(query) {
  const safeQuery = String(query || "").trim();
  if (!safeQuery) return [];

  const cached = cacheGet(searchCache, safeQuery.toLowerCase());
  if (cached) return cached;

  const data = await getJson("/manga", buildSearchParams(safeQuery));
  return cacheSet(searchCache, safeQuery.toLowerCase(), mapSearchResults(data));
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

async function getChapters(mangaId) {
  const params = new URLSearchParams();
  params.set("limit", String(chapterPageSize));
  params.set("offset", "0");
  params.set("order[chapter]", "desc");
  params.set("includeFuturePublishAt", "0");
  addRepeated(params, "translatedLanguage[]", allowedTranslatedLanguages);
  addRepeated(params, "contentRating[]", allowedContentRatings);
  params.append("includes[]", "scanlation_group");

  const data = await getJson(`/manga/${encodeURIComponent(mangaId)}/feed`, params);
  return (data?.data || []).reduce((items, chapter) => {
    const group = getScanlationGroup(chapter);
    if (group.id && REMOVED_SCANLATION_GROUP_IDS.has(group.id)) return items;

    const attributes = chapter.attributes || {};
    const rawNumber = attributes.chapter;
    const chapterNumber = rawNumber !== null && rawNumber !== undefined
      ? (Number.parseFloat(rawNumber) || 0)
      : 0;
    const chapterTitle = attributes.title || (chapterNumber ? `Chapter ${chapterNumber}` : "Chapter");
    const attribution = group.name
      ? `Scanlation group: ${group.name}`
      : "Scanlation group: not listed";

    items.push({
      id: `mdko-ch-${chapter.id}`,
      chapter: chapterNumber,
      title: `${chapterTitle} · ${attribution}`,
      group: group.name,
    });
    return items;
  }, []);
}

/** Fetch the standard StrawVerse title metadata and chapter array. */
async function MangaInfo(mangaId) {
  const id = unwrapMangaId(mangaId);
  if (!id) throw new Error("A MangaDex manga ID is required.");

  const cached = cacheGet(infoCache, id);
  if (cached) return cached;

  const params = new URLSearchParams();
  addRepeated(params, "includes[]", ["cover_art", "author", "artist"]);
  const [detail, chapters] = await Promise.all([
    getJson(`/manga/${encodeURIComponent(id)}`, params),
    getChapters(id),
  ]);

  const manga = detail?.data;
  if (!manga?.id || !manga.attributes) {
    throw new Error("MangaDex did not return manga details for this title.");
  }

  const attributes = manga.attributes;
  const result = {
    id: `mdko-${manga.id}`,
    title: getTitle(attributes),
    image: getCoverUrl(manga.id, manga.relationships, false),
    type: "Manhwa",
    description: getDescription(attributes),
    genres: getGenres(attributes),
    status: normaliseStatus(attributes.status),
    year: attributes.year || "",
    studio: getPeople(manga.relationships),
    chapters,
  };
  return cacheSet(infoCache, id, result);
}

/** Fetch reader page URLs for a chapter. */
async function fetchChapterImages(chapterId) {
  const id = unwrapChapterId(chapterId);
  if (!id) return [];

  const cached = cacheGet(chapterImageCache, id);
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
    url: `${serverBase}/${qualityPath}/${encodeURIComponent(hash)}/${encodeURIComponent(file)}`,
  }));
  return cacheSet(chapterImageCache, id, pages);
}

module.exports = {
  name,
  version,
  baseUrl,
  SearchManga,
  MangaInfo,
  fetchChapterImages,
  // Keep the provider identified as Manhwa in StrawVerse's standard metadata.
};
