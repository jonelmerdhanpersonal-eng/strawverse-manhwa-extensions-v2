const test = require('node:test');
const assert = require('node:assert/strict');

const modulePath = require.resolve('../extensions/Manga/mangadexmanhwa.js');
function loadWithMock(mockGet) {
  delete require.cache[modulePath];
  global.axios = { get: mockGet };
  return require(modulePath);
}
function mangaRecord(id = '11111111-1111-4111-8111-111111111111') {
  return {
    id,
    attributes: {
      title: { en: 'Sample Korean Manhwa' },
      description: { en: 'A test synopsis.' },
      originalLanguage: 'ko',
      year: 2024,
      status: 'ongoing',
      tags: [{ attributes: { name: { en: 'Fantasy' } } }],
    },
    relationships: [
      { type: 'cover_art', attributes: { fileName: 'cover.jpg' } },
      { type: 'author', attributes: { name: 'Test Author' } },
    ],
  };
}

test('exports current runtime hooks and public guide aliases', () => {
  const extension = loadWithMock(async () => ({ data: {} }));
  for (const hook of [
    'latestManga', 'searchManga', 'fetchMangaInfo', 'fetchChapters',
    'fetchChapterPages', 'SearchManga', 'MangaInfo', 'fetchChapterImages',
  ]) {
    assert.equal(typeof extension[hook], 'function', `${hook} must be exported`);
  }
  assert.equal(extension.version, '1.0.5');
});

test('latestManga follows official request shape and keeps Korean/English filters', async () => {
  let calledUrl;
  const extension = loadWithMock(async (url) => {
    calledUrl = url;
    return { data: { data: [mangaRecord()], total: 1 } };
  });
  const result = await extension.latestManga(1);
  const url = new URL(calledUrl);
  assert.equal(url.pathname, '/manga');
  assert.equal(url.searchParams.get('limit'), '30');
  assert.equal(url.searchParams.get('includes[]'), 'cover_art');
  assert.equal(url.searchParams.get('originalLanguage[]'), 'ko');
  assert.equal(url.searchParams.get('availableTranslatedLanguage[]'), 'en');
  assert.equal(url.searchParams.has('hasAvailableChapters'), false);
  assert.equal(result.results[0].title, 'Sample Korean Manhwa');
  assert.equal(result.results[0].id, 'mdko-11111111-1111-4111-8111-111111111111');
  assert.equal(result.hasNextPage, false);
});

test('searchManga passes title query through the MangaDex title parameter', async () => {
  let calledUrl;
  const extension = loadWithMock(async (url) => {
    calledUrl = url;
    return { data: { data: [mangaRecord()], total: 31 } };
  });
  const result = await extension.searchManga('Solo Leveling', 1);
  const url = new URL(calledUrl);
  assert.equal(url.searchParams.get('title'), 'Solo Leveling');
  assert.equal(url.searchParams.get('originalLanguage[]'), 'ko');
  assert.equal(result.hasNextPage, true);
});

test('fetchMangaInfo maps metadata and marks Korean-origin titles as Manhwa', async () => {
  const extension = loadWithMock(async (url) => {
    assert.match(url, /\/manga\/11111111-1111-4111-8111-111111111111/);
    return { data: { data: mangaRecord() } };
  });
  const info = await extension.fetchMangaInfo('mdko-11111111-1111-4111-8111-111111111111');
  assert.equal(info.type, 'Manhwa');
  assert.equal(info.author, 'Test Author');
  assert.deepEqual(info.genres, ['Fantasy']);
  assert.match(info.image, /cover\.jpg$/);
});

test('fetchChapters returns StrawVerse chapter shape and scanlation credit', async () => {
  const extension = loadWithMock(async () => ({
    data: {
      data: [{
        id: '22222222-2222-4222-8222-222222222222',
        attributes: { chapter: '12', title: 'The Beginning' },
        relationships: [{
          type: 'scanlation_group',
          id: '33333333-3333-4333-8333-333333333333',
          attributes: { name: 'Example Team' },
        }],
      }],
    },
  }));
  const result = await extension.fetchChapters('mdko-11111111-1111-4111-8111-111111111111');
  assert.equal(result.total, 1);
  assert.equal(result.Chapters[0].number, 12);
  assert.match(result.Chapters[0].title, /Scanlation group: Example Team/);
});

test('fetchChapterPages builds original @Home image URLs', async () => {
  const extension = loadWithMock(async (url) => {
    assert.match(url, /\/at-home\/server\/44444444-4444-4444-8444-444444444444$/);
    return {
      data: {
        baseUrl: 'https://uploads.example.net',
        chapter: { hash: 'abc123', data: ['page-1.jpg', 'page-2.jpg'], dataSaver: [] },
      },
    };
  });
  const pages = await extension.fetchChapterPages('mdko-ch-44444444-4444-4444-8444-444444444444');
  assert.equal(pages.length, 2);
  assert.equal(pages[0].img, 'https://uploads.example.net/data/abc123/page-1.jpg');
});

test('duplicate in-flight requests are coalesced and cached', async () => {
  let callCount = 0;
  const extension = loadWithMock(async () => {
    callCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { data: { data: [mangaRecord()], total: 1 } };
  });
  const [first, second] = await Promise.all([
    extension.latestManga(1),
    extension.latestManga(1),
  ]);
  assert.equal(callCount, 1);
  assert.deepEqual(first, second);
  await extension.latestManga(1);
  assert.equal(callCount, 1);
});
