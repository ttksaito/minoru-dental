#!/usr/bin/env node
/**
 * ブログビルドスクリプト
 *
 * content/blog/*.md（frontmatter付きMarkdown）から以下を一括生成する:
 *   - blog/[記事ID]/index.html （templates/blog-post.html ベース）
 *   - blog.html                （templates/blog-list.html ベース。一覧を静的HTMLとして埋め込み＝SEO対応）
 *   - blog-posts.json          （記事一覧メタデータ、日付降順）
 *   - sitemap.xml              （全ページ）
 *
 * 使い方:
 *   npm install        （初回のみ）
 *   npm run build:blog
 *
 * 記事の追加方法:
 *   1. content/blog/[記事ID].md を作成（既存記事を参考にfrontmatterを記述）
 *   2. blog/[記事ID]/ にサムネイル画像（thumbnail.webp 推奨）を配置
 *   3. npm run build:blog を実行
 *   4. git commit & push → GitHub Pagesに自動デプロイ（content/blog/ のpushならGitHub Actionsが自動ビルド）
 *
 * frontmatter の任意項目:
 *   updated: YYYY-MM-DD  内容を見直した日。dateModified・sitemap・記事ページの「最終更新日」に反映
 *   summary: 要約文      未入力なら本文冒頭から自動生成
 *   author: サイト運営 | 院長   著者プロフィール（未指定はサイト運営）
 */

const fs = require('fs');
const path = require('path');

let marked;
try {
  ({ marked } = require('marked'));
} catch {
  console.error('エラー: marked がインストールされていません。`npm install` を実行してください。');
  process.exit(1);
}

const SITE_URL = 'https://www.minoru-dental.jp';

/**
 * 著者プロフィール。frontmatter の author で切り替える（未指定は operator）。
 *   author: サイト運営 / operator → サイト運営者
 *   author: 院長 / 斉藤 稔 / director → 院長（医学的な内容を院長が執筆・確認した記事のみ）
 * 表示名・紹介文はここを直せば全記事に反映される。
 */
const CLINIC = { '@type': 'Dentist', name: 'みのる歯科', url: `${SITE_URL}/` };
const AUTHORS = {
  operator: {
    key: 'operator',
    name: 'サイト運営（次男）',
    role: 'みのる歯科 サイト運営担当',
    avatar: null,
    bio: '院長の次男で、このサイトの運営をしています。医療従事者ではないので、患者の立場で気になったことや、数字・データの読み方を中心に書いています。',
    disclosure:
      '本記事はサイト運営（次男）が執筆しています。医療従事者ではないため、医学的な記述は公的機関や学会などの公開情報を参照しています。情報整理や草稿作成の一部に生成AIを使用しています。',
    person: {
      '@type': 'Person',
      '@id': `${SITE_URL}/#site-operator`,
      name: 'サイト運営（次男）',
      jobTitle: 'サイト運営担当',
      worksFor: CLINIC,
    },
    reviewed: false,
  },
  director: {
    key: 'director',
    name: '斉藤 稔',
    role: 'みのる歯科 院長・歯科医師',
    avatar: '../../image/院長.webp',
    bio: '昭和医科大学卒業。一般歯科・審美歯科・口腔外科を専門とし、痛みの少ない治療と予防歯科に力を入れています。日本歯科医師会、全身咬合学会、オーリング学会所属。',
    disclosure:
      '本記事は院長・斉藤 稔が執筆・確認しています。情報整理や草稿作成の一部に生成AIを使用しています。',
    person: {
      '@type': 'Person',
      '@id': `${SITE_URL}/#director`,
      name: '斉藤 稔',
      jobTitle: '院長・歯科医師',
      url: `${SITE_URL}/#about`,
      worksFor: CLINIC,
    },
    reviewed: true,
  },
};

/** frontmatter の author 文字列から著者プロフィールを決める */
function resolveAuthor(value) {
  const v = (value || '').trim();
  if (['院長', '斉藤 稔', '斉藤稔', 'director'].includes(v)) return AUTHORS.director;
  if (v && !['サイト運営', 'サイト運営（次男）', 'operator'].includes(v)) {
    console.log(`情報: author「${v}」は未登録のため「サイト運営」として扱います`);
  }
  return AUTHORS.operator;
}
const BASE_KEYWORDS = ['歯医者', '歯科', '東松山市', '沢口町', 'みのる歯科', '埼玉県'];

