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
 *   GBP_LOCATION_ID   … Google ビジネスプロフィールのロケーション ID（数字）。未指定なら自動で探す
 *                       （トークンに business.manage スコープが必要。サービスアカウントを店舗の管理者に追加しておく）
 *   DASHBOARD_PASSWORD … 指定すると dashboard/data.enc に暗号化して書き出す（公開リポジトリ向け）。
 *                        未指定なら dashboard/data.json に平文で書く（ローカル確認用）
 *   CLARITY_API_TOKEN … Microsoft Clarity の Data Export API トークン。指定すると前日分の
 *                        使われ方（スクロール深度・怒りクリック等）とセッション一覧を取得し、履歴として蓄積する
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

/** n 日前の日付（日本時間基準）。GA4 の "yesterday" などの相対日付はプロパティのタイムゾーン（日本時間）で解釈されるので、それに合わせる */
function daysAgo(n) {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000); // UTC → JST
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
  // 当日分は更新時刻（毎朝 5〜6 時）にはほとんど入っていないので、前日までの 28 日を「直近」とする
  const current = { startDate: `${DAYS}daysAgo`, endDate: 'yesterday' };
  const previous = {
    startDate: `${DAYS * 2}daysAgo`,
    endDate: `${DAYS + 1}daysAgo`,
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
    dateRanges: [{ startDate: `${SERIES_DAYS}daysAgo`, endDate: 'yesterday' }],
    dimensions: [{ name: 'date' }],
    metrics: [
      { name: 'activeUsers' },
      { name: 'sessions' },
      { name: 'screenPageViews' },
      { name: 'engagementRate' },
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
      engagementRate: r.engagementRate,
    })),
    daysAgo(SERIES_DAYS), daysAgo(1), { users: 0, sessions: 0, pageViews: 0, engagementRate: 0 }
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

  // 7b) 流れ（サンキー図用）: チャネル → 最初に着いたページ → 成果（キーイベント）。端末別に持ち、ダッシュボード側で切り替える
  const landingGroup = (lp) => {
    const path = (lp || '').replace(/[?#].*$/, '').replace(/\/index\.html$/, '/');
    if (path === '/' || path === '' || path === '(not set)') return 'top';
    if (path.startsWith('/blog/') || path === '/blog.html') return 'blog';
    return 'other';
  };
  let flow = { channelLanding: [], landingOutcome: [] };
  try {
    const clReport = await ga4Report({
      dateRanges: [current],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }, { name: 'landingPage' }, { name: 'deviceCategory' }],
      metrics: [{ name: 'sessions' }],
      limit: 5000,
    });
    const clMap = new Map();
    for (const r of rowsToObjects(clReport)) {
      const key = `${r.sessionDefaultChannelGroup}|${landingGroup(r.landingPage)}|${r.deviceCategory}`;
      clMap.set(key, (clMap.get(key) || 0) + r.sessions);
    }
    const channelLanding = [...clMap.entries()].map(([k, v]) => {
      const [channel, landing, device] = k.split('|');
      return { channel, landing, device, sessions: v };
    });

    // ランディング × 端末ごとのセッション総数
    const landingTotals = {};
    for (const e of channelLanding) {
      const k = `${e.landing}|${e.device}`;
      landingTotals[k] = (landingTotals[k] || 0) + e.sessions;
    }

    // ランディング × キーイベント（そのイベントが起きたセッション数）
    const loMap = new Map();
    try {
      const loReport = await ga4Report({
        dateRanges: [current],
        dimensions: [{ name: 'landingPage' }, { name: 'eventName' }, { name: 'deviceCategory' }],
        metrics: [{ name: 'sessions' }],
        dimensionFilter: { filter: { fieldName: 'isKeyEvent', stringFilter: { value: 'true' } } },
        limit: 5000,
      });
      for (const r of rowsToObjects(loReport)) {
        const key = `${landingGroup(r.landingPage)}|${r.eventName}|${r.deviceCategory}`;
        loMap.set(key, (loMap.get(key) || 0) + r.sessions);
      }
    } catch (e) {
      console.warn(`流れ（成果側）の取得をスキップ: ${e.message.slice(0, 200)}`);
    }
    const landingOutcome = [];
    const withEvent = {};
    for (const [k, v] of loMap.entries()) {
      const [landing, event, device] = k.split('|');
      landingOutcome.push({ landing, outcome: event, device, sessions: v });
      withEvent[`${landing}|${device}`] = (withEvent[`${landing}|${device}`] || 0) + v;
    }
    for (const k of Object.keys(landingTotals)) {
      const [landing, device] = k.split('|');
      const none = Math.max(0, landingTotals[k] - (withEvent[k] || 0));
      if (none > 0) landingOutcome.push({ landing, outcome: 'none', device, sessions: none });
    }
    flow = { channelLanding, landingOutcome };
  } catch (e) {
    console.warn(`流れ（サンキー図用）の取得をスキップ: ${e.message.slice(0, 200)}`);
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
      dateRanges: [{ startDate: `${SERIES_DAYS}daysAgo`, endDate: 'yesterday' }],
      dimensions: [{ name: 'date' }, { name: 'sessionGoogleAdsCampaignName' }],
      metrics: [
        { name: 'advertiserAdImpressions' },
        { name: 'advertiserAdClicks' },
        { name: 'advertiserAdCost' },
        { name: 'sessions' },
        { name: 'keyEvents' },
      ],
      limit: 10000,
    });
    const dailyZero = { impressions: 0, clicks: 0, cost: 0, sessions: 0, keyEvents: 0 };
    const dailyMap = new Map();
    for (const r of rowsToObjects(adDailyReport)) {
      const date = `${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6, 8)}`;
      if (!dailyMap.has(date)) dailyMap.set(date, { date, ...dailyZero });
      const d = dailyMap.get(date);
      d.impressions += r.advertiserAdImpressions;
      d.clicks += r.advertiserAdClicks;
      d.cost += r.advertiserAdCost;
      // セッション・キーイベントは「広告経由のセッション」に限る（キャンペーン名が付いた行だけ）
      const name = r.sessionGoogleAdsCampaignName;
      if (name && name !== '(not set)') {
        d.sessions += r.sessions;
        d.keyEvents += r.keyEvents;
      }
    }
    const adDaily = fillDates(
      [...dailyMap.values()].map((d) => ({ ...d, cost: Math.round(d.cost) })),
      daysAgo(SERIES_DAYS), daysAgo(1), dailyZero
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
    flow,
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

// ---------------------------------------------------------------- Google ビジネスプロフィール（Google マップ）

const GBP_LOCATION_ID = process.env.GBP_LOCATION_ID || '';

function ymd(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { year: y, month: m, day: d };
}

/** サービスアカウント宛ての保留中の招待（ビジネスプロフィールの管理者招待）を承諾する。
 *  サービスアカウントは画面で「承諾」を押せないため、API で承諾する */
async function acceptPendingGbpInvitations(accounts) {
  let accepted = 0;
  for (const a of accounts) {
    let inv;
    try {
      inv = await callApi(`https://mybusinessaccountmanagement.googleapis.com/v1/${a.name}/invitations?filter=target_type=ACCOUNTS_AND_LOCATIONS`);
    } catch (e) {
      try { inv = await callApi(`https://mybusinessaccountmanagement.googleapis.com/v1/${a.name}/invitations`); } catch (e2) { continue; }
    }
    for (const i of inv.invitations || []) {
      try {
        await callApi(`https://mybusinessaccountmanagement.googleapis.com/v1/${i.name}:accept`, {});
        accepted++;
        const target = (i.targetLocation && i.targetLocation.locationName) || (i.targetAccount && i.targetAccount.accountName) || i.name;
        console.log(`ビジネスプロフィールの招待を承諾しました: ${target}（役割 ${i.role || '-'}）`);
      } catch (e) {
        console.warn(`招待の承諾に失敗: ${i.name}: ${e.message.slice(0, 200)}`);
      }
    }
  }
  return accepted;
}

async function resolveGbpLocation() {
  if (GBP_LOCATION_ID) return GBP_LOCATION_ID.replace(/^locations\//, '');
  const acc = await callApi('https://mybusinessaccountmanagement.googleapis.com/v1/accounts');
  let accounts = acc.accounts || [];
  // 保留中の招待があれば承諾してから、アカウント一覧を取り直す
  if (await acceptPendingGbpInvitations(accounts)) {
    const again = await callApi('https://mybusinessaccountmanagement.googleapis.com/v1/accounts');
    accounts = again.accounts || accounts;
  }
  if (accounts.length === 0) throw new Error('ビジネスプロフィールのアカウントが見つかりません（サービスアカウントを店舗の管理者に追加してください）');
  for (const a of accounts) {
    const loc = await callApi(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?readMask=name,title&pageSize=20`
    );
    const locations = loc.locations || [];
    if (locations.length > 0) {
      const pick = locations.find((l) => /みのる/.test(l.title || '')) || locations[0];
      console.log(`ビジネスプロフィール: ${pick.title}（${pick.name}、候補 ${locations.length} 件）`);
      return pick.name.replace(/^locations\//, '');
    }
  }
  throw new Error('ビジネスプロフィールのロケーションが見つかりません');
}

async function fetchGbp() {
  const locationId = await resolveGbpLocation();
  const metrics = [
    'CALL_CLICKS',
    'BUSINESS_DIRECTION_REQUESTS',
    'WEBSITE_CLICKS',
    'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
    'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
    'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
    'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
    'BUSINESS_CONVERSATIONS',
    'BUSINESS_BOOKINGS',
  ];
  // GBP のデータは 2〜3 日遅れ。前期比較は 28 日ずつ、日別は 90 日
  const LAG = 3;
  const end = daysAgo(LAG);
  const start = daysAgo(LAG + SERIES_DAYS - 1);
  const s = ymd(start), e = ymd(end);
  const params = new URLSearchParams();
  metrics.forEach((m) => params.append('dailyMetrics', m));
  params.set('dailyRange.start_date.year', s.year); params.set('dailyRange.start_date.month', s.month); params.set('dailyRange.start_date.day', s.day);
  params.set('dailyRange.end_date.year', e.year); params.set('dailyRange.end_date.month', e.month); params.set('dailyRange.end_date.day', e.day);
  const res = await callApi(
    `https://businessprofileperformance.googleapis.com/v1/locations/${locationId}:fetchMultiDailyMetricsTimeSeries?${params}`
  );

  // 日別に整形
  const byDate = new Map();
  for (const series of res.multiDailyMetricTimeSeries || []) {
    for (const m of series.dailyMetricTimeSeries || []) {
      const metric = m.dailyMetric;
      for (const pt of (m.timeSeries && m.timeSeries.datedValues) || []) {
        const d = pt.date;
        const date = `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
        if (!byDate.has(date)) byDate.set(date, { date, calls: 0, directions: 0, websiteClicks: 0, impressionsMaps: 0, impressionsSearch: 0, messages: 0, bookings: 0 });
        const row = byDate.get(date);
        const v = Number(pt.value || 0);
        if (metric === 'CALL_CLICKS') row.calls += v;
        else if (metric === 'BUSINESS_DIRECTION_REQUESTS') row.directions += v;
        else if (metric === 'WEBSITE_CLICKS') row.websiteClicks += v;
        else if (metric === 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS' || metric === 'BUSINESS_IMPRESSIONS_MOBILE_MAPS') row.impressionsMaps += v;
        else if (metric === 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH' || metric === 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH') row.impressionsSearch += v;
        else if (metric === 'BUSINESS_CONVERSATIONS') row.messages += v;
        else if (metric === 'BUSINESS_BOOKINGS') row.bookings += v;
      }
    }
  }
  const daily = fillDates([...byDate.values()], start, end, { calls: 0, directions: 0, websiteClicks: 0, impressionsMaps: 0, impressionsSearch: 0, messages: 0, bookings: 0 });

  const sumRange = (from, to) => {
    const out = { calls: 0, directions: 0, websiteClicks: 0, impressionsMaps: 0, impressionsSearch: 0, messages: 0, bookings: 0 };
    for (const r of daily) if (r.date >= from && r.date <= to) for (const k of Object.keys(out)) out[k] += r[k];
    return out;
  };
  const curStart = daysAgo(LAG + DAYS - 1), prevEnd = daysAgo(LAG + DAYS), prevStart = daysAgo(LAG + DAYS * 2 - 1);
  const current = sumRange(curStart, end);
  const previous = sumRange(prevStart, prevEnd);

  // 検索キーワード（月次。直近 2 か月分）
  let keywords = [];
  try {
    const now = new Date();
    const m0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const m1 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const kp = new URLSearchParams({
      'monthlyRange.start_month.year': m0.getUTCFullYear(), 'monthlyRange.start_month.month': m0.getUTCMonth() + 1,
      'monthlyRange.end_month.year': m1.getUTCFullYear(), 'monthlyRange.end_month.month': m1.getUTCMonth() + 1,
      pageSize: 50,
    });
    const kw = await callApi(`https://businessprofileperformance.googleapis.com/v1/locations/${locationId}/searchkeywords/impressions/monthly?${kp}`);
    keywords = (kw.searchKeywordsCounts || []).map((k) => ({
      keyword: k.searchKeyword,
      // 少数は threshold（15 未満）として値が無い場合がある
      impressions: k.insightsValue && k.insightsValue.value != null ? Number(k.insightsValue.value) : null,
      threshold: k.insightsValue && k.insightsValue.threshold != null ? Number(k.insightsValue.threshold) : null,
    }));
  } catch (e) {
    console.warn(`ビジネスプロフィールの検索キーワード取得をスキップ: ${e.message.slice(0, 200)}`);
  }

  return { locationId, range: { start: curStart, end }, previousRange: { start: prevStart, end: prevEnd }, current, previous, daily, keywords };
}

// ---------------------------------------------------------------- Microsoft Clarity（使われ方 → UX 改善ページ）

const CLARITY_TOKEN = process.env.CLARITY_API_TOKEN || '';
const CLARITY_HISTORY_DAYS = 90; // サイト全体・端末別の日別履歴
const CLARITY_BREAKDOWN_DAYS = 28; // URL 別・流入元別の日別履歴（サイズを抑える）
const CLARITY_URL_LIMIT = 30; // URL 別は 1 日あたり訪問の多い上位 30 ページまで保存
// 1 日の API 上限は 10 回。毎朝 4 回使う（全体 + URL 別 + 端末別 + 流入元別）。
// 同じ日の分を取り込み済みなら呼ばないので、手動で何度実行しても上限に当たらない
const CLARITY_DIMENSIONS = [
  { dim: 'URL', key: 'byUrl', keepDays: CLARITY_BREAKDOWN_DAYS, limit: CLARITY_URL_LIMIT },
  { dim: 'Device', key: 'byDevice', keepDays: CLARITY_HISTORY_DAYS, limit: 10 },
  { dim: 'Channel', key: 'byChannel', keepDays: CLARITY_BREAKDOWN_DAYS, limit: 15 },
];

/** 前回の出力（暗号化済み）から Clarity の部分を取り出す。Data Export API は直近 1〜3 日分しか返さないため、履歴はこちらで積み上げる */
function loadPreviousClarity() {
  try {
    if (PASSWORD && fs.existsSync(ENCRYPTED_PATH)) {
      const pkg = JSON.parse(fs.readFileSync(ENCRYPTED_PATH, 'utf8'));
      const key = crypto.pbkdf2Sync(PASSWORD, Buffer.from(pkg.salt, 'base64'), pkg.iterations, 32, 'sha256');
      const buf = Buffer.from(pkg.data, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(pkg.iv, 'base64'));
      decipher.setAuthTag(buf.subarray(buf.length - 16));
      const prev = JSON.parse(Buffer.concat([decipher.update(buf.subarray(0, buf.length - 16)), decipher.final()]).toString('utf8'));
      return prev.clarity || null;
    }
    if (!PASSWORD && fs.existsSync(OUTPUT_PATH)) {
      const prev = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
      return prev.clarity || null;
    }
  } catch (e) {
    console.warn(`Clarity の履歴を読めませんでした（新規に開始）: ${e.message.slice(0, 120)}`);
  }
  return null;
}

async function clarityRequest(params) {
  const qs = new URLSearchParams({ numOfDays: '1', ...params });
  const res = await fetch(`https://www.clarity.ms/export-data/api/v1/project-live-insights?${qs}`, {
    headers: { Authorization: `Bearer ${CLARITY_TOKEN}`, Accept: 'application/json', 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  if (res.status === 400 && !text.trim()) {
    throw new Error('Clarity API 400（本文なし）: まだ記録されたデータがない可能性があります。タグ設置の翌日以降に解消します');
  }
  if (res.status === 401 || res.status === 403) throw new Error(`Clarity API ${res.status}: トークンが無効です。Clarity の設定 → データのエクスポートで再発行し、CLARITY_API_TOKEN を登録し直してください`);
  if (res.status === 429) throw new Error('Clarity API 429: 1 日の呼び出し上限（10 回）に達しました。翌日に再取得します');
  if (!res.ok) throw new Error(`Clarity API ${res.status}: ${text.slice(0, 300)}`);
  const arr = JSON.parse(text);
  if (!Array.isArray(arr)) throw new Error('Clarity API: 想定外の形式の応答です');
  return arr;
}

const clNum = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? 0 : Number(v));
/** 1 行から指標を取り出す（指標名ごとにフィールド名が違う） */
function clarityMetricValue(metricName, row) {
  switch (metricName) {
    case 'Traffic': return {
      sessions: clNum(row.totalSessionCount), botSessions: clNum(row.totalBotSessionCount),
      users: clNum(row.distinctUserCount != null ? row.distinctUserCount : row.distantUserCount), // 公式ドキュメントのサンプルは distantUserCount と綴られている
      pagesPerSession: clNum(row.PagesPerSessionPercentage),
    };
    case 'ScrollDepth': return { scrollDepth: clNum(row.averageScrollDepth) };
    case 'EngagementTime': return { engagementActiveSec: clNum(row.activeTime), engagementTotalSec: clNum(row.totalTime) };
    case 'DeadClickCount': return { deadClicks: clNum(row.subTotal) };
    case 'RageClickCount': return { rageClicks: clNum(row.subTotal) };
    case 'QuickbackClick': return { quickBacks: clNum(row.subTotal) };
    case 'ExcessiveScroll': return { excessiveScroll: clNum(row.subTotal) };
    case 'ScriptErrorCount': return { scriptErrors: clNum(row.subTotal) };
    case 'ErrorClickCount': return { errorClicks: clNum(row.subTotal) };
    default: return null;
  }
}
const CLARITY_EMPTY = { sessions: 0, botSessions: 0, users: 0, pagesPerSession: 0, scrollDepth: 0, engagementActiveSec: 0, engagementTotalSec: 0, deadClicks: 0, rageClicks: 0, quickBacks: 0, excessiveScroll: 0, scriptErrors: 0, errorClicks: 0 };

/** 内訳なしの応答 → サイト全体の 1 日分 */
function claritySnapshot(arr, date) {
  const snap = { date, ...CLARITY_EMPTY };
  for (const m of arr) {
    const row = (m.information || [])[0];
    if (!row) continue;
    Object.assign(snap, clarityMetricValue(m.metricName, row) || {});
  }
  const get = (name) => (arr.find((m) => m.metricName === name) || {}).information || [];
  const breakdown = {
    pages: get('PopularPages').slice(0, 10).map((x) => ({ url: x.Url || x.URL || x.url, visits: clNum(x.visitsCount) })),
    devices: get('Device').map((x) => ({ device: x.Device, sessions: clNum(x.sessionsCount) })),
    referrers: get('ReferrerUrl').slice(0, 10).map((x) => ({ referrer: x.ReferrerURL || x.ReferrerUrl, sessions: clNum(x.sessionsCount) })),
  };
  return { snapshot: snap, breakdown };
}

/** 内訳の値（URL / Device / Channel）。URL はサイト内ならパスに正規化して、クエリ違いなどをまとめる */
function clarityDimensionValue(dim, row) {
  const raw = row[dim] != null ? row[dim] : row[dim.toLowerCase()] != null ? row[dim.toLowerCase()] : row[dim[0] + dim.slice(1).toLowerCase()];
  if (raw == null || raw === '') return '(不明)';
  if (dim !== 'URL') return String(raw);
  try {
    const u = new URL(String(raw));
    if (/minoru-dental\.jp$/.test(u.hostname) || /github\.io$/.test(u.hostname) || /vercel\.app$/.test(u.hostname)) {
      return (u.pathname.replace(/\/index\.html$/, '/') || '/');
    }
    return u.hostname + u.pathname;
  } catch (e) {
    return String(raw).replace(/[?#].*$/, '');
  }
}

/** 内訳ありの応答 → その日の行（内訳の値ごとに 1 行）。同じ値に複数行が来たら訪問数で重み付けして合算 */
function clarityDimensionRows(arr, dim, limit) {
  const map = new Map();
  const rowOf = (key) => { if (!map.has(key)) map.set(key, { key, ...CLARITY_EMPTY, _w: 0 }); return map.get(key); };
  // Traffic を先に見て重み（訪問数）を決める
  const byName = new Map(arr.map((m) => [m.metricName, m.information || []]));
  for (const row of byName.get('Traffic') || []) {
    const r = rowOf(clarityDimensionValue(dim, row));
    const v = clarityMetricValue('Traffic', row);
    r.sessions += v.sessions; r.botSessions += v.botSessions; r.users += v.users;
    r.pagesPerSession = r._w + v.sessions > 0 ? (r.pagesPerSession * r._w + v.pagesPerSession * v.sessions) / (r._w + v.sessions) : v.pagesPerSession;
    r._w += v.sessions;
  }
  for (const [name, rows] of byName) {
    if (name === 'Traffic') continue;
    for (const row of rows) {
      const v = clarityMetricValue(name, row);
      if (!v) continue;
      const r = rowOf(clarityDimensionValue(dim, row));
      for (const [k, val] of Object.entries(v)) {
        if (k === 'scrollDepth' || k === 'engagementActiveSec' || k === 'engagementTotalSec') {
          // 平均系は、その値ごとの訪問数で重み付け（同じ値の行が 1 つなら単純に採用）
          const w = clNum(row.sessionsCount) || clNum(row.totalSessionCount) || 1;
          const seen = r[`_${k}w`] || 0;
          r[k] = seen + w > 0 ? (r[k] * seen + val * w) / (seen + w) : val;
          r[`_${k}w`] = seen + w;
        } else {
          r[k] += val;
        }
      }
    }
  }
  const rows = [...map.values()].map((r) => {
    const o = {}; for (const [k, v] of Object.entries(r)) if (!k.startsWith('_')) o[k] = typeof v === 'number' ? Math.round(v * 100) / 100 : v;
    return o;
  });
  rows.sort((a, b) => b.sessions - a.sessions);
  return rows.slice(0, limit);
}

function appendClarityDay(list, day, keepDays) {
  const prev = (list || []).filter((d) => d.date !== day.date);
  return [...prev, day].sort((a, b) => a.date.localeCompare(b.date)).slice(-keepDays);
}

// ---- セッション一覧（公式 MCP サーバーが使っている内部 API。ドキュメント外なので壊れたら前回分を表示し続ける）
const CLARITY_MCP_BASE = 'https://clarity.microsoft.com/mcp';
const CLARITY_SESSION_DAYS = 14; // セッション一覧を保持する日数（録画自体の保存期間は 30 日）
const CLARITY_SESSIONS_PER_DAY = 60; // 1 日あたり保存する最大件数（新しい順）
const CLARITY_SESSION_STATS_DAYS = 90; // 時間帯別・参照元などの日別集計の保持日数

async function clarityMcp(path, body) {
  const res = await fetch(`${CLARITY_MCP_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CLARITY_TOKEN}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw new Error(`Clarity 内部 API ${res.status}: トークンが無効か、この API で使えなくなりました`);
  if (res.status === 429) throw new Error('Clarity 内部 API 429: 呼び出し上限に達しました。翌日に再取得します');
  if (!res.ok) throw new Error(`Clarity 内部 API ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch (e) { throw new Error('Clarity 内部 API: JSON でない応答'); }
}

/** "00:01:05" / 65 / "65" → 秒 */
function parseDurationSec(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  let m = s.match(/^(\d+):(\d{1,2}):(\d{1,2})(?:\.\d+)?$/);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  m = s.match(/^(\d+):(\d{1,2})(?:\.\d+)?$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(s);
  return Number.isNaN(n) ? 0 : n;
}
function jstParts(ts) {
  const t = new Date(ts);
  if (Number.isNaN(t.getTime())) return null;
  const j = new Date(t.getTime() + 9 * 60 * 60 * 1000);
  return { date: j.toISOString().slice(0, 10), hour: j.getUTCHours() };
}
function hostOf(u) {
  if (!u) return '';
  try { return new URL(String(u)).hostname.replace(/^www\./, ''); } catch (e) { return String(u).replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, ''); }
}
/** timelineEvents の 1 件を短い文字列に（構造が公開されていないので、ありそうな項目名を順に見る） */
function summarizeTimelineEvent(e) {
  if (e == null) return null;
  if (typeof e === 'string') return e.slice(0, 60);
  if (typeof e !== 'object') return String(e).slice(0, 60);
  const type = e.type || e.eventType || e.event || e.name || e.kind || e.category || '';
  const text = e.text || e.clickedText || e.label || e.target || e.selector || e.message || e.url || '';
  const out = [type, text].filter(Boolean).map((x) => String(x).slice(0, 60)).join(': ');
  return out || Object.keys(e).slice(0, 3).join(',');
}
/** API のセッション 1 件 → 保存用の小さな形 */
function compactClaritySession(s, device) {
  const parts = jstParts(s.timestamp);
  const timeline = Array.isArray(s.timeline) ? s.timeline : [];
  const totalSec = parseDurationSec(s.totalDuration);
  const activeSec = parseDurationSec(s.activeDuration);
  // timeline[].duration の単位が不明（秒かミリ秒か）なので、合計が滞在時間の 50 倍を超えていたらミリ秒とみなす
  const rawSum = timeline.reduce((a, p) => a + (Number(p.duration) || 0), 0);
  const msScale = totalSec > 0 && rawSum > totalSec * 50 ? 1000 : 1;
  const pages = timeline.map((p) => {
    const path = clarityDimensionValue('URL', { URL: p.url || '' });
    const events = (Array.isArray(p.timelineEvents) ? p.timelineEvents : []).map(summarizeTimelineEvent).filter(Boolean).slice(0, 12);
    const load = Number(p.pageLoadTime);
    return {
      path, title: p.displayTitle ? String(p.displayTitle).slice(0, 80) : '',
      sec: Math.round(((Number(p.duration) || 0) / msScale) * 10) / 10,
      loadSec: Number.isFinite(load) ? Math.round((load > 1000 ? load / 1000 : load) * 100) / 100 : null, // 1000 超はミリ秒とみなす
      score: Number.isFinite(Number(p.score)) ? Number(p.score) : null,
      events,
    };
  });
  const referrer = timeline.length ? hostOf(timeline[0].referrerUrl) : '';
  return {
    id: String(s.link || '').slice(0, 300),
    link: String(s.link || '').slice(0, 300),
    ts: s.timestamp,
    date: parts ? parts.date : daysAgo(1),
    hour: parts ? parts.hour : null,
    device,
    totalSec, activeSec,
    pages: Number(s.pagesCount) || pages.length,
    clicks: Number(s.sessionClickCount) || 0,
    referrer,
    timeline: pages.slice(0, 12),
  };
}
/** その日のセッション群 → 日別の集計 1 件 */
function clarityDayStats(date, sessions) {
  const byHour = new Array(24).fill(0);
  const refs = new Map(), pages = new Map();
  let single = 0, mobile = 0, pc = 0;
  for (const s of sessions) {
    if (s.hour != null) byHour[s.hour] += 1;
    if (s.pages <= 1) single += 1;
    if (s.device === 'Mobile') mobile += 1; else if (s.device === 'PC') pc += 1;
    refs.set(s.referrer || '', (refs.get(s.referrer || '') || 0) + 1);
    for (const p of s.timeline) {
      if (!pages.has(p.path)) pages.set(p.path, { path: p.path, n: 0, loadSum: 0, loadN: 0, scoreSum: 0, scoreN: 0 });
      const a = pages.get(p.path); a.n += 1;
      if (p.loadSec != null && p.loadSec > 0) { a.loadSum += p.loadSec; a.loadN += 1; }
      if (p.score != null) { a.scoreSum += p.score; a.scoreN += 1; }
    }
  }
  return {
    date, sessions: sessions.length, singlePage: single, mobile, pc, byHour,
    referrers: [...refs.entries()].map(([host, n]) => ({ host, n })).sort((a, b) => b.n - a.n).slice(0, 15),
    pages: [...pages.values()].sort((a, b) => b.n - a.n).slice(0, 30).map((a) => ({ path: a.path, n: a.n, loadSec: a.loadN ? Math.round((a.loadSum / a.loadN) * 100) / 100 : null, score: a.scoreN ? Math.round(a.scoreSum / a.scoreN) : null })),
  };
}

/** 直近 48 時間のセッション一覧を取り込み、前回分と合わせて返す */
async function fetchClaritySessions(prev) {
  const end = new Date();
  const start = new Date(end.getTime() - 48 * 60 * 60 * 1000);
  const date = { start: start.toISOString(), end: end.toISOString() };
  const base = { sortBy: 0, start: date.start, end: date.end, count: 250 };
  const warnings = [];
  const all = await clarityMcp('/recordings/sample', { ...base, filters: { date } });
  if (!Array.isArray(all)) throw new Error('Clarity 内部 API: セッション一覧が配列ではありません');
  // 端末は本文に無いので、端末で絞った一覧と突き合わせる（失敗しても「不明」で続ける）
  const deviceSets = {};
  for (const dev of ['Mobile', 'PC']) {
    try {
      const list = await clarityMcp('/recordings/sample', { ...base, filters: { date, deviceType: [dev] } });
      deviceSets[dev] = new Set((Array.isArray(list) ? list : []).map((s) => s.link));
    } catch (e) { warnings.push(`端末 ${dev} の絞り込み: ${e.message.slice(0, 120)}`); }
  }
  const deviceOf = (link) => (deviceSets.Mobile && deviceSets.Mobile.has(link) ? 'Mobile' : deviceSets.PC && deviceSets.PC.has(link) ? 'PC' : deviceSets.Mobile && deviceSets.PC ? 'Other' : '');
  const fetched = all.map((s) => compactClaritySession(s, deviceOf(s.link)));

  // セッション一覧: リンクで重複を除き、日ごとに新しい順で上限まで、保持日数ぶんだけ残す
  const byId = new Map((prev.sessions || []).map((s) => [s.id, s]));
  for (const s of fetched) byId.set(s.id, s);
  const cutoff = daysAgo(CLARITY_SESSION_DAYS);
  const perDay = new Map();
  for (const s of byId.values()) { if (s.date < cutoff) continue; if (!perDay.has(s.date)) perDay.set(s.date, []); perDay.get(s.date).push(s); }
  const sessions = [];
  for (const list of perDay.values()) { list.sort((a, b) => String(b.ts).localeCompare(String(a.ts))); sessions.push(...list.slice(0, CLARITY_SESSIONS_PER_DAY)); }
  sessions.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));

  // 日別集計: 今回取れた日付ぶんを作り直す（当日分は翌朝また作り直される）
  const fetchedByDate = new Map();
  for (const s of fetched) { if (!fetchedByDate.has(s.date)) fetchedByDate.set(s.date, []); fetchedByDate.get(s.date).push(s); }
  let stats = (prev.sessionStats || []).filter((d) => !fetchedByDate.has(d.date));
  for (const [d, list] of fetchedByDate) stats.push(clarityDayStats(d, list));
  stats = stats.sort((a, b) => a.date.localeCompare(b.date)).slice(-CLARITY_SESSION_STATS_DAYS);

  return { sessions, sessionStats: stats, sessionsFetchedOn: daysAgo(0), sessionWarnings: warnings };
}

async function fetchClarity() {
  const date = daysAgo(1);
  const prev = loadPreviousClarity() || {};
  const hasToday = (list) => Array.isArray(list) && list.some((d) => d.date === date);
  // 同じ日の分をすでに取り込み済みなら API を呼ばない（1 日 10 回の上限を手動実行で使い切らないため）
  const needBase = !(prev.latest && prev.latest.date === date);
  const needDims = CLARITY_DIMENSIONS.filter((d) => !hasToday(prev[d.key]));
  const needSessions = prev.sessionsFetchedOn !== daysAgo(0);
  if (!needBase && !needDims.length && !needSessions) {
    console.log(`  ${date} 分は取得済みのため API 呼び出しを省略しました`);
    return { ...prev, warnings: [] };
  }

  const out = {
    latest: prev.latest || null,
    breakdown: prev.breakdown || null,
    history: prev.history || [],
    byUrl: prev.byUrl || [],
    byDevice: prev.byDevice || [],
    byChannel: prev.byChannel || [],
    sessions: prev.sessions || [],
    sessionStats: prev.sessionStats || [],
    sessionsFetchedOn: prev.sessionsFetchedOn || null,
    warnings: [],
  };

  // 1) サイト全体（失敗したら例外。呼び出し元が前回分で表示を続ける）
  if (needBase) {
    const { snapshot, breakdown } = claritySnapshot(await clarityRequest({}), date);
    out.latest = snapshot;
    out.breakdown = breakdown;
    out.history = appendClarityDay(out.history, snapshot, CLARITY_HISTORY_DAYS);
  }

  // 2) 内訳（URL / 端末 / 流入元）。1 つ失敗しても他は続ける
  for (const d of needDims) {
    try {
      const rows = clarityDimensionRows(await clarityRequest({ dimension1: d.dim }), d.dim, d.limit);
      out[d.key] = appendClarityDay(out[d.key], { date, rows }, d.keepDays);
    } catch (e) {
      console.warn(`  Clarity ${d.dim} 別の取得に失敗: ${e.message.slice(0, 160)}`);
      out.warnings.push(`${d.dim} 別: ${e.message.slice(0, 160)}`);
    }
  }

  // 3) セッション一覧（内部 API。失敗しても前回分を残す）
  if (needSessions) {
    try {
      const r = await fetchClaritySessions(prev);
      Object.assign(out, { sessions: r.sessions, sessionStats: r.sessionStats, sessionsFetchedOn: r.sessionsFetchedOn });
      out.warnings.push(...r.sessionWarnings.map((w) => `セッション一覧: ${w}`));
    } catch (e) {
      console.warn(`  Clarity セッション一覧の取得に失敗: ${e.message.slice(0, 160)}`);
      out.warnings.push(`セッション一覧: ${e.message.slice(0, 160)}`);
    }
  }
  return out;
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
    gbp: null,
    clarity: null,
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

  console.log('Google ビジネスプロフィールからデータを取得中...');
  try {
    output.gbp = await fetchGbp();
    console.log(
      `  通話 ${output.gbp.current.calls} / 経路 ${output.gbp.current.directions} / サイトクリック ${output.gbp.current.websiteClicks}（${output.gbp.range.start}〜${output.gbp.range.end}）`
    );
  } catch (e) {
    console.error(`ビジネスプロフィールの取得に失敗: ${e.message}`);
    output.errors.gbp = e.message.slice(0, 500);
  }

  if (CLARITY_TOKEN) {
    console.log('Microsoft Clarity からデータを取得中...');
    try {
      output.clarity = await fetchClarity();
      const c = output.clarity;
      console.log(`  前日: セッション ${c.latest.sessions} / スクロール深度 ${c.latest.scrollDepth}% / 怒りクリック ${c.latest.rageClicks}（履歴 ${c.history.length} 日分、URL 別 ${c.byUrl.length} 日分、端末別 ${c.byDevice.length} 日分、流入元別 ${c.byChannel.length} 日分、セッション一覧 ${(c.sessions || []).length} 件）`);
      if (c.warnings && c.warnings.length) output.errors.clarityBreakdown = c.warnings.join(' / ').slice(0, 500);
    } catch (e) {
      console.error(`Clarity の取得に失敗: ${e.message}`);
      output.errors.clarity = e.message.slice(0, 500);
      // 失敗しても履歴は失わない
      const prev = loadPreviousClarity();
      if (prev && prev.latest) output.clarity = { ...prev, warnings: [] };
    }
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
