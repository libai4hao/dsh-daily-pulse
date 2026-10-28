/**
 * Daily Pulse — host half.
 *
 * A single sidebar panel that answers four questions at once, with no API key and no model
 * call: what is the weather, what new model products shipped, what AI short-drama news broke,
 * and what has been hot in these fields over the past month.
 *
 * Why the collection lives on the Host and not in the browser:
 *  - the browser cannot read most of these origins directly (CORS), and a plugin that ships
 *    its own proxy is a security problem waiting to happen;
 *  - the same snapshot can then be cached on disk, so opening the panel is instant even when
 *    the upstreams are slow or offline.
 *
 * Every source is optional: each fetch is isolated, bounded by a timeout, and a failure
 * becomes an `errors` row instead of an empty panel. A cached snapshot is served stale
 * rather than nothing.
 *
 * Route surface: `/api/daily-pulse/{state,refresh}` on DSH's own web server. The handler
 * never throws and never reports a secret; it exposes only public third-party content.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Service this plugin registers, for other plugins and tools. */
export const name = 'dailyPulse';

/** The route needs the browser carrier; without it there is nothing to serve. */
export const inject = ['webServer'];

const ROUTE_PATH = '/api/daily-pulse';
const HEADER_NAME = 'x-daily-pulse';
const DAY_MS = 86_400_000;
const FETCH_TIMEOUT_MS = 9000;
const USER_AGENT = 'dsh-daily-pulse/1.0 (+dsh plugin; public read-only)';

const DEFAULTS = {
  city: '上海',
  latitude: 31.2222,
  longitude: 121.4581,
  timezone: 'Asia/Shanghai',
  forecastDays: 3,
  cacheMinutes: 30,
  modelLimit: 8,
  hotspotLimit: 8,
  repoLimit: 6,
  newsLimit: 10,
  dramaLimit: 8,
  freshDays: 21,
  monthDays: 31,
  feeds: [],
};

/** Public, keyless news feeds. Order matters only for presentation. */
const NEWS_FEEDS = [
  { title: 'IT之家', url: 'https://www.ithome.com/rss/' },
  { title: '量子位', url: 'https://www.qbitai.com/feed' },
  { title: '爱范儿', url: 'https://www.ifanr.com/feed' },
  { title: '雷峰网', url: 'https://www.leiphone.com/feed' },
];

/** WMO weather codes, the vocabulary Open-Meteo answers in. */
const WMO = {
  0: ['晴', 'Clear'],
  1: ['晴间多云', 'Mainly clear'],
  2: ['多云', 'Partly cloudy'],
  3: ['阴', 'Overcast'],
  45: ['雾', 'Fog'],
  48: ['雾凇', 'Rime fog'],
  51: ['小毛雨', 'Light drizzle'],
  53: ['毛雨', 'Drizzle'],
  55: ['密毛雨', 'Dense drizzle'],
  56: ['冻毛雨', 'Freezing drizzle'],
  57: ['强冻毛雨', 'Dense freezing drizzle'],
  61: ['小雨', 'Light rain'],
  63: ['中雨', 'Rain'],
  65: ['大雨', 'Heavy rain'],
  66: ['冻雨', 'Freezing rain'],
  67: ['强冻雨', 'Heavy freezing rain'],
  71: ['小雪', 'Light snow'],
  73: ['中雪', 'Snow'],
  75: ['大雪', 'Heavy snow'],
  77: ['雪粒', 'Snow grains'],
  80: ['阵雨', 'Rain showers'],
  81: ['中阵雨', 'Moderate rain showers'],
  82: ['强阵雨', 'Violent rain showers'],
  85: ['阵雪', 'Snow showers'],
  86: ['强阵雪', 'Heavy snow showers'],
  95: ['雷阵雨', 'Thunderstorm'],
  96: ['雷阵雨伴冰雹', 'Thunderstorm with hail'],
  99: ['强雷雨伴冰雹', 'Thunderstorm with heavy hail'],
};

