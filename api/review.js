/**
 * 記事下書きのスマホ確認・公開エンドポイント（Vercelサーバーレス関数）
 *
 * メールで届くリンク  GET  /api/review?pr=<PR番号>&t=<トークン>
 *   → 下書きをサイト風に表示し、下部に「公開する」「没にする」ボタンを出す
 * ボタン             POST /api/review  (pr, t, action=publish|reject)
 *   → publish: PR をマージ（= 公開。GitHub Actions が自動ビルドして本番反映）
 *   → reject : PR をクローズしてブランチを削除
 *
 * トークンは HMAC-SHA256(REVIEW_SECRET, "pr:<番号>") の先頭 32 文字。
 * メールのリンクを持っている人だけが操作できる。対象は cms/blog/ ブランチの PR に限定。
 *
 * 必要な環境変数（Vercel のプロジェクト設定で登録）:
 *   - REVIEW_SECRET          … GitHub Secrets の REVIEW_SECRET と同じ値
 *   - GITHUB_PUBLISH_TOKEN   … マージ・クローズに使う GitHub トークン（このリポジトリの Contents / Pull requests 書き込み）
 */
const crypto = require('crypto');
const { marked } = require('marked');

const OWNER = 'ttksaito';
const REPO = 'minoru-dental';
const SITE = 'https://www.minoru-dental.jp';
const CMS_WORKFLOW = `${SITE}/admin/#/workflow`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function makeToken(pr) {
  return crypto.createHmac('sha256', process.env.REVIEW_SECRET).update(`pr:${pr}`).digest('hex').slice(0, 32);
}
function tokenOk(pr, t) {
  if (!t || typeof t !== 'string') return false;
  const a = Buffer.from(makeToken(pr));
  const b = Buffer.from(t);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function gh(path, init = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'minoru-dental-review',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(init.headers || {}),
  };
  if (process.env.GITHUB_PUBLISH_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_PUBLISH_TOKEN}`;
  const res = await fetch(`https://api.github.com${path}`, { ...init, headers });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`GitHub API ${res.status}: ${(data && data.message) || text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function parseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: md };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body: m[2] };
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const raw = typeof req.body === 'string' ? req.body : await new Promise((resolve) => {
    let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => resolve(s));
  });
  return Object.fromEntries(new URLSearchParams(raw));
}

