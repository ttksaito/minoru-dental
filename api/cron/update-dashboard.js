/**
 * 集客ダッシュボード更新の起動エンドポイント（Vercel サーバーレス関数）
 *
 * GitHub Actions の schedule は混雑時に数時間遅れる（実測で 2〜6 時間）ため、
 * 時刻が正確な Vercel Cron（vercel.json の crons）から毎朝ここを叩き、
 * GitHub の repository_dispatch で update-dashboard.yml を起動する。
 *
 * GET /api/cron/update-dashboard
 *   ヘッダ Authorization: Bearer <CRON_SECRET>（Vercel Cron が自動で付ける）
 *
 * 必要な環境変数（Vercel のプロジェクト設定で登録）:
 *   - CRON_SECRET            … ランダムな長い文字列。これが無いと誰でも起動できてしまうので必須
 *   - GITHUB_PUBLISH_TOKEN   … GitHub の Fine-grained personal access token
 *                              （対象リポジトリ minoru-dental のみ、Contents: Read and write）
 *                              api/review.js と共用
 */
const crypto = require('crypto');

const OWNER = 'ttksaito';
const REPO = 'minoru-dental';
const EVENT_TYPE = 'update-dashboard'; // update-dashboard.yml の repository_dispatch.types と合わせる

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (!process.env.CRON_SECRET) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: 'CRON_SECRET が未設定です（Vercel の環境変数に登録してください）' }));
    return;
  }
  if (!authorized(req)) {
    res.statusCode = 401;
    res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    return;
  }
  const token = process.env.GITHUB_PUBLISH_TOKEN;
  if (!token) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: 'GITHUB_PUBLISH_TOKEN が未設定です（Vercel の環境変数に登録してください）' }));
    return;
  }

  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/dispatches`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'minoru-dental-cron',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ event_type: EVENT_TYPE, client_payload: { source: 'vercel-cron', at: new Date().toISOString() } }),
  });

  if (r.status === 204) {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, dispatched: EVENT_TYPE, at: new Date().toISOString() }));
    return;
  }
  const text = await r.text();
  console.error(`repository_dispatch failed: ${r.status} ${text.slice(0, 300)}`);
  res.statusCode = 502;
  res.end(JSON.stringify({ ok: false, error: `GitHub API ${r.status}`, detail: text.slice(0, 300) }));
};
