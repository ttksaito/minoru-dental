#!/usr/bin/env node
/**
 * hamigaki.html（はみがきブレイカー）にサイト連携分を再適用する
 *
 * ゲーム本体は外部（AI のアーティファクトなど）で編集して丸ごと貼り替えることが多く、
 * そのたびにサイト連携のための追記が消えてしまう。差し替えたあとに本スクリプトを実行すると
 * 足りない分だけを追記する（すでに入っている箇所は触らない＝何度実行しても安全）。
 *
 *   node scripts/patch-hamigaki.js
 *
 * 追記する内容:
 *   - <head>: viewport-fit、ホーム画面追加用 meta、apple-touch-icon、タイトル、description、canonical、OGP
 *   - GA4 タグ（サイト共通 G-P8PPKGZVRT）
 *   - 左上の「← みのる歯科」リンク（タイトル・リザルト画面のときだけ表示）
 *   - タッチ端末で開始タップ時に全画面化する goFull()
 *   - Fullscreen API のない端末（iPhone）向けの「ホーム画面に追加」案内
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'hamigaki.html');
let s = fs.readFileSync(FILE, 'utf8');
const before = s;
const done = [];
const skipped = [];
const failed = [];

/** marker が未登場なら anchor（1 箇所だけ存在すること）を replacement に置き換える */
function patch(label, marker, anchor, replacement) {
  if (s.includes(marker)) { skipped.push(label); return; }
  const n = s.split(anchor).length - 1;
  if (n !== 1) { failed.push(`${label}（目印が ${n} 箇所。1 箇所である必要があります）`); return; }
  s = s.replace(anchor, replacement);
  done.push(label);
}

patch('head のメタ情報', 'rel="canonical"',
  '<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>はみがきブレイカー</title>',
  `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<!-- ホーム画面に追加したときはアドレスバーなしの全画面で起動する（iPhone / Android） -->
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="はみがきブレイカー">
<meta name="theme-color" content="#9fdcf0">
<link rel="apple-touch-icon" href="image/apple-touch-icon.png">
<title>はみがきブレイカー｜みのる歯科の歯みがきブロック崩し</title>
<meta name="description" content="歯ブラシで泡を打ち返して歯垢と虫歯をきれいにする、みのる歯科（埼玉県東松山市）のお子さま向けブロック崩しゲーム。スマホでもパソコンでも無料で遊べます。">
<link rel="canonical" href="https://www.minoru-dental.jp/hamigaki.html">
<meta property="og:type" content="website">
<meta property="og:url" content="https://www.minoru-dental.jp/hamigaki.html">
<meta property="og:title" content="はみがきブレイカー｜みのる歯科の歯みがきブロック崩し">
<meta property="og:description" content="歯ブラシで泡を打ち返して歯垢と虫歯をきれいにする、お子さま向けブロック崩しゲーム。スマホでもパソコンでも無料で遊べます。">
<meta property="og:locale" content="ja_JP">
<meta property="og:site_name" content="みのる歯科">
<meta name="twitter:card" content="summary">`);

patch('案内文の CSS', '#screen p.hint{',
  '#screen p{font-size:4.3cqw;line-height:1.6;max-width:78cqw;text-wrap:balance}',
  `#screen p{font-size:4.3cqw;line-height:1.6;max-width:78cqw;text-wrap:balance}
#screen p.hint{font-size:3.3cqw;line-height:1.5;color:#5a7a9a}`);

patch('戻るリンクの CSS', '#home{',
  '#go:focus-visible,#reset:focus-visible,#sound:focus-visible{outline:0.8cqw solid var(--ink);outline-offset:0.8cqw}',
  `#home{position:absolute;top:1%;left:1.6%;height:8.4cqw;display:flex;align-items:center;padding:0 2.6cqw;border:0.5cqw solid var(--mint);
  background:#fff;color:var(--mint);font-size:3.6cqw;line-height:1;text-decoration:none;border-radius:1.4cqw;white-space:nowrap}
#screen[hidden]+#home{display:none}
#go:focus-visible,#reset:focus-visible,#sound:focus-visible,#home:focus-visible{outline:0.8cqw solid var(--ink);outline-offset:0.8cqw}`);

