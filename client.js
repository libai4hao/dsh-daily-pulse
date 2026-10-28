/**
 * Daily Pulse — browser half.
 *
 * Registers one sidebar entry (`sidebar.panellist`) and the panel it opens (`main`, keyed by
 * the same id). DSH's sidebar owns the button and the layout, so the panel only draws content
 * and inherits the host theme.
 *
 * Everything comes from the Host half over one same-origin route; the browser never calls a
 * third-party origin, which is also why the panel works behind any network policy the Host
 * itself satisfies.
 */
window.__ModuleLoader__.load({
  id: 'dsh-daily-pulse',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'dailyPulse';
    const PANEL_ID = 'daily-pulse';
    const API = '/api/daily-pulse';
    const HEADER = 'x-daily-pulse';

    // ------------------------------------------------------------------ dictionaries

    const ZH = {
      'panel.title': '每日脉搏',
      'panel.subtitle': '天气 · 新模型 · AI 短剧 · 本月热门',
      'panel.refresh': '刷新',
      'panel.refreshing': '抓取中…',
      'panel.loading': '正在加载…',
      'panel.empty': '这一栏暂时没有内容',
      'panel.stale': '数据来自缓存，正在后台更新',
      'panel.updated': '更新于 {time}',
      'panel.failed': '加载失败：{message}',
      'panel.retry': '重试',
      'weather.title': '今日天气',
      'weather.feels': '体感',
      'weather.humidity': '湿度',
      'weather.wind': '风速',
      'weather.precip': '降水',
      'models.title': '新模型',
      'models.note': '最近发布的产品，按时间倒序',
      'dramas.title': 'AI 短剧',
      'dramas.note': '短剧与 AI 视频内容动态',
      'dramas.notePlay': '按播放量排序，来自 B 站',
      'news.title': 'AI 快讯',
      'news.note': 'AI 相关资讯',
      'monthly.title': '本月热门',
      'monthly.models': '榜单最强模型',
      'monthly.hotspots': '社区热议',
      'monthly.repos': '新晋开源项目',
      'monthly.funding': '资本动向',
      'monthly.fundingNote': 'AI 领域的融资与并购',
      'meta.points': '{n} 分',
      'meta.comments': '{n} 评论',
      'meta.stars': '{n} 星',
      'meta.play': '{n} 播放',
      'meta.danmaku': '{n} 弹幕',
      'meta.context': '{n} 上下文',
      'meta.free': '免费',
      'meta.elo': 'Elo {n}',
      'meta.errors': '{n} 个来源失败',
      'unit.c': '°C',
      'unit.percent': '%',
      'unit.kmh': 'km/h',
    };

    const EN = {
      'panel.title': 'Daily Pulse',
      'panel.subtitle': 'Weather · new models · AI short drama · monthly hotspots',
      'panel.refresh': 'Refresh',
      'panel.refreshing': 'Fetching…',
      'panel.loading': 'Loading…',
      'panel.empty': 'Nothing here yet',
      'panel.stale': 'Showing cache; refreshing in the background',
      'panel.updated': 'Updated {time}',
      'panel.failed': 'Could not load: {message}',
      'panel.retry': 'Retry',
      'weather.title': 'Weather',
      'weather.feels': 'Feels',
      'weather.humidity': 'Humidity',
      'weather.wind': 'Wind',
      'weather.precip': 'Rain',
      'models.title': 'New models',
      'models.note': 'Latest releases, newest first',
      'dramas.title': 'AI short drama',
      'dramas.note': 'Short-drama and AI video coverage',
      'dramas.notePlay': 'Ranked by plays, from Bilibili',
      'news.title': 'AI news',
      'news.note': 'AI-related coverage',
      'monthly.title': 'This month',
      'monthly.models': 'Strongest models',
      'monthly.hotspots': 'Community buzz',
      'monthly.repos': 'New open-source',
      'monthly.funding': 'Money moves',
      'monthly.fundingNote': 'AI funding and M&A',
      'meta.points': '{n} pts',
      'meta.comments': '{n} comments',
      'meta.stars': '{n} stars',
      'meta.play': '{n} plays',
      'meta.danmaku': '{n} danmaku',
      'meta.context': '{n} ctx',
      'meta.free': 'free',
      'meta.elo': 'Elo {n}',
      'meta.errors': '{n} sources failed',
      'unit.c': '°C',
      'unit.percent': '%',
      'unit.kmh': 'km/h',
    };

    // ------------------------------------------------------------------ styles

    // Rendered as a React element so unmounting the panel removes it; only theme tokens are
    // used, so light/dark switching needs no second rule set.
    const STYLE_ID = 'dsh-daily-pulse-style';
    const CSS = `
.dp-root { display: flex; flex-direction: column; gap: 14px; padding: 18px 20px 28px; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.5; }
.dp-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.dp-title { font-size: 17px; font-weight: 600; letter-spacing: .01em; }
.dp-sub { margin-top: 2px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dp-actions { display: flex; align-items: center; gap: 8px; }
.dp-btn { appearance: none; cursor: pointer; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 4px 10px; font-size: 12px; }
.dp-btn:hover:not(:disabled) { border-color: var(--dsw-alias-brand-primary); }
.dp-btn:disabled { opacity: .55; cursor: default; }
.dp-status { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dp-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); align-items: start; }
.dp-card { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: 12px; padding: 12px 14px; min-width: 0; }
.dp-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.dp-card-title { font-size: 13px; font-weight: 600; }
.dp-card-note { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dp-wide { grid-column: 1 / -1; }
.dp-weather-now { display: flex; align-items: baseline; gap: 10px; }
.dp-temp { font-size: 34px; font-weight: 600; letter-spacing: -.02em; }
.dp-weather-text { font-size: 14px; }
.dp-facts { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dp-facts b { color: var(--dsw-alias-label-primary); font-weight: 600; }
.dp-days { display: grid; grid-template-columns: repeat(auto-fit, minmax(88px, 1fr)); gap: 8px; margin-top: 10px; }
.dp-day { border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; padding: 6px 8px; }
.dp-day-name { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dp-day-range { font-size: 13px; font-weight: 600; }
.dp-day-text { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dp-row { display: flex; gap: 8px; padding: 5px 0; border-top: 1px solid var(--dsw-alias-border-l1); min-width: 0; }
.dp-row:first-of-type { border-top: none; }
.dp-rank { flex: none; width: 18px; font-size: 11px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; padding-top: 1px; }
.dp-row-body { min-width: 0; flex: 1; }
.dp-link { color: inherit; text-decoration: none; font-weight: 500; }
.dp-link:hover { color: var(--dsw-alias-brand-primary); text-decoration: underline; }
.dp-row-title { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dp-meta { display: flex; flex-wrap: wrap; gap: 2px 8px; font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 1px; }
.dp-tag { border: 1px solid var(--dsw-alias-border-l1); border-radius: 5px; padding: 0 4px; }
.dp-tag-free { color: var(--dsw-alias-state-success-primary); border-color: currentColor; }
.dp-desc { font-size: 11.5px; color: var(--dsw-alias-label-secondary); margin-top: 1px; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.dp-empty { font-size: 12px; color: var(--dsw-alias-label-secondary); padding: 6px 0; }
.dp-error { font-size: 12px; color: var(--dsw-alias-state-error-primary); }
.dp-errlist { display: flex; flex-wrap: wrap; gap: 6px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dp-skeleton { height: 12px; border-radius: 4px; background: var(--dsw-alias-bg-layer-2); margin: 6px 0; }
`;

    // ------------------------------------------------------------------ helpers

    const apiUrl = (path) => new URL(API + path, window.location.origin).toString();

    async function getJson(path) {
      const response = await fetch(apiUrl(path), {
        headers: { accept: 'application/json', [HEADER]: '1' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }

    const decode = (html) => {
      if (typeof html !== 'string' || html === '') return '';
      if (typeof document === 'undefined') return html;
      const area = document.createElement('textarea');
      area.innerHTML = html;
      return area.value;
    };

    const pad = (n) => String(n).padStart(2, '0');

    const formatTime = (iso) => {
      const t = Date.parse(iso ?? '');
      if (!Number.isFinite(t)) return '—';
      const d = new Date(t);
      return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const formatDay = (dateIso) => {
      const t = Date.parse(`${dateIso}T00:00:00`);
      if (!Number.isFinite(t)) return dateIso;
      const d = new Date(t);
      return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
    };

    const weekday = (dateIso) => {
      const t = Date.parse(`${dateIso}T00:00:00`);
      if (!Number.isFinite(t)) return '';
      return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(t).getDay()];
    };

    /**
     * Large counts, in the reader's units.
     *
     * Play counts reach the tens of millions, and "1388万" is read at a glance where
     * "13.9M" has to be converted. The browser's language is the only signal available here
     * without threading the locale snapshot through every card, and it matches what the rest
     * of the UI is doing.
     */
    const ZH_UI = typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '');

    const formatCount = (n) => {
      const value = Number(n) || 0;
      if (ZH_UI) {
        if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`;
        if (value >= 10_000) return `${Math.round(value / 10_000)}万`;
        return String(value);
      }
      if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
      if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
      return String(value);
    };

    const formatContext = (n) => {
      const value = Number(n) || 0;
      if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`;
      if (value >= 1000) return `${Math.round(value / 1000)}K`;
      return String(value);
    };

    /** Price per million tokens, the unit every model catalogue quotes. */
    const formatPrice = (perToken) => {
      if (perToken === null || perToken === undefined) return '—';
      const perMillion = Number(perToken) * 1_000_000;
      if (!Number.isFinite(perMillion)) return '—';
      if (perMillion === 0) return '0';
      if (perMillion < 1) return perMillion.toFixed(3);
      return perMillion.toFixed(2).replace(/\.00$/, '');
    };

    // ------------------------------------------------------------------ small components

    function Card({ title, note, wide, children }) {
      return h(
        'section',
        { className: 'dp-card' + (wide ? ' dp-wide' : '') },
        h(
          'div',
          { className: 'dp-card-head' },
          h('span', { className: 'dp-card-title' }, title),
          note ? h('span', { className: 'dp-card-note' }, note) : null,
        ),
        children,
      );
    }

    function Row({ rank, href, title, meta, desc }) {
      return h(
        'div',
        { className: 'dp-row' },
        rank === undefined ? null : h('span', { className: 'dp-rank' }, String(rank)),
        h(
          'div',
          { className: 'dp-row-body' },
          href
            ? h('a', { className: 'dp-link dp-row-title', href, target: '_blank', rel: 'noreferrer noopener', title }, title)
            : h('span', { className: 'dp-row-title', title }, title),
          meta && meta.length > 0
            ? h(
                'div',
                { className: 'dp-meta' },
                meta.map((entry, index) =>
                  entry && typeof entry === 'object'
                    ? h(
                        'span',
                        {
                          key: index,
                          className: 'dp-tag' + (entry.tone ? ` dp-tag-${entry.tone}` : ''),
                        },
                        entry.text,
                      )
                    : h('span', { key: index }, entry),
                ),
              )
            : null,
          desc ? h('div', { className: 'dp-desc' }, desc) : null,
        ),
      );
    }

    const Empty = ({ t }) => h('div', { className: 'dp-empty' }, t('panel.empty'));

    function Skeleton() {
      return h(
        'div',
        null,
        h('div', { className: 'dp-skeleton', style: { width: '70%' } }),
        h('div', { className: 'dp-skeleton', style: { width: '90%' } }),
        h('div', { className: 'dp-skeleton', style: { width: '55%' } }),
      );
    }

    function WeatherCard({ t, weather }) {
      if (!weather) {
        return h(Card, { title: t('weather.title') }, h(Empty, { t }));
      }
      const now = weather.current ?? {};
      const facts = [
        [t('weather.feels'), `${now.feels ?? '—'}${t('unit.c')}`],
        [t('weather.humidity'), `${now.humidity ?? '—'}${t('unit.percent')}`],
        [t('weather.wind'), `${now.wind ?? '—'}${t('unit.kmh')}`],
      ];
      return h(
        Card,
        { title: t('weather.title'), note: weather.city ?? null },
        h(
          'div',
          { className: 'dp-weather-now' },
          h('span', { className: 'dp-temp' }, `${now.temp ?? '—'}${t('unit.c')}`),
          h('span', { className: 'dp-weather-text' }, now.text ?? ''),
        ),
        h(
          'div',
          { className: 'dp-facts' },
          facts.map(([label, value]) => h('span', { key: label }, `${label} `, h('b', null, value))),
        ),
        Array.isArray(weather.days) && weather.days.length > 0
          ? h(
              'div',
              { className: 'dp-days' },
              weather.days.map((day) =>
                h(
                  'div',
                  { className: 'dp-day', key: day.date },
                  h('div', { className: 'dp-day-name' }, `${weekday(day.date)} ${formatDay(day.date)}`),
                  h('div', { className: 'dp-day-range' }, `${day.min ?? '—'}~${day.max ?? '—'}${t('unit.c')}`),
                  h(
                    'div',
                    { className: 'dp-day-text' },
                    `${day.text ?? ''}${day.precip === null || day.precip === undefined ? '' : ` · ${t('weather.precip')} ${day.precip}${t('unit.percent')}`}`,
                  ),
                ),
              ),
            )
          : null,
      );
    }

    function ModelsCard({ t, models, title, note }) {
      if (!Array.isArray(models) || models.length === 0) {
        return h(Card, { title }, h(Empty, { t }));
      }
      return h(
        Card,
        { title, note },
        models.map((model, index) =>
          h(Row, {
            key: model.id,
            rank: index + 1,
            href: model.url,
            title: decode(model.name),
            meta: [
              model.free ? { text: t('meta.free'), tone: 'free' } : `$${formatPrice(model.priceIn)}/$${formatPrice(model.priceOut)}`,
              model.context ? t('meta.context', { n: formatContext(model.context) }) : null,
              model.elo ? t('meta.elo', { n: model.elo }) : null,
              formatTime(model.created),
            ].filter(Boolean),
            desc: model.modality ? model.modality.replace(/->/g, ' → ') : '',
          }),
        ),
      );
    }

    /**
     * AI short drama.
     *
     * The primary source is Bilibili play counts — real audience numbers, which is what "爆火"
     * means. When that request is rate-limited the Host reports zero videos, and the card falls
     * back to drama *coverage* instead of showing an empty box; the note says which it is.
     */
    function DramaCard({ t, videos, rows }) {
      const list = Array.isArray(videos) ? videos : [];
      if (list.length > 0) {
        return h(
          Card,
          { title: t('dramas.title'), note: t('dramas.notePlay') },
          list.map((row, index) =>
            h(Row, {
              key: row.url,
              rank: index + 1,
              href: row.url,
              title: decode(row.title),
              meta: [
                t('meta.play', { n: formatCount(row.play) }),
                row.danmaku ? t('meta.danmaku', { n: formatCount(row.danmaku) }) : null,
                row.author || null,
                formatTime(row.date),
              ].filter(Boolean),
            }),
          ),
        );
      }
      return h(NewsCard, { t, rows, title: t('dramas.title'), note: t('dramas.note') });
    }

    function NewsCard({ t, rows, title, note }) {
      if (!Array.isArray(rows) || rows.length === 0) {
        return h(Card, { title }, h(Empty, { t }));
      }
      return h(
        Card,
        { title, note },
        rows.map((row, index) =>
          h(Row, {
            key: `${row.link}-${index}`,
            rank: index + 1,
            href: row.link || null,
            title: decode(row.title),
            meta: [row.source, formatTime(row.date)].filter(Boolean),
            desc: row.summary ? decode(row.summary).slice(0, 120) : '',
          }),
        ),
      );
    }

    function HotspotsCard({ t, rows }) {
      if (!Array.isArray(rows) || rows.length === 0) {
        return h(Card, { title: t('monthly.hotspots') }, h(Empty, { t }));
      }
      return h(
        Card,
        { title: t('monthly.hotspots'), note: 'Hacker News' },
        rows.map((row, index) =>
          h(Row, {
            key: `${row.url}-${index}`,
            rank: index + 1,
            href: row.url,
            title: decode(row.title),
            meta: [t('meta.points', { n: formatCount(row.points) }), t('meta.comments', { n: formatCount(row.comments) })],
          }),
        ),
      );
    }

    function ReposCard({ t, rows }) {
      if (!Array.isArray(rows) || rows.length === 0) {
        return h(Card, { title: t('monthly.repos') }, h(Empty, { t }));
      }
      return h(
        Card,
        { title: t('monthly.repos'), note: 'GitHub' },
        rows.map((repo, index) =>
          h(Row, {
            key: repo.url,
            rank: index + 1,
            href: repo.url,
            title: repo.name,
            meta: [
              t('meta.stars', { n: formatCount(repo.stars) }),
              repo.language || null,
              ...(repo.topics ?? []).slice(0, 2),
            ].filter(Boolean),
            desc: repo.description ? decode(repo.description) : '',
          }),
        ),
      );
    }

    // ------------------------------------------------------------------ page

    function Panel({ t }) {
      const [state, setState] = React.useState({ loading: true, snapshot: null, error: null, stale: false, refreshing: false });
      const [busy, setBusy] = React.useState(false);

      // One read path for the first paint, the retry button and the post-refresh poll, so all
      // three settle the panel the same way.
      const load = React.useCallback(async () => {
        try {
          const data = await getJson('/state');
          setState({
            loading: false,
            snapshot: data?.snapshot ?? null,
            error: null,
            stale: Boolean(data?.stale),
            refreshing: Boolean(data?.refreshing),
          });
        } catch (error) {
          setState((prev) => ({ ...prev, loading: false, error: String(error?.message ?? error) }));
        }
      }, []);

      React.useEffect(() => {
        void load();
      }, [load]);

      // A stale snapshot is being refreshed by the Host: re-read once shortly after, so the
      // panel fills in without the user pressing anything.
      React.useEffect(() => {
        if (!state.refreshing) return undefined;
        const id = setTimeout(() => void load(), 6000);
        return () => clearTimeout(id);
      }, [state.refreshing, load]);

      const refresh = async () => {
        setBusy(true);
        try {
          const data = await getJson('/refresh');
          setState({ loading: false, snapshot: data?.snapshot ?? null, error: null, stale: false, refreshing: false });
        } catch (error) {
          setState((prev) => ({ ...prev, error: String(error?.message ?? error) }));
        } finally {
          setBusy(false);
        }
      };

      const snapshot = state.snapshot;
      const errors = snapshot?.errors ?? [];

      return h(
        'div',
        { className: 'dp-root' },
        h('style', { key: 'style' }, CSS),
        h(
          'div',
          { className: 'dp-head' },
          h(
            'div',
            null,
            h('div', { className: 'dp-title' }, t('panel.title')),
            h('div', { className: 'dp-sub' }, t('panel.subtitle')),
          ),
          h(
            'div',
            { className: 'dp-actions' },
            snapshot
              ? h('span', { className: 'dp-status' }, t('panel.updated', { time: formatTime(snapshot.generatedAt) }))
              : null,
            h(
              'button',
              { className: 'dp-btn', type: 'button', onClick: refresh, disabled: busy },
              busy ? t('panel.refreshing') : t('panel.refresh'),
            ),
          ),
        ),
        state.stale ? h('div', { className: 'dp-status' }, t('panel.stale')) : null,
        state.error
          ? h(
              'div',
              { className: 'dp-error' },
              t('panel.failed', { message: state.error }),
              ' ',
              h('button', { className: 'dp-btn', type: 'button', onClick: load }, t('panel.retry')),
            )
          : null,
        state.loading
          ? h(Card, { title: t('panel.loading') }, h(Skeleton, null))
          : h(
              React.Fragment,
              null,
              h(
                'div',
                { className: 'dp-grid' },
                h(WeatherCard, { t, weather: snapshot?.weather ?? null }),
                h(ModelsCard, { t, models: snapshot?.models, title: t('models.title'), note: t('models.note') }),
                h(DramaCard, { t, videos: snapshot?.dramaVideos, rows: snapshot?.dramas }),
                h(NewsCard, { t, rows: snapshot?.news, title: t('news.title'), note: t('news.note') }),
              ),
              h(
                'div',
                { className: 'dp-grid' },
                h(
                  Card,
                  { title: t('monthly.title'), wide: true },
                  h(
                    'div',
                    { className: 'dp-grid' },
                    h(ModelsCard, {
                      t,
                      models: snapshot?.monthly?.models,
                      title: t('monthly.models'),
                      note: 'OpenRouter',
                    }),
                    h(HotspotsCard, { t, rows: snapshot?.monthly?.hotspots }),
                    h(ReposCard, { t, rows: snapshot?.monthly?.repos }),
                    h(NewsCard, {
                      t,
                      rows: snapshot?.monthly?.funding,
                      title: t('monthly.funding'),
                      note: t('monthly.fundingNote'),
                    }),
                  ),
                ),
              ),
              errors.length > 0
                ? h(
                    'div',
                    { className: 'dp-errlist' },
                    h('span', null, t('meta.errors', { n: errors.length })),
                    ...errors.slice(0, 6).map((entry, index) =>
                      h('span', { key: index, className: 'dp-tag' }, `${entry.source}: ${entry.message}`),
                    ),
                  )
                : null,
            ),
      );
    }

    // ------------------------------------------------------------------ panel icon

    function PanelIcon({ size }) {
      const edge = size ?? 18;
      return h(
        'svg',
        {
          width: edge,
          height: edge,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('circle', { cx: 10, cy: 9, r: 4, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', {
          d: 'M10 1.6v2.2M10 14.2v2.2M2.6 9h2.2M15.2 9h2.2M4.9 3.9l1.6 1.6M13.5 12.5l1.6 1.6M15.1 3.9l-1.6 1.6M6.5 12.5l-1.6 1.6',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M15.6 17.4h5.8M18.5 14.5v5.8',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
        }),
      );
    }

    // ------------------------------------------------------------------ plugin

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'daily-pulse:dictionaries');
        const t = ctx.locale.bind(NS);

        // `sidebar.panellist` addresses the panel by `id`, and `main` is keyed by that same
        // id. Register `main` first so selecting the entry can never race its target.
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, (props) =>
            h(Panel, { t: props?.t ?? t }),
          ),
        );

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: () => t('panel.title'), locale: NS },
            PanelIcon,
          ),
        );
      },
    };
  },
});
