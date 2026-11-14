#!/usr/bin/env node
/**
 * 記事下書きの確認メール（HTML）を生成して標準出力に出す。
 * メール本文に記事の全文を入れ、公開・没は GitHub の PR ページで行う（Vercel 不要の方式）。
 *
 * 使い方: node scripts/render-review-email.js <slug> <PR番号> <ブランチ名>
 */
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const [slug, pr, branch] = process.argv.slice(2);
if (!slug || !pr || !branch) { console.error('使い方: render-review-email.js <slug> <PR番号> <ブランチ名>'); process.exit(1); }

const ROOT = path.resolve(__dirname, '..');
const REPO = process.env.GITHUB_REPOSITORY || 'ttksaito/minoru-dental';
const md = fs.readFileSync(path.join(ROOT, 'content', 'blog', `${slug}.md`), 'utf8');
const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
const meta = {};
if (m) for (const line of m[1].split('\n')) { const i = line.indexOf(':'); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, ''); }
const body = m ? m[2] : md;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const prUrl = `https://github.com/${REPO}/pull/${pr}`;
const thumb = `https://raw.githubusercontent.com/${REPO}/${encodeURIComponent(branch)}/blog/uploads/${slug}.png`;
const cms = 'https://www.minoru-dental.jp/admin/#/workflow';
const notesPath = path.join(ROOT, 'content', '.draft-notes', `${slug}.md`);
const notes = fs.existsSync(notesPath) ? esc(fs.readFileSync(notesPath, 'utf8')).replace(/\n/g, '<br>') : '';

// Gmail 向けにインラインスタイルを付ける
let html = marked.parse(body);
const styles = {
  h2: 'font-size:18px;line-height:1.4;margin:28px 0 10px;padding-left:10px;border-left:4px solid #4caf50;color:#243126',
  h3: 'font-size:16px;margin:22px 0 8px;color:#243126',
  p: 'margin:0 0 14px;line-height:1.8',
  ul: 'margin:0 0 14px;padding-left:22px', ol: 'margin:0 0 14px;padding-left:22px', li: 'margin:4px 0;line-height:1.7',
  a: 'color:#388e3c', blockquote: 'margin:0 0 14px;padding:8px 14px;border-left:4px solid #ddd;color:#666',
  img: 'max-width:100%;height:auto', table: 'border-collapse:collapse;margin:0 0 14px', td: 'border:1px solid #ddd;padding:6px 10px', th: 'border:1px solid #ddd;padding:6px 10px;background:#f5f5f5',
};
for (const [tag, st] of Object.entries(styles)) html = html.replace(new RegExp(`<${tag}(\\s|>)`, 'g'), `<${tag} style="${st}"$1`);

const tags = (meta.tags || '').split(',').map((s) => s.trim()).filter(Boolean);
const btn = (href, label, bg, color, border = 'none') =>
  `<a href="${href}" style="display:block;background:${bg};color:${color};border:${border};text-decoration:none;font-weight:bold;padding:14px 20px;border-radius:999px;font-size:16px;text-align:center;margin:0 0 10px">${label}</a>`;

const actions = `
  <div style="background:#fff;border:1px solid #e5e2dc;border-radius:12px;padding:16px;margin:24px 0">
    <p style="margin:0 0 12px;font-size:14px;color:#555;line-height:1.6">読み終えたら、下のボタンから GitHub のページを開いて操作します（GitHub にログインが必要です）。</p>
    ${btn(prUrl, '公開する → 緑の「Merge pull request」を押す', 'linear-gradient(135deg,#ff6b35,#ff8563)', '#fff')}
    ${btn(prUrl, '没にする → 下の方の「Close pull request」を押す', '#fff', '#777', '1px solid #ccc')}
    ${btn(prUrl + '#new_comment_field', '文章やサムネを直したい → コメントで AI に頼む', '#fff', '#388e3c', '1px solid #4caf50')}
    <p style="margin:8px 0 0;font-size:12px;color:#888;line-height:1.6">「Merge pull request」→「Confirm merge」の 2 回押しで公開され、3〜5 分で本番に反映されます。</p>
    <p style="margin:10px 0 0;font-size:13px;color:#555;line-height:1.6;background:#f7faf7;padding:8px 12px;border-radius:8px">✏️ <b>直したいとき</b>: GitHub ページの一番下のコメント欄に日本語で書くだけです。<br>・文章: 「3 段落目を短く」「タイトルに東松山市を入れて」<br>・サムネの文字: 「サムネの文字を『日曜に歯が痛い！東松山の相談先』にして」<br>・サムネの画像: 写真を添付して「サムネはこれにして」<br>AI が 1 時間以内に直して、修正版のメールを送り直します。何回でも続けられます。<span style="color:#999">（手で直したい場合は <a href="${cms}" style="color:#999">CMS</a> も使えます）</span></p>
  </div>`;

process.stdout.write(`
<div style="font-family:-apple-system,'Hiragino Sans','Hiragino Kaku Gothic ProN',Meiryo,sans-serif;max-width:640px;margin:0 auto;color:#333;font-size:16px;line-height:1.8;background:#f5f3f0;padding:12px">
  <p style="font-size:13px;color:#388e3c;margin:0 0 6px">みのる歯科ブログ　AI 下書きができました（PR #${esc(pr)}）</p>
  <div style="background:#fff;border-radius:12px;padding:18px 16px">
    <p style="font-size:13px;color:#777;margin:0 0 6px">${esc(meta.date || '')}　${tags.map((t) => `<span style="background:#e8f5e9;color:#388e3c;border-radius:999px;padding:1px 10px;font-size:12px;margin-right:6px">${esc(t)}</span>`).join('')}</p>
    <h1 style="font-size:22px;line-height:1.4;margin:0 0 12px;color:#243126">${esc(meta.title || slug)}</h1>
    <img src="${thumb}" alt="" style="width:100%;height:auto;border-radius:10px;display:block;margin:0 0 14px;background:#eee">
    ${meta.summary ? `<p style="background:#f7faf7;border-left:4px solid #4caf50;padding:10px 14px;font-size:14px;color:#555;margin:0 0 20px">${esc(meta.summary)}</p>` : ''}
    ${html}
    <p style="font-size:12px;color:#888;margin:16px 0 0">サムネイルは仮のものです。差し替えたい場合は CMS から。</p>
  </div>
  ${actions}
  <details style="font-size:12px;color:#666;background:#fff;border-radius:12px;padding:12px 16px"><summary style="cursor:pointer">AI の調査メモ（選んだ理由・参考 URL・自己確認）</summary><div style="margin-top:8px;line-height:1.6">${notes}</div></details>
</div>`);
