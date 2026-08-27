#!/usr/bin/env node
/**
 * GA4 Data API からブログ記事の閲覧数を集計し、popular-posts.json を生成するスクリプト
 *
 * 依存パッケージなし（Node.js 18+ の標準機能のみ使用）
 *
 * 必要な環境変数:
 *   GA4_PROPERTY_ID          … GA4のプロパティID（数字。測定ID "G-..." ではない）
 *   GA4_SERVICE_ACCOUNT_KEY  … サービスアカウントキー(JSON)の中身をそのまま文字列で
 *
 * 実行例:
 *   GA4_PROPERTY_ID=123456789 GA4_SERVICE_ACCOUNT_KEY="$(cat key.json)" node scripts/fetch-popular-posts.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROPERTY_ID = process.env.GA4_PROPERTY_ID;
const SERVICE_ACCOUNT_KEY = process.env.GA4_SERVICE_ACCOUNT_KEY;

// 集計対象期間（直近90日）と表示件数
const DATE_RANGE_DAYS = 90;
const TOP_N = 5;

const ROOT = path.resolve(__dirname, '..');
const BLOG_POSTS_PATH = path.join(ROOT, 'blog-posts.json');
const OUTPUT_PATH = path.join(ROOT, 'popular-posts.json');

function fail(message) {
  console.error(`エラー: ${message}`);
  process.exit(1);
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** サービスアカウントキーからOAuth2アクセストークンを取得（JWT Bearer フロー） */
async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  );
  const signingInput = `${header}.${claims}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer
    .sign(serviceAccount.private_key)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const jwt = `${signingInput}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    fail(`アクセストークンの取得に失敗しました (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token;
}

/** GA4 Data API で /blog/ 配下のページ別閲覧数を取得 */
async function fetchBlogPageViews(accessToken) {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}:runReport`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: `${DATE_RANGE_DAYS}daysAgo`, endDate: 'today' }],
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }],
        dimensionFilter: {
          filter: {
            fieldName: 'pagePath',
            stringFilter: { matchType: 'BEGINS_WITH', value: '/blog/' },
          },
        },
        limit: 1000,
      }),
    }
  );

  if (!res.ok) {
    fail(`GA4 Data API の呼び出しに失敗しました (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

/** pagePath から記事IDを抽出（例: /blog/regular-checkup/ → regular-checkup） */
function extractArticleId(pagePath) {
  const match = pagePath.match(/^\/blog\/([^\/?#]+)\/?(?:index\.html)?(?:[?#].*)?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function main() {
  if (!PROPERTY_ID) fail('環境変数 GA4_PROPERTY_ID が設定されていません');
  if (!SERVICE_ACCOUNT_KEY) fail('環境変数 GA4_SERVICE_ACCOUNT_KEY が設定されていません');

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(SERVICE_ACCOUNT_KEY);
  } catch {
    fail('GA4_SERVICE_ACCOUNT_KEY がJSONとして解析できません');
  }

  // 実在する記事IDの一覧を blog-posts.json から取得
  const blogPosts = JSON.parse(fs.readFileSync(BLOG_POSTS_PATH, 'utf8'));
  const validIds = new Set(blogPosts.posts.map((p) => p.id));

  console.log('アクセストークンを取得中...');
  const accessToken = await getAccessToken(serviceAccount);

  console.log(`GA4からページ閲覧データを取得中（直近${DATE_RANGE_DAYS}日）...`);
  const report = await fetchBlogPageViews(accessToken);

  // 記事IDごとに閲覧数を合算（/blog/xxx/ と /blog/xxx/index.html を同一視）
  const viewsById = new Map();
  for (const row of report.rows || []) {
    const pagePath = row.dimensionValues[0].value;
    const views = parseInt(row.metricValues[0].value, 10) || 0;
    const id = extractArticleId(pagePath);
    if (id && validIds.has(id)) {
      viewsById.set(id, (viewsById.get(id) || 0) + views);
    }
  }

  const ranking = [...viewsById.entries()]
    .map(([id, views]) => ({ id, views }))
    .sort((a, b) => b.views - a.views)
    .slice(0, TOP_N);

  const output = {
    updated: new Date().toISOString().slice(0, 10),
    rangeDays: DATE_RANGE_DAYS,
    posts: ranking,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`popular-posts.json を更新しました（${ranking.length}件）:`);
  ranking.forEach((p, i) => console.log(`  ${i + 1}. ${p.id} (${p.views} views)`));
}

main().catch((err) => fail(err.message));
