#!/usr/bin/env node
/**
 * ビジネスプロフィール API 用の OAuth 認可を一度だけ行い、リフレッシュトークンを表示する。
 *
 * サービスアカウントはビジネスプロフィールの招待を承諾できない（API が FAILED_PRECONDITION を返す）ため、
 * 店舗のオーナー/管理者である運営者の Google アカウントで認可し、そのトークンでダッシュボードが取得する。
 *
 * 使い方（手順の全体は docs/ops/gbp-oauth-setup.md）:
 *   GBP_CLIENT_ID='xxx.apps.googleusercontent.com' GBP_CLIENT_SECRET='yyy' node scripts/gbp-oauth-setup.js
 *   → 表示された URL をブラウザで開き、店舗を管理している Google アカウントでログインして許可する
 *   → ターミナルにリフレッシュトークンと、GitHub Secrets に登録するコマンドが出る
 *
 * 依存パッケージなし。リダイレクト先は http://127.0.0.1:8787/（「デスクトップ アプリ」種別の OAuth クライアントで使える）
 */
const http = require('http');

const CLIENT_ID = process.env.GBP_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GBP_CLIENT_SECRET || '';
const PORT = Number(process.env.PORT || 8787);
const REDIRECT_URI = `http://127.0.0.1:${PORT}/`;
const SCOPE = 'https://www.googleapis.com/auth/business.manage';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('GBP_CLIENT_ID と GBP_CLIENT_SECRET を環境変数で渡してください（Google Cloud の OAuth クライアント「デスクトップ アプリ」）。');
  process.exit(1);
}

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT_URI,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent', // 毎回リフレッシュトークンを返させる
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (url.pathname !== '/') { res.writeHead(404); res.end(); return; }
  const code = url.searchParams.get('code');
  const err = url.searchParams.get('error');
  if (err || !code) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`認可に失敗しました: ${err || 'code がありません'}`);
    console.error('認可に失敗:', err);
    server.close(); return;
  }
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' }),
    });
    const tok = await r.json();
    if (!r.ok || !tok.refresh_token) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('トークンの取得に失敗しました。ターミナルを確認してください。');
      console.error('トークン応答:', JSON.stringify(tok).slice(0, 500));
      console.error('refresh_token が無い場合は、Google アカウントの「サードパーティのアプリとサービス」でこのアプリの接続を解除してからやり直してください。');
      server.close(); return;
    }
    // 取れたトークンで、見える店舗を確認（ここで店舗が出れば権限は足りている）
    let locInfo = '';
    try {
      const acc = await (await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
      const names = [];
      for (const a of acc.accounts || []) {
        const loc = await (await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?readMask=name,title&pageSize=20`, { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
        for (const l of loc.locations || []) names.push(`${l.title}（${l.name}）`);
      }
      locInfo = names.length ? `見える店舗: ${names.join(' / ')}` : '見える店舗がありません（このアカウントは店舗のオーナー/管理者ではない可能性）';
    } catch (e) { locInfo = `店舗一覧の確認に失敗: ${e.message.slice(0, 200)}`; }

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('認可できました。この画面は閉じて、ターミナルに戻ってください。');
    console.log('\n認可できました。');
    console.log(locInfo);
    console.log('\n次のコマンドで GitHub Secrets に登録してください（値は表示しないように入力します）:');
    console.log(`  gh secret set GBP_CLIENT_ID --body '${CLIENT_ID}'`);
    console.log("  gh secret set GBP_CLIENT_SECRET   # 続けて貼り付け → Enter → Ctrl-D");
    console.log("  gh secret set GBP_REFRESH_TOKEN   # 続けて貼り付け → Enter → Ctrl-D");
    console.log('\nリフレッシュトークン（この行は他人に見せない。git にも書かない）:');
    console.log(tok.refresh_token);
    console.log('\n登録後: gh workflow run update-dashboard.yml で取得を確認できます。');
  } catch (e) {
    console.error('エラー:', e.message);
  } finally {
    server.close();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('ブラウザで次の URL を開き、店舗を管理している Google アカウントで許可してください:\n');
  console.log(authUrl + '\n');
  console.log(`（${REDIRECT_URI} で待ち受け中。許可が終わると自動で続きます）`);
});
