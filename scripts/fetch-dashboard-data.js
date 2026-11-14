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
 */

const fs = require('fs');
const path = require('path');

const PROPERTY_ID = process.env.GA4_PROPERTY_ID;
const ACCESS_TOKEN = process.env.GOOGLE_ACCESS_TOKEN;
const GSC_SITE_URL = process.env.GSC_SITE_URL || '';

const DAYS = 28; // 直近28日（前期28日と比較）
const SERIES_DAYS = 90; // 日別推移は90日分持つ
const TOP_N = 10;

const ROOT = path.resolve(__dirname, '..');
const BLOG_POSTS_PATH = path.join(ROOT, 'blog-posts.json');
const OUTPUT_PATH = path.join(ROOT, 'dashboard', 'data.json');

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
  const daily = rowsToObjects(dailyReport).map((r) => ({
    date: `${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6, 8)}`,
    users: r.activeUsers,
    sessions: r.sessions,
    pageViews: r.screenPageViews,
  }));

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

  // 6) キーイベント（電話タップなど、GA4 側で設定されていれば入る）
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

  // 7) Google 広告（GA4 リンク経由）。未リンクなら全て 0 / 空になる
  let ads = { linked: false, current: {}, previous: {}, campaigns: [], daily: [] };
  try {
    const adMetrics = ['advertiserAdImpressions', 'advertiserAdClicks', 'advertiserAdCost'];
    const adSummary = await ga4Report({
      dateRanges: [current, previous],
      metrics: adMetrics.map((name) => ({ name })),
      dimensionFilter: {
        filter: { fieldName: 'sessionSource', stringFilter: { value: 'google' } },
      },
    });
    // dimensionFilter が metric-only レポートで効かない場合に備え、全体も取る
    const adTotals = splitByRange(adSummary, adMetrics);

    const campaignReport = await ga4Report({
      dateRanges: [current],
      dimensions: [{ name: 'sessionGoogleAdsCampaignName' }],
      metrics: [
        { name: 'advertiserAdImpressions' },
        { name: 'advertiserAdClicks' },
        { name: 'advertiserAdCost' },
        { name: 'sessions' },
        { name: 'keyEvents' },
      ],
      orderBys: [{ metric: { metricName: 'advertiserAdCost' }, desc: true }],
      limit: 50,
    });
    const campaigns = rowsToObjects(campaignReport)
      .filter((r) => r.sessionGoogleAdsCampaignName && r.sessionGoogleAdsCampaignName !== '(not set)')
      .map((r) => ({
        campaign: r.sessionGoogleAdsCampaignName,
        impressions: r.advertiserAdImpressions,
        clicks: r.advertiserAdClicks,
        cost: Math.round(r.advertiserAdCost),
        sessions: r.sessions,
        keyEvents: r.keyEvents,
      }));

    const adDailyReport = await ga4Report({
      dateRanges: [{ startDate: `${SERIES_DAYS - 1}daysAgo`, endDate: 'today' }],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'advertiserAdClicks' }, { name: 'advertiserAdCost' }],
      orderBys: [{ dimension: { dimensionName: 'date' } }],
      limit: 1000,
    });
    const adDaily = rowsToObjects(adDailyReport).map((r) => ({
      date: `${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6, 8)}`,
      clicks: r.advertiserAdClicks,
      cost: Math.round(r.advertiserAdCost),
    }));

    const linked =
      campaigns.length > 0 ||
      adTotals.current.advertiserAdImpressions > 0 ||
      adTotals.previous.advertiserAdImpressions > 0;

    ads = {
      linked,
      current: {
        impressions: adTotals.current.advertiserAdImpressions,
        clicks: adTotals.current.advertiserAdClicks,
        cost: Math.round(adTotals.current.advertiserAdCost),
      },
      previous: {
        impressions: adTotals.previous.advertiserAdImpressions,
        clicks: adTotals.previous.advertiserAdClicks,
        cost: Math.round(adTotals.previous.advertiserAdCost),
      },
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
  const daily = gscRows(dailyReport, ['date']).sort((a, b) => a.date.localeCompare(b.date));

  const queriesReport = await gscQuery(siteUrl, {
    startDate: curStart,
    endDate: curEnd,
    dimensions: ['query'],
    rowLimit: 500,
  });
  const queries = gscRows(queriesReport, ['query'])
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, TOP_N * 2);

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
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`dashboard/data.json を更新しました`);
}

main().catch((err) => fail(err.message));