/**
 * AI relevance.
 *
 * Latin markers carry word boundaries and the Chinese ones do not need them: without `\b`,
 * `AI` matches the "ai" inside ordinary English words ("detail", "captain") and turns every
 * article into an AI story. Bare `模型` is left out for the mirror-image reason — "贝叶斯混合
 * 模型" and "数值模型" are statistics, not language models — so only the qualified forms count.
 *
 * The same reasoning removes bare `芯片` and `机器人`: a phone-soC launch and an industrial-arm
 * press release are hardware news, not AI news. Only the qualified compounds survive.
 */
const AI_RE =
  /(?:\bAI\b|\bA\.I\.|人工智能|大模型|语言模型|开源模型|多模态|生成式|智能体|\bAgent\b|\bLLM\b|AI\s*芯片|算力|人形机器人|具身智能|\bClaude\b|\bGPT\b|\bGemini\b|\bDeepSeek\b|\bQwen\b|\bKimi\b|豆包|通义|文心|混元|\bLlama\b|\bMistral\b|\bSora\b|\bVeo\b|\bMidjourney\b)/i;
/** Tier one: explicitly short-drama or AI-video production. */
const DRAMA_RE =
  /短剧|漫剧|微短剧|即梦|可灵|\bVidu\b|\bSora\b|\bVeo\b|\bPika\b|\bRunway\b|\bHiggsfield\b|视频生成|文生视频|图生视频|数字人|虚拟人|AI\s*影视|AI\s*电影|AIGC\s*视频|分镜/i;
/** Tier two: adjacent film/TV coverage, used only to fill the column past tier one. */
const DRAMA_ADJACENT_RE = /影视|电影|剧集|剧组|动画|动漫|视频平台|内容生产/;
/** Money moves, with the vague words ("上市", "投资") left out: they match product launches. */
const MONEY_RE = /融资|估值|收购|并购|\bIPO\b|领投|募资|天使轮|[ABCDE]轮|亿元|亿美元|增资|战略投资/;

// ------------------------------------------------------------------ small utilities

/** Resolve one fetch with a hard timeout; throws a message the panel can display. */
async function request(url, { as = 'text', timeout = FETCH_TIMEOUT_MS } = {}) {
  const signal = AbortSignal.timeout(timeout);
  const response = await fetch(url, {
    signal,
    headers: { 'user-agent': USER_AGENT, accept: as === 'json' ? 'application/json' : '*/*' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (as === 'json') return await response.json();
  return await response.text();
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function resolveConfig(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);
  return {
    city: String(input.city ?? DEFAULTS.city).trim() || DEFAULTS.city,
    // Both or neither: a half-supplied pair would silently point at another place.
    latitude: Number.isFinite(latitude) && Number.isFinite(longitude) ? latitude : DEFAULTS.latitude,
    longitude: Number.isFinite(latitude) && Number.isFinite(longitude) ? longitude : DEFAULTS.longitude,
    timezone: String(input.timezone ?? DEFAULTS.timezone),
    forecastDays: clampInt(input.forecastDays, DEFAULTS.forecastDays, 1, 7),
    cacheMinutes: clampInt(input.cacheMinutes, DEFAULTS.cacheMinutes, 1, 720),
    modelLimit: clampInt(input.modelLimit, DEFAULTS.modelLimit, 3, 30),
    hotspotLimit: clampInt(input.hotspotLimit, DEFAULTS.hotspotLimit, 3, 30),
    repoLimit: clampInt(input.repoLimit, DEFAULTS.repoLimit, 3, 20),
    newsLimit: clampInt(input.newsLimit, DEFAULTS.newsLimit, 3, 40),
    dramaLimit: clampInt(input.dramaLimit, DEFAULTS.dramaLimit, 3, 30),
    freshDays: clampInt(input.freshDays, DEFAULTS.freshDays, 1, 90),
    monthDays: clampInt(input.monthDays, DEFAULTS.monthDays, 7, 120),
    feeds: Array.isArray(input.feeds)
      ? input.feeds
          .filter((feed) => feed && typeof feed.url === 'string' && /^https?:\/\//.test(feed.url))
          .map((feed) => ({ title: String(feed.title ?? feed.url), url: feed.url }))
          .slice(0, 12)
      : [],
  };
}

// ------------------------------------------------------------------ XML / text parsing

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

/**
 * Markup to plain text.
 *
 * Entities are decoded *before* tags are stripped, because many feeds carry escaped markup
 * (`&lt;p&gt;`); decoding last would leave those tags visible as text. A second pass then
 * handles anything the first round exposed, which is the common double-encoding case.
 */
function stripTags(html) {
  let text = String(html).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  for (let pass = 0; pass < 2; pass += 1) {
    text = text
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
    text = decodeEntities(text);
  }
  return text.replace(/\s+/g, ' ').trim();
}

/** First `<tag>` body inside `block`, CDATA unwrapped. */
function pickTag(block, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  return match ? match[1].trim() : '';
}

function pickAttr(block, tag, attr) {
  const match = new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*"([^"]*)"`, 'i').exec(block);
  if (match) return match[1];
  const single = new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*'([^']*)'`, 'i').exec(block);
  return single ? single[1] : '';
}

