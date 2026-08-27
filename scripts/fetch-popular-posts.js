#!/usr/bin/env node
/**
 * GA4 Data API からブログ記事の閲覧数を集計し、
 * popular-posts.json を生成するスクリプト
 *
 * 認証は GitHub Actions + Workload Identity Federation を使用。
 *
 * 必要な環境変数:
 *   GA4_PROPERTY_ID   … GA4のプロパティID
 *   GA4_ACCESS_TOKEN  … GitHub ActionsのWIF認証で取得した一時アクセストークン
 */

const fs = require('fs');
const path = require('path');

const PROPERTY_ID = process.env.GA4_PROPERTY_ID;
const ACCESS_TOKEN = process.env.GA4_ACCESS_TOKEN;

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
        dateRanges: [
          {
            startDate: `${DATE_RANGE_DAYS}daysAgo`,
            endDate: 'today',
          },
        ],
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }],
        dimensionFilter: {
          filter: {
            fieldName: 'pagePath',
            stringFilter: {
              matchType: 'BEGINS_WITH',
              value: '/blog/',
            },
          },
        },
        limit: 1000,
      }),
    }
  );

  if (!res.ok) {
    fail(
      `GA4 Data API の呼び出しに失敗しました (${res.status}): ${await res.text()}`
    );
  }

  return res.json();
}

/** pagePath から記事IDを抽出 */
function extractArticleId(pagePath) {
  const match = pagePath.match(
    /^\/blog\/([^\/?#]+)\/?(?:index\.html)?(?:[?#].*)?$/
  );

  return match ? decodeURIComponent(match[1]) : null;
}

async function main() {
  if (!PROPERTY_ID) {
    fail('環境変数 GA4_PROPERTY_ID が設定されていません');
  }

  if (!ACCESS_TOKEN) {
    fail('環境変数 GA4_ACCESS_TOKEN が設定されていません');
  }

  // 実在する記事IDの一覧を blog-posts.json から取得
  const blogPosts = JSON.parse(
    fs.readFileSync(BLOG_POSTS_PATH, 'utf8')
  );

  const validIds = new Set(
    blogPosts.posts.map((p) => p.id)
  );

  console.log(
    `GA4からページ閲覧データを取得中（直近${DATE_RANGE_DAYS}日）...`
  );

  const report = await fetchBlogPageViews(ACCESS_TOKEN);

  // 記事IDごとに閲覧数を合算
  const viewsById = new Map();

  for (const row of report.rows || []) {
    const pagePath = row.dimensionValues[0].value;
    const views =
      parseInt(row.metricValues[0].value, 10) || 0;

    const id = extractArticleId(pagePath);

    if (id && validIds.has(id)) {
      viewsById.set(
        id,
        (viewsById.get(id) || 0) + views
      );
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

  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(output, null, 2) + '\n',
    'utf8'
  );

  console.log(
    `popular-posts.json を更新しました（${ranking.length}件）:`
  );

  ranking.forEach((p, i) => {
    console.log(
      `  ${i + 1}. ${p.id} (${p.views} views)`
    );
  });
}

main().catch((err) => fail(err.message));