const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content', 'blog');
const TEMPLATE_PATH = path.join(ROOT, 'templates', 'blog-post.html');
const LIST_TEMPLATE_PATH = path.join(ROOT, 'templates', 'blog-list.html');
const BLOG_DIR = path.join(ROOT, 'blog');
const BLOG_LIST_PATH = path.join(ROOT, 'blog.html');
const POSTS_JSON_PATH = path.join(ROOT, 'blog-posts.json');
const SITEMAP_PATH = path.join(ROOT, 'sitemap.xml');

function fail(message) {
  console.error(`エラー: ${message}`);
  process.exit(1);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * タグ自動判定用のキーワード対応表（admin/tag-keywords.json）
 * 通常はCMSの保存時（admin/index.htmlのpreSaveフック）でタグが付与されるため、
 * ここでの判定はfrontmatterのtagsが空のままだった場合の保険。
 */
const TAG_CONFIG = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'admin', 'tag-keywords.json'), 'utf8')
);

/** タイトル＋本文からタグを自動判定する（最大maxTags件。マッチなしはフォールバック） */
function inferTags(title, body) {
  const text = `${title}\n${body}`;
  const tags = TAG_CONFIG.rules
    .filter((rule) => rule.keywords.some((kw) => text.includes(kw)))
    .map((rule) => rule.tag)
    .slice(0, TAG_CONFIG.maxTags);
  return tags.length > 0 ? tags : [TAG_CONFIG.fallback];
}

/**
 * 本文Markdownの冒頭段落から要約文を作る（最大 maxLen 文字）。
 * 見出し・画像・リンク記法・強調・脚注番号（［1］等）を除去し、文の区切りで切る。
 */
function extractSummary(markdownBody, maxLen = 120) {
  const paragraphs = markdownBody
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p && !/^(#|!\[|>|[-*] |\d+\. |\|)/.test(p));
  const text = paragraphs
    .slice(0, 2)
    .join('')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .replace(/［\d+］|\[\d+\]/g, '')
    .replace(/\s+/g, '');
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastEnd = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('？'), cut.lastIndexOf('！'));
  return lastEnd >= maxLen * 0.5 ? cut.slice(0, lastEnd + 1) : `${cut}…`;
}

