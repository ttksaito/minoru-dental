#!/usr/bin/env node
/**
 * dashboard/data.enc（GitHub Actions が暗号化して保存した集計データ）を
 * ローカルで復号し、dashboard/data.json（git 管理外）に書き出す。要点も表示する。
 *
 * 使い方:
 *   DASHBOARD_PASSWORD='パスワード' node scripts/decrypt-dashboard-data.js
 *   （最新の data.enc を使うため、先に git pull しておく）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const ENC = path.join(ROOT, 'dashboard', 'data.enc');
const OUT = path.join(ROOT, 'dashboard', 'data.json');
const password = process.env.DASHBOARD_PASSWORD;
if (!password) { console.error('環境変数 DASHBOARD_PASSWORD を指定してください'); process.exit(1); }
if (!fs.existsSync(ENC)) { console.error('dashboard/data.enc がありません。git pull してください'); process.exit(1); }

const pkg = JSON.parse(fs.readFileSync(ENC, 'utf8'));
const key = crypto.pbkdf2Sync(password, Buffer.from(pkg.salt, 'base64'), pkg.iterations, 32, 'sha256');
const buf = Buffer.from(pkg.data, 'base64');
const tag = buf.subarray(buf.length - 16), ct = buf.subarray(0, buf.length - 16);
const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(pkg.iv, 'base64'));
decipher.setAuthTag(tag);
let data;
try {
  data = JSON.parse(Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8'));
} catch (e) {
  console.error('復号に失敗しました。パスワードが違う可能性があります'); process.exit(1);
}
fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n', 'utf8');

const ga = data.ga4, gsc = data.gsc;
console.log(`生成日時: ${data.generatedAt}（直近${data.days}日 vs 前${data.days}日）→ dashboard/data.json に保存`);
if (ga) {
  const c = ga.summary.current, p = ga.summary.previous;
  console.log(`GA4: ユーザー ${c.users}（前 ${p.users}） セッション ${c.sessions}（前 ${p.sessions}） 表示 ${c.pageViews}（前 ${p.pageViews}）`);
  console.log(`  チャネル: ${ga.channels.map((x) => `${x.channel} ${x.sessions}`).join(' / ')}`);
  console.log(`  キーイベント: ${ga.keyEvents.length ? ga.keyEvents.map((k) => `${k.event} ${k.count}（前 ${k.previousCount}）`).join(' / ') : '未登録'}`);
  if (ga.ads && ga.ads.linked) console.log(`  広告: 費用 ¥${ga.ads.current.cost} クリック ${ga.ads.current.clicks}（前 ¥${ga.ads.previous.cost} / ${ga.ads.previous.clicks}）`);
}
if (gsc) {
  const c = gsc.current, p = gsc.previous;
  console.log(`Search Console（${gsc.range.start}〜${gsc.range.end}）: クリック ${c.clicks}（前 ${p.clicks}） 表示 ${c.impressions}（前 ${p.impressions}） 順位 ${c.position.toFixed(1)}（前 ${p.position.toFixed(1)}）`);
  const targets = gsc.queries.filter((q) => /東松山/.test(q.query));
  console.log('  「東松山」を含むキーワード:');
  for (const q of targets) console.log(`    ${q.query}: 表示 ${q.impressions} / 順位 ${q.position.toFixed(1)} / クリック ${q.clicks}`);
}
