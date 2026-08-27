/**
 * Decap CMS用 GitHub OAuth コールバックエンドポイント（Vercelサーバーレス関数）
 *
 * GitHubの認可後にリダイレクトされ、codeをアクセストークンに交換し、
 * Decap CMSが期待するpostMessageハンドシェイクで管理画面（window.opener）へ返す。
 *
 * 必要な環境変数（Vercelのプロジェクト設定で登録）:
 *   - OAUTH_GITHUB_CLIENT_ID
 *   - OAUTH_GITHUB_CLIENT_SECRET
 */

// 管理画面（window.opener）として許可するオリジン
// 本番サイトはGitHub Pages配信のため、このAPI（Vercel）とはオリジンが異なる
const ALLOWED_ORIGINS = [
  'https://www.minoru-dental.jp',
  'https://minoru-dental.jp',
  'https://minoru-dental.vercel.app',
];

function renderPostMessagePage(res, status, message) {
  // Decap CMSのハンドシェイク:
  //   1. このページが opener へ 'authorizing:github' を送る
  //   2. openerが応答メッセージを返す
  //   3. このページが 'authorization:github:success:{...}' を送る
  const html = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>認証処理中...</title></head>
<body>
<p>認証処理中です。この画面が閉じない場合は、管理画面に戻ってやり直してください。</p>
<script>
  (function () {
    var allowedOrigins = ${JSON.stringify(ALLOWED_ORIGINS)};
    var message = ${JSON.stringify(`authorization:github:${status}:${message}`)};
    function receiveMessage(e) {
      if (allowedOrigins.indexOf(e.origin) === -1) return;
      window.opener.postMessage(message, e.origin);
      window.removeEventListener('message', receiveMessage, false);
    }
    if (window.opener) {
      window.addEventListener('message', receiveMessage, false);
      // openerのオリジンはクロスオリジンのため読めない。許可リスト全てに通知し、
      // 実際に応答してきたオリジン（許可リスト内）へのみトークンを渡す
      allowedOrigins.forEach(function (origin) {
        window.opener.postMessage('authorizing:github', origin);
      });
    }
  })();
</script>
</body>
</html>`;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // 使用済みstate Cookieを削除
  res.setHeader('Set-Cookie', 'oauth_state=; HttpOnly; Secure; Path=/api; Max-Age=0; SameSite=Lax');
  res.end(html);
}

module.exports = async (req, res) => {
  const clientId = process.env.OAUTH_GITHUB_CLIENT_ID;
  const clientSecret = process.env.OAUTH_GITHUB_CLIENT_SECRET;
  const host = req.headers['x-forwarded-host'] || req.headers.host;

  if (!clientId || !clientSecret) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('サーバー設定エラー: OAuth用の環境変数が未設定です');
    return;
  }

  const url = new URL(req.url, `https://${host}`);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieMatch = (req.headers.cookie || '').match(/(?:^|;\s*)oauth_state=([^;]+)/);
  const cookieState = cookieMatch ? cookieMatch[1] : null;

  // CSRF対策: stateとCookieの照合
  if (!code || !state || !cookieState || state !== cookieState) {
    renderPostMessagePage(res, 'error', JSON.stringify({ error: '不正なリクエストです（stateが一致しません）' }));
    return;
  }

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });
    const data = await tokenRes.json();

    if (data.error || !data.access_token) {
      renderPostMessagePage(
        res,
        'error',
        JSON.stringify({ error: data.error_description || data.error || 'トークンの取得に失敗しました' })
      );
      return;
    }

    renderPostMessagePage(
      res,
      'success',
      JSON.stringify({ token: data.access_token, provider: 'github' })
    );
  } catch (err) {
    renderPostMessagePage(
      res,
      'error',
      JSON.stringify({ error: 'GitHubとの通信に失敗しました' })
    );
  }
};