/**
 * Parse an RSS 2.0 or Atom document into `{ title, link, date, summary }` rows.
 *
 * Deliberately not a general feed library: the two shapes below cover every source this
 * plugin reads, and a small parser cannot drift with a dependency's release schedule.
 */
function parseFeed(xml) {
  const rows = [];
  const itemBlocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  const entryBlocks = itemBlocks.length > 0 ? [] : (xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? []);
  for (const block of itemBlocks) {
    const title = stripTags(pickTag(block, 'title'));
    if (!title) continue;
    const link = stripTags(pickTag(block, 'link')) || pickAttr(block, 'link', 'href');
    const date = stripTags(pickTag(block, 'pubDate') || pickTag(block, 'dc:date'));
    const summary = stripTags(pickTag(block, 'description') || pickTag(block, 'content:encoded')).slice(0, 220);
    rows.push({ title, link: normalizeLink(link), date: toIso(date), summary });
  }
  for (const block of entryBlocks) {
    const title = stripTags(pickTag(block, 'title'));
    if (!title) continue;
    const link = pickAttr(block, 'link', 'href') || stripTags(pickTag(block, 'link'));
    const date = stripTags(pickTag(block, 'updated') || pickTag(block, 'published'));
    const summary = stripTags(pickTag(block, 'summary') || pickTag(block, 'content')).slice(0, 220);
    rows.push({ title, link: normalizeLink(link), date: toIso(date), summary });
  }
  return rows;
}

function normalizeLink(link) {
  const value = String(link ?? '').trim();
  return /^https?:\/\//i.test(value) ? value : '';
}

function toIso(value) {
  const time = Date.parse(String(value ?? ''));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

// ------------------------------------------------------------------ collectors

async function collectWeather(config) {
  const days = config.forecastDays;
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${config.latitude}&longitude=${config.longitude}` +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    `&forecast_days=${days}&timezone=${encodeURIComponent(config.timezone)}`;
  const data = await request(url, { as: 'json' });

  const label = (code) => WMO[Number(code)] ?? ['未知', 'Unknown'];
  const current = data?.current ?? {};
  const daily = data?.daily ?? {};
  const dates = Array.isArray(daily.time) ? daily.time : [];

  return {
    city: config.city,
    timezone: data?.timezone ?? config.timezone,
    current: {
      temp: round1(current.temperature_2m),
      feels: round1(current.apparent_temperature),
      humidity: round0(current.relative_humidity_2m),
      wind: round1(current.wind_speed_10m),
      code: Number(current.weather_code),
      text: label(current.weather_code)[0],
      textEn: label(current.weather_code)[1],
      at: current.time ?? null,
    },
    days: dates.map((date, index) => ({
      date,
      max: round1(daily.temperature_2m_max?.[index]),
      min: round1(daily.temperature_2m_min?.[index]),
      precip: round0(daily.precipitation_probability_max?.[index]),
      code: Number(daily.weather_code?.[index]),
      text: label(daily.weather_code?.[index])[0],
      textEn: label(daily.weather_code?.[index])[1],
    })),
  };
}

function round1(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

function round0(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Newest model products, straight from the aggregated catalogue's `created` field. */
async function collectModels(config) {
  const data = await request('https://openrouter.ai/api/v1/models', { as: 'json' });
  const rows = Array.isArray(data?.data) ? data.data : [];
  const since = Date.now() - config.monthDays * DAY_MS;
  const models = [];
  for (const model of rows) {
    const id = String(model?.id ?? '');
    if (!id || id.startsWith('~')) continue; // `~alias` rows point at another entry
    const created = Number(model?.created) * 1000;
    if (!Number.isFinite(created) || created < since) continue;
    const prompt = Number(model?.pricing?.prompt);
    const completion = Number(model?.pricing?.completion);
    const arena = Array.isArray(model?.benchmarks?.design_arena) ? model.benchmarks.design_arena : [];
    const bestElo = arena.reduce((best, entry) => Math.max(best, Number(entry?.elo) || 0), 0);
    const analysis = model?.benchmarks?.artificial_analysis ?? {};
    models.push({
      id,
      name: String(model?.name ?? id),
      provider: id.includes('/') ? id.slice(0, id.indexOf('/')) : '',
      slug: String(model?.canonical_slug ?? ''),
      created: new Date(created).toISOString(),
      context: Number(model?.context_length) || null,
      priceIn: Number.isFinite(prompt) ? prompt : null,
      priceOut: Number.isFinite(completion) ? completion : null,
      free: prompt === 0 && completion === 0,
      modality: String(model?.architecture?.modality ?? ''),
      elo: bestElo > 0 ? bestElo : null,
      intelligence: Number(analysis?.intelligence_index) || null,
      coding: Number(analysis?.coding_index) || null,
      url: `https://openrouter.ai/${id}`,
    });
  }
  models.sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
  return models;
}

