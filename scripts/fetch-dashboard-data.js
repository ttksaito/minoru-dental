#!/usr/bin/env node
/**
 * GA4 Data API と Search Console API から集客データを取得し、
 * dashboard/data.json を生成するスクリプト（ダッシュボード用）
 *
 * Google 広告のデータは GA4 のリンク経由（advertiserAd* 指標）で取得する。
 * Google Ads API は開発者トークンの審査が必要なため使わない。
 *
 * 認証は GitHub Actions + Workload Identity Federation を使用。
 *
 * 必要な環境変数:
 *   GA4_PROPERTY_ID   … GA4のプロパティID
 *   GOOGLE_ACCESS_TOKEN … WIF認証で取得した一時アクセストークン
 *                         （analytics.readonly と webmasters.readonly の両スコープ）
 * 任意:
 *   GSC_SITE_URL      … Search Console のプロパティ（例: sc-domain:minoru-dental.jp）。
 *                       未指定なら権限のあるプロパティから自動で選ぶ
 *   DASHBOARD_PASSWORD … 指定すると dashboard/data.enc に暗号化して書き出す（公開リポジトリ向け）。
 *                        未指定なら dashboard/data.json に平文で書く（ローカル確認用）
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROPERTY_ID = process.env.GA4_PROPERTY_ID;
const ACCESS_TOKEN = process.env.GOOGLE_ACCESS_TOKEN;
const GSC_SITE_URL = process.env.GSC_SITE_URL || '';

const DAYS = 28; // 直近28日（前期28日と比較）
const SERIES_DAYS = 90; // 日別推移は90日分持つ
const TOP_N = 10;

const ROOT = path.resolve(__dirname, '..');
const BLOG_POSTS_PATH = path.join(ROOT, 'blog-posts.json');
const OUTPUT_PATH = path.join(ROOT, 'dashboard', 'data.json');
const ENCRYPTED_PATH = path.join(ROOT, 'dashboard', 'data.enc');
const INSIGHTS_PATH = path.join(ROOT, 'dashboard', 'insights.json'); // ブログ自動作成の材料（平文。広告費や訪問者数の合計は含めない）
const PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const KDF_ITERATIONS = 300000;

/** AES-256-GCM で暗号化。鍵は PBKDF2(SHA-256) でパスワードから導出。ブラウザ側は Web Crypto で復号する */
function encryptJson(obj, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(password, salt, KDF_ITERATIONS, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: KDF_ITERATIONS,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    data: ct.toString('base64'),
  };
}

function fail(message) {
  console.error(`エラー: ${message}`);
  process.exit(1);
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return isoDate(d);
}

/** 日別データの抜け（アクセス0の日は API が行を返さない）を 0 で埋める */
function fillDates(rows, startDate, endDate, zero) {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out = [];
  for (let d = new Date(startDate + 'T00:00:00Z'); isoDate(d) <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = isoDate(d);
    out.push(byDate.get(date) || { date, ...zero });
  }
  return out;
}