function page(title, inner, extraHead = '') {
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title>
<style>
  :root{--g:#4caf50;--g2:#388e3c;--o:#ff6b35;--ink:#333;--bg:#f5f3f0}
  *{box-sizing:border-box}body{margin:0;font-family:'Hiragino Sans','Hiragino Kaku Gothic ProN',Meiryo,sans-serif;color:var(--ink);background:var(--bg);line-height:1.8;font-size:16px}
  .top{background:#fff;border-bottom:1px solid #e5e2dc;padding:10px 16px;font-size:13px;color:#666;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
  .top b{color:var(--g2)}
  .wrap{max-width:720px;margin:0 auto;padding:16px 16px 120px}
  .card{background:#fff;border-radius:12px;padding:20px 18px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
  .meta{font-size:13px;color:#777;margin:0 0 8px}.tag{display:inline-block;background:#e8f5e9;color:var(--g2);border-radius:999px;padding:1px 10px;font-size:12px;margin-right:6px}
  h1{font-size:22px;line-height:1.4;margin:6px 0 12px;color:#243126}
  .thumb{width:100%;height:auto;border-radius:10px;margin:8px 0 16px;display:block;background:#eee}
  .summary{background:#f7faf7;border-left:4px solid var(--g);padding:10px 14px;font-size:14px;color:#555;margin:0 0 20px}
  article h2{font-size:19px;margin:28px 0 10px;padding-left:10px;border-left:4px solid var(--g);line-height:1.4}
  article h3{font-size:17px;margin:22px 0 8px}article p{margin:0 0 14px}article ul,article ol{padding-left:22px}article li{margin:4px 0}article a{color:var(--g2)}
  article img{max-width:100%;height:auto}
  .bar{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid #e5e2dc;padding:10px 16px calc(10px + env(safe-area-inset-bottom));display:flex;gap:10px;justify-content:center}
  .bar form{flex:1;max-width:260px;margin:0}
  .btn{display:block;width:100%;border:0;border-radius:999px;padding:14px 10px;font:inherit;font-weight:700;font-size:16px;cursor:pointer;text-align:center;text-decoration:none}
  .btn.pub{background:linear-gradient(135deg,var(--o),#ff8563);color:#fff}.btn.rej{background:#fff;color:#777;border:1px solid #ccc}
  .btn.sec{background:#fff;color:var(--g2);border:1px solid var(--g)}
  .note{font-size:13px;color:#777;margin:14px 0 0}
  .done{text-align:center;padding:40px 10px}.done h1{font-size:22px}.done p{color:#555}
  .links{display:flex;flex-direction:column;gap:10px;margin:20px auto 0;max-width:320px}
</style>${extraHead}</head><body>${inner}</body></html>`;
}

function sendHtml(res, status, html) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(html);
}

module.exports = async (req, res) => {
  if (!process.env.REVIEW_SECRET) {
    return sendHtml(res, 500, page('設定エラー', `<div class="wrap"><div class="card done"><h1>サーバー設定エラー</h1><p>Vercel の環境変数 REVIEW_SECRET が未設定です。</p></div></div>`));
  }
  const url = new URL(req.url, 'http://x');
  const isPost = req.method === 'POST';
  const form = isPost ? await readBody(req) : {};
  const pr = Number(isPost ? form.pr : url.searchParams.get('pr'));
  const t = isPost ? form.t : url.searchParams.get('t');
  const action = isPost ? form.action : null;

  if (!Number.isInteger(pr) || pr <= 0 || !tokenOk(pr, t)) {
    return sendHtml(res, 403, page('リンクが無効です', `<div class="wrap"><div class="card done"><h1>リンクが無効です</h1><p>メールに届いたリンクをそのまま開いてください。</p></div></div>`));
  }

  let prData;
  try {
    prData = await gh(`/repos/${OWNER}/${REPO}/pulls/${pr}`);
  } catch (e) {
    return sendHtml(res, 502, page('取得エラー', `<div class="wrap"><div class="card done"><h1>下書きを取得できませんでした</h1><p>${esc(e.message)}</p></div></div>`));
  }
  const branch = prData.head.ref;
  if (!branch.startsWith('cms/blog/')) {
    return sendHtml(res, 403, page('対象外', `<div class="wrap"><div class="card done"><h1>この PR は記事の下書きではありません</h1></div></div>`));
  }
  const slug = branch.slice('cms/blog/'.length);
  const articleUrl = `${SITE}/blog/${slug}/`;

  // すでに処理済み
  if (prData.merged || prData.state !== 'open') {
    const merged = prData.merged;
    return sendHtml(res, 200, page(merged ? '公開済み' : '没にしました', `<div class="wrap"><div class="card done">
      <h1>${merged ? 'この記事は公開済みです' : 'この下書きは没にしました'}</h1>
      ${merged ? `<p>反映には数分かかります。</p><div class="links"><a class="btn sec" href="${esc(articleUrl)}">記事を見る</a></div>` : '<p>再度使いたい場合は CMS から新しく作成してください。</p>'}
    </div></div>`));
  }

  if (isPost && action === 'publish') {
    if (!process.env.GITHUB_PUBLISH_TOKEN) {
      return sendHtml(res, 500, page('設定エラー', `<div class="wrap"><div class="card done"><h1>サーバー設定エラー</h1><p>Vercel の環境変数 GITHUB_PUBLISH_TOKEN が未設定です。CMS から公開してください。</p><div class="links"><a class="btn sec" href="${CMS_WORKFLOW}">CMS を開く</a></div></div></div>`));
    }
    try {
      await gh(`/repos/${OWNER}/${REPO}/pulls/${pr}/merge`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merge_method: 'merge', commit_title: `記事を公開: ${slug}` }),
      });
      try { await gh(`/repos/${OWNER}/${REPO}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'DELETE' }); } catch (e) { /* ブランチ削除は任意 */ }
    } catch (e) {
      return sendHtml(res, 502, page('公開に失敗', `<div class="wrap"><div class="card done"><h1>公開に失敗しました</h1><p>${esc(e.message)}</p><p>CMS の「公開」から公開できます。</p><div class="links"><a class="btn sec" href="${CMS_WORKFLOW}">CMS を開く</a></div></div></div>`));
    }
    return sendHtml(res, 200, page('公開しました', `<div class="wrap"><div class="card done">
      <h1>公開しました</h1><p>自動ビルドが走り、3〜5 分ほどで本番サイトに表示されます。</p>
      <div class="links"><a class="btn pub" href="${esc(articleUrl)}">記事を見る（数分後）</a><a class="btn sec" href="${SITE}/blog.html">ブログ一覧</a></div>
    </div></div>`));
  }

  if (isPost && action === 'reject') {
    if (!process.env.GITHUB_PUBLISH_TOKEN) {
      return sendHtml(res, 500, page('設定エラー', `<div class="wrap"><div class="card done"><h1>サーバー設定エラー</h1><p>Vercel の環境変数 GITHUB_PUBLISH_TOKEN が未設定です。</p></div></div>`));
    }
    try {
      await gh(`/repos/${OWNER}/${REPO}/pulls/${pr}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'closed' }) });
      try { await gh(`/repos/${OWNER}/${REPO}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'DELETE' }); } catch (e) { /* 任意 */ }
    } catch (e) {
      return sendHtml(res, 502, page('失敗', `<div class="wrap"><div class="card done"><h1>処理に失敗しました</h1><p>${esc(e.message)}</p></div></div>`));
    }
    return sendHtml(res, 200, page('没にしました', `<div class="wrap"><div class="card done"><h1>没にしました</h1><p>この下書きは削除されました。次の下書きは 3 日以内に届きます。</p></div></div>`));
  }

  // ---- プレビュー表示（GET）
  const sha = prData.head.sha;
  const rawBase = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${sha}`;
  let md;
  try {
    const r = await fetch(`${rawBase}/content/blog/${slug}.md`);
    if (!r.ok) throw new Error(`記事ファイルが見つかりません (${r.status})`);
    md = await r.text();
  } catch (e) {
    return sendHtml(res, 502, page('取得エラー', `<div class="wrap"><div class="card done"><h1>下書きを読み込めませんでした</h1><p>${esc(e.message)}</p></div></div>`));
  }
  const { meta, body } = parseFrontmatter(md);
  const tags = (meta.tags || '').split(',').map((s) => s.trim()).filter(Boolean);
  const image = meta.image ? (meta.image.startsWith('http') ? meta.image : `${rawBase}/${meta.image.replace(/^\//, '')}`) : '';
  const html = marked.parse(body);
  const hidden = `<input type="hidden" name="pr" value="${pr}"><input type="hidden" name="t" value="${esc(t)}">`;

  return sendHtml(res, 200, page(`確認: ${meta.title || slug}`, `
    <div class="top"><span><b>みのる歯科ブログ</b> 下書きの確認</span><span>PR #${pr}</span></div>
    <div class="wrap"><div class="card">
      <p class="meta">${esc(meta.date || '')}　${tags.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</p>
      <h1>${esc(meta.title || slug)}</h1>
      ${image ? `<img class="thumb" src="${esc(image)}" alt="">` : ''}
      ${meta.summary ? `<p class="summary">${esc(meta.summary)}</p>` : ''}
      <article>${html}</article>
      <p class="note">文章を直したい場合は <a href="${CMS_WORKFLOW}">CMS のワークフロー</a> から編集できます（直したあと、そこで「公開」も押せます）。サムネイルは仮のものです。差し替えたい場合も CMS から。</p>
    </div></div>
    <div class="bar">
      <form method="post" action="/api/review" onsubmit="return confirm('この記事を公開します。よろしいですか？')">${hidden}<input type="hidden" name="action" value="publish"><button class="btn pub" type="submit">公開する</button></form>
      <form method="post" action="/api/review" onsubmit="return confirm('この下書きを没にします（削除）。よろしいですか？')">${hidden}<input type="hidden" name="action" value="reject"><button class="btn rej" type="submit">没にする</button></form>
    </div>`));
};