/** Community heat: the month's most-discussed AI stories. */
async function collectHotspots(config) {
  const since = Math.floor((Date.now() - config.monthDays * DAY_MS) / 1000);
  const url =
    'https://hn.algolia.com/api/v1/search?query=AI&tags=story' +
    `&numericFilters=created_at_i>${since},points>120&hitsPerPage=40`;
  const data = await request(url, { as: 'json' });
  const hits = Array.isArray(data?.hits) ? data.hits : [];
  return hits
    .filter((hit) => hit?.title)
    .map((hit) => ({
      title: String(hit.title),
      url: normalizeLink(hit.url) || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      points: Number(hit.points) || 0,
      comments: Number(hit.num_comments) || 0,
      date: hit.created_at ? toIso(hit.created_at) : null,
      source: 'Hacker News',
    }))
    .sort((a, b) => b.points - a.points);
}

/** New open-source projects that already drew a crowd this month. */
async function collectRepos(config) {
  const since = new Date(Date.now() - config.monthDays * DAY_MS).toISOString().slice(0, 10);
  const url =
    'https://api.github.com/search/repositories' +
    `?q=${encodeURIComponent(`AI created:>${since}`)}&sort=stars&order=desc&per_page=20`;
  const data = await request(url, { as: 'json', timeout: FETCH_TIMEOUT_MS });
  const items = Array.isArray(data?.items) ? data.items : [];
  return items
    .filter((repo) => repo && !repo.fork)
    .map((repo) => ({
      name: String(repo.full_name ?? ''),
      url: String(repo.html_url ?? ''),
      description: String(repo.description ?? '').slice(0, 180),
      stars: Number(repo.stargazers_count) || 0,
      forks: Number(repo.forks_count) || 0,
      language: String(repo.language ?? ''),
      created: repo.created_at ? toIso(repo.created_at) : null,
      topics: Array.isArray(repo.topics) ? repo.topics.slice(0, 4) : [],
    }))
    .sort((a, b) => b.stars - a.stars);
}

/**
 * One news pool for every text column.
 *
 * Feeds are fetched in parallel and merged; a broken feed contributes an error row but never
 * empties the pool. The same rows then feed the daily list, the drama list and the funding
 * list, filtered by keyword rather than fetched three times.
 */
async function collectNews(config) {
  const feeds = [...NEWS_FEEDS, ...config.feeds];
  const errors = [];
  const settled = await Promise.all(
    feeds.map(async (feed) => {
      try {
        const xml = await request(feed.url);
        return parseFeed(xml).map((row) => ({ ...row, source: feed.title }));
      } catch (error) {
        errors.push({ source: `feed:${feed.title}`, message: messageOf(error) });
        return [];
      }
    }),
  );
  const freshSince = Date.now() - config.freshDays * DAY_MS;
  const seen = new Set();
  const rows = [];
  for (const row of settled.flat()) {
    const key = row.title.toLowerCase().slice(0, 80);
    if (!row.title || seen.has(key)) continue;
    seen.add(key);
    // A feed with no parsable date stays: dropping it would lose the newest items of a
    // feed that simply omits `pubDate`.
    if (row.date && Date.parse(row.date) < freshSince) continue;
    rows.push(row);
  }
  rows.sort((a, b) => Date.parse(b.date ?? 0) - Date.parse(a.date ?? 0));
  return { rows, errors };
}