async function callApi(url, body) {
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${url} → ${res.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : {};
}

// ---------------------------------------------------------------- GA4

async function ga4Report(body) {
  return callApi(
    `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}:runReport`,
    body
  );
}

function rowsToObjects(report) {
  const dims = (report.dimensionHeaders || []).map((h) => h.name);
  const mets = (report.metricHeaders || []).map((h) => h.name);
  return (report.rows || []).map((row) => {
    const o = {};
    dims.forEach((name, i) => (o[name] = row.dimensionValues[i].value));
    mets.forEach((name, i) => (o[name] = Number(row.metricValues[i].value) || 0));
    return o;
  });
}

/** 期間の合計（今期 / 前期）。dateRange 名で振り分ける */
function splitByRange(report, metricNames) {
  const result = { current: {}, previous: {} };
  for (const key of Object.keys(result)) {
    metricNames.forEach((m) => (result[key][m] = 0));
  }
  const dims = (report.dimensionHeaders || []).map((h) => h.name);
  const rangeIdx = dims.indexOf('dateRange');
  for (const row of report.rows || []) {
    const rangeName = rangeIdx >= 0 ? row.dimensionValues[rangeIdx].value : 'date_range_0';
    const key = rangeName === 'date_range_1' ? 'previous' : 'current';
    metricNames.forEach((m, i) => {
      result[key][m] += Number(row.metricValues[i].value) || 0;
    });
  }
  return result;
}

async function fetchGa4() {
  const current = { startDate: `${DAYS - 1}daysAgo`, endDate: 'today' };
  const previous = {
    startDate: `${DAYS * 2 - 1}daysAgo`,
    endDate: `${DAYS}daysAgo`,
  };
  const summaryMetrics = [
    'activeUsers',
    'sessions',
    'screenPageViews',
    'newUsers',
    'engagementRate',
    'averageSessionDuration',
  ];

  // 1) サマリー（今期 vs 前期）
  const summaryReport = await ga4Report({
    dateRanges: [current, previous],
    metrics: summaryMetrics.map((name) => ({ name })),
  });
  const summary = splitByRange(summaryReport, summaryMetrics);

  // 2) 日別推移（90日）
  const dailyReport = await ga4Report({
    dateRanges: [{ startDate: `${SERIES_DAYS - 1}daysAgo`, endDate: 'today' }],
    dimensions: [{ name: 'date' }],
    metrics: [
      { name: 'activeUsers' },
      { name: 'sessions' },
      { name: 'screenPageViews' },
    ],
    orderBys: [{ dimension: { dimensionName: 'date' } }],
    limit: 1000,
  });
  const daily = fillDates(
    rowsToObjects(dailyReport).map((r) => ({
      date: `${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6, 8)}`,
      users: r.activeUsers,
      sessions: r.sessions,
      pageViews: r.screenPageViews,
    })),
    daysAgo(SERIES_DAYS - 1), daysAgo(0), { users: 0, sessions: 0, pageViews: 0 }
  );

  // 3) 流入チャネル（今期 vs 前期）
  const channelReport = await ga4Report({
    dateRanges: [current, previous],
    dimensions: [{ name: 'sessionDefaultChannelGroup' }],
    metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
    limit: 50,
  });
  const channelMap = new Map();
  for (const r of rowsToObjects(channelReport)) {
    const name = r.sessionDefaultChannelGroup;
    if (!channelMap.has(name)) {
      channelMap.set(name, { channel: name, sessions: 0, previousSessions: 0, users: 0 });
    }
    const c = channelMap.get(name);
    if (r.dateRange === 'date_range_1') {
      c.previousSessions += r.sessions;
    } else {
      c.sessions += r.sessions;
      c.users += r.activeUsers;
    }
  }
  const channels = [...channelMap.values()].sort((a, b) => b.sessions - a.sessions);

  // 4) ページ別（今期）
  const pagesReport = await ga4Report({
    dateRanges: [current],
    dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
    metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 200,
  });
  // クエリ文字列違いなどを同じパスにまとめる
  const pageMap = new Map();
  for (const r of rowsToObjects(pagesReport)) {
    const p = r.pagePath.replace(/[?#].*$/, '').replace(/\/index\.html$/, '/') || '/';
    if (!pageMap.has(p)) {
      pageMap.set(p, { path: p, title: r.pageTitle, pageViews: 0, users: 0 });
    }
    const e = pageMap.get(p);
    e.pageViews += r.screenPageViews;
    e.users += r.activeUsers;
  }
  const pages = [...pageMap.values()]
    .sort((a, b) => b.pageViews - a.pageViews)
    .slice(0, TOP_N);

  // 5) デバイス（今期）
  const deviceReport = await ga4Report({
    dateRanges: [current],
    dimensions: [{ name: 'deviceCategory' }],
    metrics: [{ name: 'sessions' }],
  });
  const devices = rowsToObjects(deviceReport)
    .map((r) => ({ device: r.deviceCategory, sessions: r.sessions }))
    .sort((a, b) => b.sessions - a.sessions);

  // 6) 地域（市区町村）別（今期）
  const cityReport = await ga4Report({
    dateRanges: [current],
    dimensions: [{ name: 'city' }, { name: 'region' }],
    metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
    orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
    limit: 15,
  });
  const cities = rowsToObjects(cityReport).map((r) => ({
    city: r.city,
    region: r.region,
    users: r.activeUsers,
    sessions: r.sessions,
  }));

  // 7) キーイベント（電話タップなど、GA4 側で設定されていれば入る）
  let keyEvents = [];
  try {
    const keyReport = await ga4Report({
      dateRanges: [current, previous],
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'keyEvents' }],
      dimensionFilter: {
        filter: { fieldName: 'isKeyEvent', stringFilter: { value: 'true' } },
      },
      limit: 50,
    });
    const km = new Map();
    for (const r of rowsToObjects(keyReport)) {
      if (!km.has(r.eventName)) km.set(r.eventName, { event: r.eventName, count: 0, previousCount: 0 });
      if (r.dateRange === 'date_range_1') km.get(r.eventName).previousCount += r.keyEvents;
      else km.get(r.eventName).count += r.keyEvents;
    }
    keyEvents = [...km.values()].sort((a, b) => b.count - a.count);
  } catch (e) {
    console.warn(`キーイベントの取得をスキップ: ${e.message.slice(0, 200)}`);
  }

  // 8) Google 広告（GA4 リンク経由）。未リンクなら全て 0 / 空になる
  //    advertiserAd* 指標はキャンペーン系ディメンションと一緒でないと取得できないため、
  //    常に sessionGoogleAdsCampaignName を付けて取り、こちらで合算する
  let ads = { linked: false, current: {}, previous: {}, campaigns: [], daily: [] };
  try {
    const campaignReport = await ga4Report({
      dateRanges: [current, previous],
      dimensions: [{ name: 'sessionGoogleAdsCampaignName' }],
      metrics: [
        { name: 'advertiserAdImpressions' },
        { name: 'advertiserAdClicks' },
        { name: 'advertiserAdCost' },
        { name: 'sessions' },
        { name: 'keyEvents' },
      ],
      limit: 100,
    });
    const totals = { current: { impressions: 0, clicks: 0, cost: 0 }, previous: { impressions: 0, clicks: 0, cost: 0 } };
    const campaignMap = new Map();
    for (const r of rowsToObjects(campaignReport)) {
      const key = r.dateRange === 'date_range_1' ? 'previous' : 'current';
      totals[key].impressions += r.advertiserAdImpressions;
      totals[key].clicks += r.advertiserAdClicks;
      totals[key].cost += r.advertiserAdCost;
      const name = r.sessionGoogleAdsCampaignName;
      if (key !== 'current' || !name || name === '(not set)') continue;
      if (!campaignMap.has(name)) {
        campaignMap.set(name, { campaign: name, impressions: 0, clicks: 0, cost: 0, sessions: 0, keyEvents: 0 });
      }
      const c = campaignMap.get(name);
      c.impressions += r.advertiserAdImpressions;
      c.clicks += r.advertiserAdClicks;
      c.cost += r.advertiserAdCost;
      c.sessions += r.sessions;
      c.keyEvents += r.keyEvents;
    }
    const campaigns = [...campaignMap.values()]
      .map((c) => ({ ...c, cost: Math.round(c.cost) }))
      .sort((a, b) => b.cost - a.cost || b.clicks - a.clicks);

    const adDailyReport = await ga4Report({
      dateRanges: [{ startDate: `${SERIES_DAYS - 1}daysAgo`, endDate: 'today' }],
      dimensions: [{ name: 'date' }, { name: 'sessionGoogleAdsCampaignName' }],
      metrics: [{ name: 'advertiserAdClicks' }, { name: 'advertiserAdCost' }],
      limit: 10000,
    });
    const dailyMap = new Map();
    for (const r of rowsToObjects(adDailyReport)) {
      const date = `${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6, 8)}`;
      if (!dailyMap.has(date)) dailyMap.set(date, { date, clicks: 0, cost: 0 });
      const d = dailyMap.get(date);
      d.clicks += r.advertiserAdClicks;
      d.cost += r.advertiserAdCost;
    }
    const adDaily = fillDates(
      [...dailyMap.values()].map((d) => ({ ...d, cost: Math.round(d.cost) })),
      daysAgo(SERIES_DAYS - 1), daysAgo(0), { clicks: 0, cost: 0 }
    );

    const linked =
      campaigns.length > 0 || totals.current.impressions > 0 || totals.previous.impressions > 0;

    ads = {
      linked,
      current: { ...totals.current, cost: Math.round(totals.current.cost) },
      previous: { ...totals.previous, cost: Math.round(totals.previous.cost) },
      campaigns,
      daily: adDaily,
    };
  } catch (e) {
    console.warn(`Google 広告（GA4リンク）の取得をスキップ: ${e.message.slice(0, 300)}`);
    ads.error = e.message.slice(0, 300);
  }

  return {
    summary: {
      current: {
        users: summary.current.activeUsers,
        sessions: summary.current.sessions,
        pageViews: summary.current.screenPageViews,
        newUsers: summary.current.newUsers,
        engagementRate: summary.current.engagementRate,
        avgSessionDuration: summary.current.averageSessionDuration,
      },
      previous: {
        users: summary.previous.activeUsers,
        sessions: summary.previous.sessions,
        pageViews: summary.previous.screenPageViews,
        newUsers: summary.previous.newUsers,
        engagementRate: summary.previous.engagementRate,
        avgSessionDuration: summary.previous.averageSessionDuration,
      },
    },
    daily,
    channels,
    pages,
    devices,
    cities,
    keyEvents,
    ads,
  };
}

// ---------------------------------------------------------------- Search Console

async function resolveGscSite() {
  if (GSC_SITE_URL) return GSC_SITE_URL;
  const list = await callApi('https://www.googleapis.com/webmasters/v3/sites');
  const sites = (list.siteEntry || []).filter(
    (s) => s.permissionLevel && s.permissionLevel !== 'siteUnverifiedUser'
  );
  if (sites.length === 0) {
    throw new Error(
      'Search Console にアクセスできるプロパティがありません。サービスアカウントをユーザーとして追加してください'
    );
  }
  const preferred =
    sites.find((s) => s.siteUrl.startsWith('sc-domain:')) ||
    sites.find((s) => s.siteUrl.includes('minoru-dental')) ||
    sites[0];
  console.log(`Search Console プロパティ: ${preferred.siteUrl}（候補 ${sites.length} 件）`);
  return preferred.siteUrl;
}

async function gscQuery(siteUrl, body) {
  return callApi(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    body
  );
}

function gscRows(report, dimNames) {
  return (report.rows || []).map((r) => {
    const o = {
      clicks: r.clicks || 0,
      impressions: r.impressions || 0,
      ctr: r.ctr || 0,
      position: r.position || 0,
    };
    dimNames.forEach((name, i) => (o[name] = r.keys[i]));
    return o;
  });
}

async function fetchGsc() {
  const siteUrl = await resolveGscSite();
  // Search Console のデータは 2〜3 日遅れるので、最新確定日に合わせて窓をずらす
  const LAG = 2;
  const curEnd = daysAgo(LAG);
  const curStart = daysAgo(LAG + DAYS - 1);
  const prevEnd = daysAgo(LAG + DAYS);
  const prevStart = daysAgo(LAG + DAYS * 2 - 1);

  const totals = async (startDate, endDate) => {
    const r = await gscQuery(siteUrl, { startDate, endDate, dimensions: [] });
    const row = (r.rows || [])[0] || {};
    return {
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: row.ctr || 0,
      position: row.position || 0,
    };
  };

  const [current, previous] = await Promise.all([
    totals(curStart, curEnd),
    totals(prevStart, prevEnd),
  ]);

  const dailyReport = await gscQuery(siteUrl, {
    startDate: daysAgo(LAG + SERIES_DAYS - 1),
    endDate: curEnd,
    dimensions: ['date'],
    rowLimit: 1000,
  });
  const daily = fillDates(
    gscRows(dailyReport, ['date']),
    daysAgo(LAG + SERIES_DAYS - 1), curEnd, { clicks: 0, impressions: 0, ctr: 0, position: 0 }
  );

  const queriesReport = await gscQuery(siteUrl, {
    startDate: curStart,
    endDate: curEnd,
    dimensions: ['query'],
    rowLimit: 500,
  });
  const queries = gscRows(queriesReport, ['query'])
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 50);

  const pagesReport = await gscQuery(siteUrl, {
    startDate: curStart,
    endDate: curEnd,
    dimensions: ['page'],
    rowLimit: 500,
  });
  const pages = gscRows(pagesReport, ['page'])
    .map((p) => ({ ...p, page: p.page.replace(/^https?:\/\/[^/]+/, '') || '/' }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, TOP_N);

  return {
    siteUrl,
    range: { start: curStart, end: curEnd },
    previousRange: { start: prevStart, end: prevEnd },
    current,
    previous,
    daily,
    queries,
    pages,
  };
}

// ---------------------------------------------------------------- main

async function main() {
  if (!PROPERTY_ID) fail('環境変数 GA4_PROPERTY_ID が設定されていません');
  if (!ACCESS_TOKEN) fail('環境変数 GOOGLE_ACCESS_TOKEN が設定されていません');

  const blogPosts = JSON.parse(fs.readFileSync(BLOG_POSTS_PATH, 'utf8'));
  const titlesById = new Map(blogPosts.posts.map((p) => [p.id, p.title]));

  const output = {
    generatedAt: new Date().toISOString(),
    days: DAYS,
    ga4: null,
    gsc: null,
    errors: {},
  };

  console.log('GA4 からデータを取得中...');
  try {
    output.ga4 = await fetchGa4();
    // ブログ記事のパスには記事タイトルを付ける
    for (const p of output.ga4.pages) {
      const m = p.path.match(/^\/blog\/([^/]+)\/?$/);
      if (m && titlesById.has(decodeURIComponent(m[1]))) {
        p.title = titlesById.get(decodeURIComponent(m[1]));
      }
    }
    console.log(
      `  ユーザー ${output.ga4.summary.current.users} / セッション ${output.ga4.summary.current.sessions}（直近${DAYS}日）`
    );
  } catch (e) {
    console.error(`GA4 の取得に失敗: ${e.message}`);
    output.errors.ga4 = e.message.slice(0, 500);
  }

  console.log('Search Console からデータを取得中...');
  try {
    output.gsc = await fetchGsc();
    for (const p of output.gsc.pages) {
      const m = p.page.match(/^\/blog\/([^/]+)\/?$/);
      if (m && titlesById.has(decodeURIComponent(m[1]))) {
        p.title = titlesById.get(decodeURIComponent(m[1]));
      }
    }
    console.log(
      `  クリック ${output.gsc.current.clicks} / 表示 ${output.gsc.current.impressions}（${output.gsc.range.start}〜${output.gsc.range.end}）`
    );
  } catch (e) {
    console.error(`Search Console の取得に失敗: ${e.message}`);
    output.errors.gsc = e.message.slice(0, 500);
  }

  if (!output.ga4 && !output.gsc) {
    fail('GA4 と Search Console の両方で取得に失敗しました');
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });

  // ブログのネタ選び用に、検索キーワードと記事ごとの閲覧数だけを平文で書き出す
  const insights = {
    generatedAt: output.generatedAt,
    note: 'ブログ記事の自動作成が参照するデータ。検索キーワードと記事ごとの閲覧数のみ（費用・訪問者数の合計は dashboard/data.enc 側）',
    gscRange: output.gsc ? output.gsc.range : null,
    searchQueries: output.gsc ? output.gsc.queries.map((q) => ({ query: q.query, clicks: q.clicks, impressions: q.impressions, position: Math.round(q.position * 10) / 10 })) : [],
    searchPages: output.gsc ? output.gsc.pages.map((p) => ({ page: p.page, title: p.title || null, clicks: p.clicks, impressions: p.impressions, position: Math.round(p.position * 10) / 10 })) : [],
    blogPageViews: output.ga4 ? output.ga4.pages.filter((p) => p.path.startsWith('/blog/')).map((p) => ({ path: p.path, title: p.title, pageViews: p.pageViews })) : [],
  };
  fs.writeFileSync(INSIGHTS_PATH, JSON.stringify(insights, null, 2) + '\n', 'utf8');

  if (PASSWORD) {
    fs.writeFileSync(ENCRYPTED_PATH, JSON.stringify(encryptJson(output, PASSWORD)) + '\n', 'utf8');
    if (fs.existsSync(OUTPUT_PATH)) fs.unlinkSync(OUTPUT_PATH);
    console.log(`dashboard/data.enc を更新しました（暗号化）`);
  } else {
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
    console.log(`dashboard/data.json を更新しました（平文・ローカル確認用）`);
  }
}

main().catch((err) => fail(err.message));
