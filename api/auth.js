/**
 * Decap CMS用 GitHub OAuth 認証開始エンドポイント（Vercelサーバーレス関数）
 *
 * /admin/ の「GitHubでログイン」から呼ばれ、GitHubの認可画面へリダイレクトする。
 * CSRF対策としてstateを発行し、HttpOnly Cookieに保存して /api/callback で照合する。
 *
 * 必要な環境変数（Vercelのプロジェクト設定で登録）:
 *   - OAUTH_GITHUB_CLIENT_ID
 */
const crypto = require('crypto');

module.exports = (req, res) => {
  const clientId = process.env.OAUTH_GITHUB_CLIENT_ID;
  if (!clientId) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('サーバー設定エラー: OAUTH_GITHUB_CLIENT_ID が未設定です');
    return;
  }

  const state = crypto.randomBytes(16).toString('hex');

  const params = new URLSearchParams({
    client_id: clientId,
    // OAuth Appの登録値と一致させるため固定（VercelのプロダクションURL）
    redirect_uri: 'https://minoru-dental.vercel.app/api/callback',
    scope: 'repo,user',
    state,
  });

  res.setHeader(
    'Set-Cookie',
    `oauth_state=${state}; HttpOnly; Secure; Path=/api; Max-Age=600; SameSite=Lax`
  );
  res.statusCode = 302;
  res.setHeader('Location', `https://github.com/login/oauth/authorize?${params.toString()}`);
  res.end();
};