function messageOf(error) {
  return String(error?.message ?? error ?? 'error').slice(0, 160);
}

/**
 * Real play counts for AI short-drama works, from Bilibili's public search.
 *
 * This is the only *audience* signal available without a key: a feed says a drama was covered,
 * Bilibili says people actually watched it. The query is "AI漫剧" because that is where the
 * works themselves live — "AI短剧" returns mostly tutorials, and results arrive ranked by
 * views already.
 *
 * One request per refresh, deliberately: Bilibili rate-limits anonymous callers hard (-412),
 * so the collector does not retry and degrades to an empty list, and the panel falls back to
 * the drama *news* column.
 */
async function collectDramaVideos(config) {
  const url =
    'https://api.bilibili.com/x/web-interface/search/type?search_type=video' +
    `&keyword=${encodeURIComponent('AI漫剧')}&order=click&page=1`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'user-agent': USER_AGENT,
      accept: 'application/json',
      // Bilibili answers anonymous API calls with -412 unless a site referer is present.
      referer: 'https://www.bilibili.com/',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (Number(data?.code) !== 0) throw new Error(`bilibili code ${data?.code}`);

  // Courses dominate this query. They are not dramas, and their view counts dwarf real works,
  // so keeping them would make the column's top rows systematically wrong.
  const TUTORIAL_RE = /教程|入门|零基础|教学|课程|从零|保姆级|手把手|公开课|解析|拆解|盘点|推荐|合集教程/i;
  const rows = Array.isArray(data?.data?.result) ? data.data.result : [];
  const videos = [];
  const seen = new Set();
  for (const row of rows) {
    const title = stripTags(row?.title ?? '');
    if (!title || TUTORIAL_RE.test(title)) continue;
    const key = title.slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    const play = Number(row?.play);
    // "爆火" is a magnitude, not a rank: below this a result is a small work, not a hit.
    if (!Number.isFinite(play) || play < 100_000) continue;
    videos.push({
      title,
      url: `https://www.bilibili.com/video/${row.bvid}`,
      play,
      danmaku: Number(row?.video_review) || 0,
      author: String(row?.author ?? ''),
      date: Number(row?.pubdate) ? new Date(Number(row.pubdate) * 1000).toISOString() : null,
      source: 'B站',
    });
  }
  return videos.sort((a, b) => b.play - a.play);
}

// ------------------------------------------------------------------ snapshot assembly