patch('GA4 タグ', 'G-P8PPKGZVRT',
  '<body>\n<div id="stage">',
  `<body>
<!-- Google Analytics（サイト共通） -->
<script>
  // 運営者の端末を計測から外す: ?noga=1 で一度開くと、この端末では GA4・Clarity に送らない（?noga=0 で解除）
  try {
    if (/[?&]noga=1/.test(location.search)) localStorage.setItem('noga', '1');
    if (/[?&]noga=0/.test(location.search)) localStorage.removeItem('noga');
    if (localStorage.getItem('noga') === '1') window['ga-disable-G-P8PPKGZVRT'] = window.noga = true;
  } catch (e) {}
  // 自分の端末で除外できているか一目でわかるよう、画面の左下に小さく表示する（?noga=1 を開いた端末だけ）
  if (window.noga) document.addEventListener('DOMContentLoaded', function () {
    var b = document.createElement('div');
    b.textContent = '計測オフ';
    b.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;padding:2px 8px;font:12px/1.6 sans-serif;color:#fff;background:rgba(0,0,0,.55);border-radius:4px;pointer-events:none';
    document.body.appendChild(b);
  });
</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-P8PPKGZVRT"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-P8PPKGZVRT');
</script>
<div id="stage">`);

patch('戻るリンク', 'id="home"',
  '  <div id="screen"></div>\n</div>',
  `  <div id="screen"></div>
  <a id="home" href="/" aria-label="みのる歯科のトップページへ戻る">← みのる歯科</a>
</div>`);

patch('全画面化 goFull()', 'function goFull()',
  "function wake(){if(AC||muted)return;try{AC=new (window.AudioContext||window.webkitAudioContext)();}catch(e){AC=null;}}",
  `function wake(){if(AC||muted)return;try{AC=new (window.AudioContext||window.webkitAudioContext)();}catch(e){AC=null;}}
/* タッチ端末では「みがきはじめる」などのタップ（ユーザー操作）を使って全画面にする。
   Fullscreen API 非対応（iPhone など）やホーム画面から起動済みの場合は何もしない。 */
function goFull(){
  try{
    if(!matchMedia('(pointer: coarse)').matches)return;
    if(navigator.standalone||matchMedia('(display-mode: standalone)').matches)return;
    if(document.fullscreenElement||document.webkitFullscreenElement)return;
    const el=document.documentElement;
    const p=el.requestFullscreen?el.requestFullscreen({navigationUI:'hide'}):el.webkitRequestFullscreen?el.webkitRequestFullscreen():null;
    if(p&&p.catch)p.catch(()=>{});
  }catch(e){}
}`);

patch('iPhone 向け案内文', 'class="hint"',
  "    label=st.stage>0?((st.stage+1)+' '+STAGES[st.stage].name+'からつづける'):'みがきはじめる';",
  `    /* iPhone のブラウザは Fullscreen API 非対応（動画のみ）。ホーム画面に追加すれば全画面で起動できるので案内する */
    const de=document.documentElement;
    if(matchMedia('(pointer: coarse)').matches&&!(de.requestFullscreen||de.webkitRequestFullscreen)
       &&!(navigator.standalone||matchMedia('(display-mode: standalone)').matches))
      html+='<p class="hint">全画面であそぶには、ブラウザの共有ボタンから「ホーム画面に追加」して開いてください。</p>';
    label=st.stage>0?((st.stage+1)+' '+STAGES[st.stage].name+'からつづける'):'みがきはじめる';`);

patch('最初からあそぶボタンで全画面化', "rs.addEventListener('click',()=>{wake();goFull();",
  "  if(rs)rs.addEventListener('click',()=>{wake();screenEl.hidden=true;",
  "  if(rs)rs.addEventListener('click',()=>{wake();goFull();screenEl.hidden=true;");

patch('開始ボタンで全画面化', "    wake();goFull();screenEl.hidden=true;",
  "  go.addEventListener('click',()=>{\n    wake();screenEl.hidden=true;",
  "  go.addEventListener('click',()=>{\n    wake();goFull();screenEl.hidden=true;");

// ゲーム本体のスクリプトが構文的に壊れていないか確認してから書き出す
const i = s.indexOf('<script>\n(function(){');
const j = s.indexOf('</script>', i);
if (i < 0 || j < 0) { console.error('エラー: ゲーム本体の <script> が見つかりません'); process.exit(1); }
try { new Function(s.slice(i + '<script>'.length, j)); }
catch (e) { console.error(`エラー: ゲームのスクリプトに構文エラーがあります: ${e.message}`); process.exit(1); }

if (s !== before) fs.writeFileSync(FILE, s);
if (done.length) console.log('追記:', done.join('、'));
if (skipped.length) console.log('済み:', skipped.join('、'));
if (failed.length) { console.error('失敗:', failed.join('\n      ')); process.exit(1); }
const stages = (s.slice(i, j).match(/\{name:'[^']*',thick:/g) || []).length;
console.log(`コース数: ${stages}（index.html の「全Nコース」表記と合っているか確認）`);