/** frontmatter付きMarkdownを解析する */
function parseMarkdownFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) fail(`${path.basename(filePath)}: frontmatter（--- で囲まれたメタ情報）がありません`);

  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    // Decap CMS等がYAML値をクォートで囲む場合に対応
    const quoted = value.match(/^(['"])([\s\S]*)\1$/);
    if (quoted) value = quoted[2];
    meta[kv[1]] = value;
  }

  const id = path.basename(filePath, '.md');
  const required = ['title', 'date', 'image'];
  for (const key of required) {
    if (!meta[key]) fail(`${id}.md: frontmatterに「${key}」がありません`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) {
    fail(`${id}.md: dateはISO形式（YYYY-MM-DD）で記述してください（現在: ${meta.date}）`);
  }
  // updated（最終更新日）は任意。指定があれば dateModified・sitemap lastmod・記事ページの表示に使う
  if (meta.updated && !/^\d{4}-\d{2}-\d{2}$/.test(meta.updated)) {
    fail(`${id}.md: updatedはISO形式（YYYY-MM-DD）で記述してください（現在: ${meta.updated}）`);
  }
  if (meta.updated && meta.updated < meta.date) {
    fail(`${id}.md: updated（${meta.updated}）が date（${meta.date}）より前になっています`);
  }

  // タグ: 手入力があれば優先、未入力ならタイトル＋本文から自動判定
  const body = match[2].trim();
  let tags = (meta.tags || '').split(/[,、]/).map((t) => t.trim()).filter(Boolean);
  if (tags.length === 0) {
    tags = inferTags(meta.title, body);
    console.log(`情報: ${id}.md はタグ未入力のため自動付与しました → ${tags.join(', ')}`);
  }

  // 要約: frontmatterにあれば優先、なければ本文の冒頭から自動生成（meta description・OGP・一覧に使用）
  let summary = meta.summary || '';
  if (!summary) {
    summary = extractSummary(body);
    console.log(`情報: ${id}.md は summary 未入力のため本文冒頭から生成しました`);
  }

  return {
    id,
    title: meta.title,
    date: meta.date,
    updated: meta.updated || null,
    author: resolveAuthor(meta.author),
    tags,
    image: meta.image,
    summary,
    body,
  };
}

/**
 * サムネイルのサイト内パス（先頭スラッシュなし）を返す。
 *   - '/blog/uploads/画像.png' のような絶対パス（CMSアップロード）→ 'blog/uploads/画像.png'
 *   - 'thumbnail.webp' のような相対パス（既存記事）→ 'blog/[記事ID]/thumbnail.webp'
 */
function imageWebPath(post) {
  return post.image.startsWith('/') ? post.image.slice(1) : `blog/${post.id}/${post.image}`;
}

/** HTMLに埋め込むサムネイルURL（サイトルート絶対パス）。日本語ファイル名をURLエンコードする */
function imageUrl(post) {
  return `/${encodeURI(imageWebPath(post))}`;
}

/** OGP・サイトマップ用のサムネイル完全URL */
function imageFullUrl(post) {
  return `${SITE_URL}${imageUrl(post)}`;
}

/** ISO日付を「YYYY年M月D日」に整形 */
function formatDateJa(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

/** Markdown本文をHTMLへ変換（見出しレベルを h2→h3, h3→h4 にシフト） */
function renderContent(markdownBody) {
  let html = marked.parse(markdownBody, { gfm: true, async: false });
  // 記事タイトルがh2のため、本文見出しを1段下げる（h3→h4 を先に処理）
  html = html.replace(/<(\/?)h3(\s|>)/g, '<$1h4$2');
  html = html.replace(/<(\/?)h2(\s|>)/g, '<$1h3$2');
  return html.trim();
}

/** タグの共通数から関連記事を最大3件選ぶ（不足時は新しい記事で補完） */
function selectRelatedPosts(post, allPosts) {
  const others = allPosts.filter((p) => p.id !== post.id);
  const scored = others
    .map((p) => ({
      post: p,
      score: p.tags.filter((t) => post.tags.includes(t)).length,
    }))
    .sort((a, b) => b.score - a.score || b.post.date.localeCompare(a.post.date));
  return scored.slice(0, 3).map((s) => s.post);
}

function buildArticleHtml(template, post, allPosts) {
  const canonicalUrl = `${SITE_URL}/blog/${post.id}/`;
  const ogImageUrl = imageFullUrl(post);
  const encodedUrl = encodeURIComponent(canonicalUrl);
  const encodedTitle = encodeURIComponent(`${post.title} | みのる歯科ブログ`);

  const jsonld = JSON.stringify(
    {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      image: ogImageUrl,
      datePublished: `${post.date}T09:00:00+09:00`,
      dateModified: `${post.updated || post.date}T09:00:00+09:00`,
      author: post.author.person,
      inLanguage: 'ja',
      keywords: post.tags.join(', '),
      publisher: {
        '@type': 'Organization',
        name: 'みのる歯科',
        logo: { '@type': 'ImageObject', url: `${SITE_URL}/image/logo.png` },
      },
      description: post.summary,
      mainEntityOfPage: {
        '@type': 'WebPage',
        '@id': canonicalUrl,
        // 院長が執筆・確認した記事のみ、監修者として明示
        ...(post.author.reviewed ? { reviewedBy: post.author.person } : {}),
      },
    },
    null,
    2
  );

  const tagsHtml = post.tags
    .map((t) => `                        <span class="blog-post-tag">${escapeHtml(t)}</span>`)
    .join('\n');

  const related = selectRelatedPosts(post, allPosts);
  const relatedItems = related
    .map(
      (p) => `                        <a href="../${p.id}/" class="blog-related-item">
                            <div class="blog-related-image">
                                <img src="${escapeHtml(imageUrl(p))}" alt="${escapeHtml(p.title)}" loading="lazy" decoding="async">
                            </div>
                            <div class="blog-related-content">
                                <h4>${escapeHtml(p.title)}</h4>
                                <span class="post-date">${formatDateJa(p.date)}</span>
                            </div>
                        </a>`
    )
    .join('\n');

  // 前後の記事（allPostsは日付降順: index+1 = 古い記事、index-1 = 新しい記事）
  const index = allPosts.findIndex((p) => p.id === post.id);
  const older = allPosts[index + 1];
  const newer = allPosts[index - 1];
  const prevLink = older
    ? `                    <a href="../${older.id}/" class="pagination-link">← 前の記事</a>`
    : '                    <span></span>';
  const nextLink = newer
    ? `                    <a href="../${newer.id}/" class="pagination-link">次の記事 →</a>`
    : '                    <span></span>';

  const latestItems = allPosts
    .slice(0, 5)
    .map(
      (p) => `                        <li>
                            <a href="../${p.id}/">${escapeHtml(p.title)}</a>
                            <span class="post-date">${formatDateJa(p.date)}</span>
                        </li>`
    )
    .join('\n');

  const tagCounts = {};
  for (const p of allPosts) for (const t of p.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
  const categoryItems = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([tag, count]) =>
        `                        <li><a href="../../blog.html">${escapeHtml(tag)} <span class="category-count">${count}</span></a></li>`
    )
    .join('\n');

  const keywords = [...BASE_KEYWORDS, ...post.tags].join(',');

  return template
    .replaceAll('{{JSONLD}}', jsonld)
    .replaceAll('{{TITLE}}', escapeHtml(post.title))
    .replaceAll('{{DESCRIPTION}}', escapeHtml(post.summary))
    .replaceAll('{{KEYWORDS}}', escapeHtml(keywords))
    .replaceAll('{{CANONICAL_URL}}', canonicalUrl)
    .replaceAll('{{OG_IMAGE_URL}}', ogImageUrl)
    .replaceAll('{{DATE_JA}}', formatDateJa(post.date))
    .replaceAll('{{DATE_ISO}}', post.date)
    .replaceAll('{{AUTHOR_NAME}}', escapeHtml(post.author.name))
    .replaceAll('{{AUTHOR_ROLE}}', escapeHtml(post.author.role))
    .replaceAll('{{AUTHOR_BIO}}', escapeHtml(post.author.bio))
    .replaceAll(
      '{{AUTHOR_AVATAR_HTML}}',
      post.author.avatar
        ? `<div class="blog-author-avatar"><img src="${post.author.avatar}" alt="${escapeHtml(post.author.name)}"></div>`
        : ''
    )
    .replaceAll('{{AUTHOR_PROFILE_LINK}}', post.author.key === 'director' ? ' <a href="../../#about">院長プロフィール</a>' : '')
    .replaceAll('{{DISCLOSURE}}', escapeHtml(post.author.disclosure))
    .replaceAll(
      '{{UPDATED_HTML}}',
      post.updated
        ? `<span>最終更新日: <time datetime="${post.updated}">${formatDateJa(post.updated)}</time></span>`
        : ''
    )
    .replaceAll('{{TAGS_HTML}}', tagsHtml)
    .replaceAll('{{IMAGE_SRC}}', escapeHtml(imageUrl(post)))
    .replaceAll('{{CONTENT}}', post.contentHtml)
    .replaceAll('{{SHARE_TWITTER}}', `https://twitter.com/intent/tweet?url=${encodedUrl}&amp;text=${encodedTitle}`)
    .replaceAll('{{SHARE_FACEBOOK}}', `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`)
    .replaceAll('{{SHARE_LINE}}', `https://social-plugins.line.me/lineit/share?url=${encodedUrl}`)
    .replaceAll('{{RELATED_ITEMS}}', relatedItems)
    .replaceAll('{{PREV_LINK}}', prevLink)
    .replaceAll('{{NEXT_LINK}}', nextLink)
    .replaceAll('{{LATEST_ITEMS}}', latestItems)
    .replaceAll('{{CATEGORY_ITEMS}}', categoryItems);
}

/** ブログ一覧ページ（blog.html）を生成する。記事一覧・サイドバーを静的HTMLとして埋め込む（SEO対応） */
function buildListPage(listTemplate, allPosts) {
  // 記事一覧（data-tags はJSのカテゴリー絞り込みで使用）
  const postItems = allPosts
    .map((p) => {
      const url = `blog/${p.id}/`;
      const imageSrc = imageUrl(p);
      const tagsHtml = p.tags
        .map((t) => `<span class="blog-post-tag">${escapeHtml(t)}</span>`)
        .join('');
      return `                <article class="blog-post" data-tags="${escapeHtml(p.tags.join(','))}">
                    <div class="blog-post-image">
                        <a href="${url}"><img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(p.title)}" loading="lazy" decoding="async"></a>
                    </div>
                    <div class="blog-post-content">
                        <div class="blog-post-meta">
                            <span>${formatDateJa(p.date)}</span>
                        </div>
                        <div class="blog-post-tags">${tagsHtml}</div>
                        <h3><a href="${url}">${escapeHtml(p.title)}</a></h3>${p.summary ? `
                        <p>${escapeHtml(p.summary)}</p>` : ''}
                        <a href="${url}" class="read-more">続きを読む →</a>
                    </div>
                </article>`;
    })
    .join('\n');

  // サイドバー: 最新記事（5件）
  const latestItems = allPosts
    .slice(0, 5)
    .map(
      (p) => `                        <li>
                            <a href="blog/${p.id}/">${escapeHtml(p.title)}</a>
                            <span class="post-date">${formatDateJa(p.date)}</span>
                        </li>`
    )
    .join('\n');

  // サイドバー: カテゴリー（記事数の多い順）
  const tagCounts = {};
  for (const p of allPosts) for (const t of p.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
  const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'));
  const categoryItems = sortedTags
    .map(
      ([tag, count]) =>
        `                        <li><a href="#" data-category="${escapeHtml(tag)}">${escapeHtml(tag)} <span class="category-count">${count}</span></a></li>`
    )
    .join('\n');

  // サイドバー: タグクラウド
  const tagItems = sortedTags
    .map(
      ([tag]) =>
        `                        <span class="blog-post-tag tag-filter" data-category="${escapeHtml(tag)}" role="button" tabindex="0">${escapeHtml(tag)}</span>`
    )
    .join('\n');

  // 人気記事ランキング用のID→タイトル対応表（<script>内に埋め込むため < をエスケープ）
  const postsMetaJson = JSON.stringify(allPosts.map((p) => ({ id: p.id, title: p.title }))).replace(/</g, '\\u003c');

  return listTemplate
    .replaceAll('{{POST_ITEMS}}', postItems)
    .replaceAll('{{LATEST_ITEMS}}', latestItems)
    .replaceAll('{{CATEGORY_ITEMS}}', categoryItems)
    .replaceAll('{{TAG_ITEMS}}', tagItems)
    .replaceAll('{{POSTS_META_JSON}}', postsMetaJson);
}

function buildSitemap(allPosts) {
  const today = new Date().toISOString().slice(0, 10);
  const staticPages = [
    { loc: `${SITE_URL}/`, lastmod: today, changefreq: 'weekly', priority: '1.0' },
    { loc: `${SITE_URL}/blog.html`, lastmod: today, changefreq: 'weekly', priority: '0.8' },
  ];

  const entries = [];
  for (const page of staticPages) {
    entries.push(`  <url>
    <loc>${page.loc}</loc>
    <lastmod>${page.lastmod}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`);
  }
  for (const post of allPosts) {
    entries.push(`  <url>
    <loc>${SITE_URL}/blog/${post.id}/</loc>
    <lastmod>${post.updated || post.date}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
    <image:image>
      <image:loc>${imageFullUrl(post)}</image:loc>
      <image:title>${escapeHtml(post.title)}</image:title>
    </image:image>
  </url>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">

${entries.join('\n\n')}

</urlset>
`;
}

function main() {
  if (!fs.existsSync(CONTENT_DIR)) fail(`${CONTENT_DIR} がありません`);
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');

  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md'));
  if (files.length === 0) fail('content/blog/ にMarkdownファイルがありません');

  const posts = files
    .map((f) => parseMarkdownFile(path.join(CONTENT_DIR, f)))
    .sort((a, b) => b.date.localeCompare(a.date)); // 新しい順

  // 本文を変換
  for (const post of posts) {
    post.contentHtml = renderContent(post.body);
  }

  // 記事HTMLを生成
  for (const post of posts) {
    const dir = path.join(BLOG_DIR, post.id);
    fs.mkdirSync(dir, { recursive: true });

    const imagePath = path.join(ROOT, imageWebPath(post));
    if (!fs.existsSync(imagePath)) {
      console.warn(`警告: ${imageWebPath(post)} が見つかりません（サムネイルを配置してください）`);
    }

    fs.writeFileSync(path.join(dir, 'index.html'), buildArticleHtml(template, post, posts), 'utf8');
    console.log(`生成: blog/${post.id}/index.html`);
  }

  // blog.html（一覧ページ）を生成
  const listTemplate = fs.readFileSync(LIST_TEMPLATE_PATH, 'utf8');
  fs.writeFileSync(BLOG_LIST_PATH, buildListPage(listTemplate, posts), 'utf8');
  console.log('生成: blog.html');

  // blog-posts.json を生成
  const postsJson = {
    posts: posts.map((p) => ({
      id: p.id,
      title: p.title,
      date: p.date,
      tags: p.tags,
      summary: p.summary,
      image: imageWebPath(p),
    })),
  };
  fs.writeFileSync(POSTS_JSON_PATH, JSON.stringify(postsJson, null, 2) + '\n', 'utf8');
  console.log('生成: blog-posts.json');

  // sitemap.xml を生成
  fs.writeFileSync(SITEMAP_PATH, buildSitemap(posts), 'utf8');
  console.log('生成: sitemap.xml');

  console.log(`\n完了: ${posts.length}記事をビルドしました`);
}

main();