function buildSnapshot({ config, weather, models, hotspots, repos, news, videos, errors }) {
  const limit = (rows, count) => rows.slice(0, count);
  // Classify on the headline only. A summary is a whole article: it mentions chips, money and
  // models in passing, so matching on it turns a phone-peripheral story into an AI item. The
  // summary is still carried for display.
  const title = (row) => row.title;

  // Short drama: tier one is explicit, tier two only fills a column that tier one left thin.
  // Both tiers must still be about AI — the column is "AI short drama", so an unrelated film
  // story is a worse filler than an empty row.
  const dramaPrimary = news.filter((row) => DRAMA_RE.test(title(row)) && AI_RE.test(title(row)));
  const dramaFill = news.filter(
    (row) =>
      !DRAMA_RE.test(title(row)) &&
      AI_RE.test(title(row)) &&
      DRAMA_ADJACENT_RE.test(title(row)),
  );
  const dramas = dramaPrimary.concat(dramaFill.slice(0, Math.max(0, Math.floor(config.dramaLimit / 2))));

  // Money moves must be both a funding event and AI-related; otherwise "上市" in a product
  // launch reads as an IPO.
  //
  // A "早报" roundup legitimately mentions a funding round, but its title is a stack of
  // unrelated headlines, which is the opposite of a scannable row. Specific stories rank
  // first and a roundup is used only when it is all there is.
  const ROUNDUP_RE = /早报|晚报|日报|周报|要闻|速递|简报|一览/;
  const funding = news
    .filter((row) => MONEY_RE.test(title(row)) && AI_RE.test(title(row)))
    .sort((a, b) => {
      const rank = (row) => (ROUNDUP_RE.test(title(row)) ? 1 : 0);
      return rank(a) - rank(b) || Date.parse(b.date ?? 0) - Date.parse(a.date ?? 0);
    });

  const aiNews = news.filter((row) => AI_RE.test(title(row)));
  // A row that is already the money-move column does not need to appear again above it.
  const plainNews = aiNews.filter((row) => !dramas.includes(row) && !funding.includes(row));

  const monthlyModels = [...models]
    .sort((a, b) => (b.elo ?? 0) - (a.elo ?? 0) || Date.parse(b.created) - Date.parse(a.created))
    .slice(0, config.modelLimit);

  return {
    generatedAt: new Date().toISOString(),
    city: config.city,
    weather,
    models: limit(models, config.modelLimit),
    dramas: limit(dramas, config.dramaLimit),
    // Real audience numbers, ranked by play count: the "which short drama actually blew up"
    // answer, as opposed to "which one got an article".
    dramaVideos: limit(videos, config.dramaLimit),
    news: limit(plainNews, config.newsLimit),
    monthly: {
      models: monthlyModels,
      hotspots: limit(hotspots, config.hotspotLimit),
      repos: limit(repos, config.repoLimit),
      funding: limit(funding, config.hotspotLimit),
    },
    counts: {
      models: models.length,
      hotStories: hotspots.length,
      repos: repos.length,
      news: aiNews.length,
      dramas: dramaPrimary.length,
      funding: funding.length,
      dramaVideos: videos.length,
    },
    errors,
  };
}

/**
 * One collection round. Each source settles independently, so a slow upstream costs one
 * column instead of the whole snapshot.
 *
 * `videos` is passed in already resolved: the Bilibili call is throttled and long-lived, so
 * its caching is decided by the caller (see `videoFeed`) rather than here.
 */
async function collect(config, logger, videos) {
  const errors = [];
  const track = (source, promise, fallback) =>
    promise.catch((error) => {
      errors.push({ source, message: messageOf(error) });
      logger?.warn?.(`daily-pulse: ${source} failed: ${messageOf(error)}`);
      return fallback;
    });

  const [weather, models, hotspots, repos, news] = await Promise.all([
    track('weather', collectWeather(config), null),
    track('models', collectModels(config), []),
    track('hotspots', collectHotspots(config), []),
    track('repos', collectRepos(config), []),
    track('news', collectNews(config), { rows: [], errors: [] }),
  ]);

  errors.push(...(news.errors ?? []));
  return buildSnapshot({
    config,
    weather,
    models,
    hotspots,
    repos,
    news: news.rows ?? [],
    videos: videos ?? [],
    errors,
  });
}

// ------------------------------------------------------------------ cache

function cachePaths() {
  const base = process.env.DSH_DAILY_PULSE_CACHE_DIR || join(homedir(), '.dsh', 'daily-pulse');
  return { base, file: join(base, 'snapshot.json') };
}

async function readCache(file) {
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && parsed.generatedAt ? parsed : null;
  } catch {
    return null;
  }
}

async function writeCache(file, snapshot) {
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(snapshot), 'utf8');
  } catch {
    // A cache is an optimisation: an unwritable home directory must not break the panel.
  }
}

// ------------------------------------------------------------------ plugin

