#!/usr/bin/env node
/**
 * 記事の仮サムネイル（1200×630 PNG）を生成する。
 * 医院の配色とタイトル文字だけのシンプルな画像。CMS から差し替える前提。
 *
 * 使い方: node scripts/make-thumbnail.js <記事スラッグ> [出力パス]
 *   既定の出力: blog/uploads/<slug>.png
 *   content/.thumb-overrides/<slug>.json があれば、その title / tags / sub を優先して描く
 *   （例: {"title": "日曜に歯が痛い！東松山の相談先", "tags": ["緊急時"], "sub": "休日の歯医者の探し方"}）
 * 必要なもの: Google Chrome / Chromium（環境変数 CHROME_BIN で指定可）
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const slug = process.argv[2];
if (!slug) { console.error('使い方: node scripts/make-thumbnail.js <slug> [出力パス]'); process.exit(1); }
const mdPath = path.join(ROOT, 'content', 'blog', `${slug}.md`);
if (!fs.existsSync(mdPath)) { console.error(`${mdPath} がありません`); process.exit(1); }
const out = path.resolve(ROOT, process.argv[3] || path.join('blog', 'uploads', `${slug}.png`));

const md = fs.readFileSync(mdPath, 'utf8');
const fm = (md.match(/^---\n([\s\S]*?)\n---/) || [, ''])[1];
const get = (k) => ((fm.match(new RegExp(`^${k}:\\s*(.*)$`, 'm')) || [, ''])[1] || '').trim().replace(/^["']|["']$/g, '');
let title = get('title') || slug;
let tags = get('tags').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 2);
let sub = '';
const overridePath = path.join(ROOT, 'content', '.thumb-overrides', `${slug}.json`);
if (fs.existsSync(overridePath)) {
  try {
    const o = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
    if (o.title) title = String(o.title);
    if (Array.isArray(o.tags)) tags = o.tags.map(String).slice(0, 2);
    if (o.sub) sub = String(o.sub);
    console.log(`上書き設定を使用: ${path.relative(ROOT, overridePath)}`);
  } catch (e) { console.warn(`上書き設定を読めませんでした: ${e.message}`); }
}

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  for (const name of ['google-chrome', 'chromium-browser', 'chromium']) {
    try { return execFileSync('which', [name]).toString().trim(); } catch (e) { /* 次へ */ }
  }
  throw new Error('Chrome が見つかりません。CHROME_BIN を設定してください');
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const logoPath = path.join(ROOT, 'image', 'logo.png');
const logo = fs.existsSync(logoPath) ? `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}` : '';
const titleSize = title.length > 40 ? 50 : title.length > 28 ? 58 : 68;

const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><style>
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
  body {
    font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans CJK JP", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif;
    background: linear-gradient(135deg, #e8f5e9 0%, #ffffff 55%, #f5f3f0 100%);
    position: relative; color: #2e3a2f;
  }
  .bar { position: absolute; left: 0; top: 0; bottom: 0; width: 22px; background: linear-gradient(180deg, #4caf50, #388e3c); }
  .circle { position: absolute; right: -140px; top: -140px; width: 480px; height: 480px; border-radius: 50%; background: rgba(76,175,80,0.10); }
  .circle2 { position: absolute; right: 120px; bottom: -220px; width: 380px; height: 380px; border-radius: 50%; background: rgba(255,107,53,0.08); }
  .tags { position: absolute; left: 80px; top: 72px; display: flex; gap: 12px; }
  .tags span { background: #fff; border: 2px solid #4caf50; color: #388e3c; border-radius: 999px; padding: 6px 20px; font-size: 24px; font-weight: 700; }
  .title { position: absolute; left: 80px; right: 80px; top: 150px; bottom: 150px; display: flex; align-items: center; }
  .title h1 { margin: 0; font-size: ${titleSize}px; line-height: 1.35; font-weight: 800; letter-spacing: 0.01em; color: #243126; text-wrap: balance; }
  .brand { position: absolute; left: 80px; bottom: 56px; display: flex; align-items: center; gap: 18px; }
  .brand img { height: 64px; width: auto; }
  .brand .name { font-size: 30px; font-weight: 800; color: #388e3c; }
  .brand .sub { font-size: 20px; color: #6b746c; margin-left: 6px; }
  .url { position: absolute; right: 80px; bottom: 66px; font-size: 22px; color: #898781; }
</style></head><body>
  <div class="bar"></div><div class="circle"></div><div class="circle2"></div>
  <div class="tags">${tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>
  <div class="title"><div><h1>${esc(title)}</h1>${sub ? `<p style="margin:18px 0 0;font-size:28px;color:#4f5a50;font-weight:600">${esc(sub)}</p>` : ''}</div></div>
  <div class="brand">${logo ? `<img src="${logo}" alt="">` : ''}<span class="name">みのる歯科</span><span class="sub">ブログ｜埼玉県東松山市</span></div>
  <div class="url">www.minoru-dental.jp</div>
</body></html>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumb-'));
const htmlPath = path.join(tmp, 'thumb.html');
fs.writeFileSync(htmlPath, html, 'utf8');
fs.mkdirSync(path.dirname(out), { recursive: true });
execFileSync(findChrome(), [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--window-size=1200,630', `--screenshot=${out}`, `--user-data-dir=${path.join(tmp, 'profile')}`, `file://${htmlPath}`,
], { stdio: 'ignore' });
console.log(`生成: ${path.relative(ROOT, out)}（${title}）`);