export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);
  const logger = ctx.logger;
  const { file } = cachePaths();

  /** @type {{ snapshot: any, at: number, inflight: Promise<any> | null }} */
  const state = { snapshot: null, at: 0, inflight: null };

  /**
   * The Bilibili list gets its own, much longer lifetime.
   *
   * A play count is a cumulative number, so a six-hour-old reading is still true, while the
   * upstream rate-limits anonymous callers hard: fetching it on every refresh is how the whole
   * column ends up empty. This also means one throttled call never costs the chart its data.
   */
  const videos = { list: null, at: 0, inflight: null };
  const VIDEO_TTL = 6 * 60 * 60_000;

  const ttl = config.cacheMinutes * 60_000;

  // Warm from disk without blocking activation; the first request then answers immediately.
  const primed = readCache(file).then((cached) => {
    if (!cached) return null;
    if (state.at === 0) {
      state.snapshot = cached;
      state.at = Date.parse(cached.generatedAt) || 0;
    }
    if (videos.at === 0 && Array.isArray(cached.dramaVideos) && cached.dramaVideos.length > 0) {
      videos.list = cached.dramaVideos;
      // An older snapshot's video list is aged by the snapshot's own timestamp, so a stale
      // chart is never presented as current.
      videos.at = Number(cached.dramaVideosAt) || state.at;
    }
    return cached;
  });

  /** The drama chart, refreshed on its own schedule and never discarded on failure. */
  const videoFeed = async () => {
    const age = Date.now() - videos.at;
    if (Array.isArray(videos.list) && videos.list.length > 0 && age < VIDEO_TTL) return videos.list;
    if (!videos.inflight) {
      videos.inflight = (async () => {
        try {
          const next = await collectDramaVideos(config);
          if (next.length > 0) {
            videos.list = next;
            videos.at = Date.now();
          }
          return videos.list;
        } catch (error) {
          logger?.warn?.(`daily-pulse: drama-videos failed: ${messageOf(error)}`);
          return videos.list;
        } finally {
          videos.inflight = null;
        }
      })();
    }
    const settled = await videos.inflight;
    return Array.isArray(settled) ? settled : videos.list;
  };

  const refresh = () => {
    if (state.inflight) return state.inflight;
    const run = (async () => {
      try {
        const snapshot = await collect(config, logger, await videoFeed());
        // Recorded so the next process start can age this chart instead of trusting it blindly.
        snapshot.dramaVideosAt = videos.at ? new Date(videos.at).toISOString() : null;
        state.snapshot = snapshot;
        state.at = Date.now();
        await writeCache(file, snapshot);
        return snapshot;
      } finally {
        state.inflight = null;
      }
    })();
    state.inflight = run;
    return run;
  };

  /** Serve the cache; refresh in the background when it has aged out. */
  const current = async () => {
    if (!state.snapshot) await primed;
    const age = Date.now() - state.at;
    const stale = !state.snapshot || age > ttl;
    if (stale && !state.inflight) void refresh().catch(() => {});
    return {
      snapshot: state.snapshot,
      stale,
      ageMs: state.snapshot ? age : null,
      refreshing: Boolean(state.inflight),
      config: {
        city: config.city,
        cacheMinutes: config.cacheMinutes,
        forecastDays: config.forecastDays,
      },
    };
  };

  const handler = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://dsh.local');
    const path = url.pathname.slice(ROUTE_PATH.length) || '/';
    const send = (status, body) => {
      const payload = JSON.stringify(body);
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(payload),
      });
      res.end(payload);
    };

    // The header proves the caller is script on the DSH origin, not cross-origin markup.
    // It is a CSRF defence, not authentication.
    if (req.headers[HEADER_NAME] !== '1') return send(403, { error: 'header-required' });

    try {
      if (path === '/state' || path === '/') {
        const value = await current();
        return send(200, value);
      }
      if (path === '/refresh') {
        // Forced refreshes are rate-limited: the button is cheap to press and the upstreams
        // are shared public endpoints.
        if (Date.now() - state.at < 15_000 && state.snapshot) {
          return send(429, { error: 'too-soon', ageMs: Date.now() - state.at });
        }
        const snapshot = await refresh();
        return send(200, { snapshot, stale: false, refreshing: false });
      }
      return send(404, { error: 'not-found', path });
    } catch (error) {
      logger?.warn?.(`daily-pulse: route ${path} failed: ${messageOf(error)}`);
      return send(500, { error: 'internal', path });
    }
  };

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PATH, handler }), 'daily-pulse.route');

  // A small service surface, so a tool or another plugin can reuse the snapshot without
  // going through HTTP.
  ctx.provide(name, {
    routePath: ROUTE_PATH,
    headerName: HEADER_NAME,
    config,
    snapshot: () => current(),
    refresh: () => refresh(),
    cachePath: () => file,
  });

  // Pre-fetch once so the first panel open is already populated.
  void primed.then(() => current()).catch(() => {});
}
