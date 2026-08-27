# みのる歯科 Webサイト

埼玉県東松山市の歯医者「みのる歯科」の公式Webサイトです。静的HTMLサイトとして構築され、Vercelでホスティングしています。ブログ記事はMarkdownから軽量なNodeスクリプトでビルドします。

## 機能

- 静的HTMLベースの高速なサイト（ビルド不要でそのまま配信）
- レスポンシブデザイン（モバイル、タブレット、デスクトップ対応）
- ブログ機能（Markdownで記事作成 → `npm run build:blog` でHTML生成）
- Web管理画面（Decap CMS）からブラウザだけで記事の作成・編集が可能（`/admin/`）
- 記事Markdownのpush時にGitHub Actionsが自動ビルド（ローカルビルド不要）
- 人気記事ランキング（GA4 + GitHub Actionsで毎日自動集計）
- SEO対策（構造化データ、OGP、サイトマップ自動生成）

## 開発環境のセットアップ

```bash
# 依存関係のインストール（marked のみ）
npm install

# ブログのビルド（Markdown → 記事HTML / blog-posts.json / sitemap.xml）
npm run build:blog
```

サイト自体はビルド不要です。HTMLファイルをブラウザで直接開くか、任意のローカルサーバー（例: `npx serve .`）で確認できます。

## ディレクトリ構成

```
/minoru-dental/
├── content/
│   ├── blog/               # 公開記事のMarkdownソース（1記事1ファイル、ビルド対象）
│   │   └── [記事ID].md
│   └── drafts/             # 下書き（ビルド対象外。監修後に blog/ へ移動）
├── templates/
│   └── blog-post.html      # 記事ページのHTMLテンプレート
├── scripts/
│   ├── build-blog.js       # ブログビルドスクリプト
│   └── fetch-popular-posts.js  # GA4人気記事集計（GitHub Actionsから実行）
├── blog/                   # 生成された記事ページ（ビルド成果物）
│   └── [記事ID]/
│       ├── index.html      # 記事本文（build-blog.jsが生成。直接編集しない）
│       └── thumbnail.webp  # サムネイル画像（手動配置）
├── admin/                  # Decap CMS 管理画面（/admin/ で開く）
│   ├── index.html
│   └── config.yml          # CMSの設定（コレクション・フィールド定義）
├── api/                    # Vercelサーバーレス関数（CMSのGitHub OAuth用）
│   ├── auth.js             # 認証開始（GitHubへリダイレクト）
│   └── callback.js         # コールバック（トークン交換）
├── blog.html               # ブログ一覧ページ
├── blog-posts.json         # 記事メタデータ（build-blog.jsが生成）
├── popular-posts.json      # 人気記事ランキング（GitHub Actionsが生成）
├── sitemap.xml             # サイトマップ（build-blog.jsが生成）
├── index.html              # トップページ
├── image/                  # サイト共通の画像
└── .github/workflows/
    ├── build-blog.yml      # 記事md変更時のブログ自動ビルド
    └── update-popular-posts.yml  # GA4集計の定期実行（毎日6:00 JST）
```

## ブログの管理

記事の作成・編集には2つの方法があります。

- **方法A: Web管理画面（Decap CMS）** — ブラウザだけで完結。おすすめ（後述の「Web管理画面（Decap CMS）」参照）
- **方法B: ローカルで直接Markdownを編集** — 以下の手順

いずれの方法でも、`content/blog/` のMarkdownがpushされるとGitHub Actions（`build-blog.yml`）が自動でビルドし、記事HTML・blog-posts.json・sitemap.xml をコミットします。ローカルでの `npm run build:blog` は確認用で、必須ではありません。

### 新規記事の作成（ローカル編集の場合）

1. `content/blog/[記事ID].md` を作成します（記事IDは英数字のスラッグ。例: `best-brushing-timing`）

   ```markdown
   ---
   slug: best-brushing-timing
   title: 記事タイトル
   date: 2025-04-01
   author: 斉藤 稔
   tags: 予防歯科, 歯磨き
   image: thumbnail.webp
   summary: 一覧ページやOGPに使われる記事の要約（100〜150字程度）。
   ---

   本文をMarkdownで書きます。見出しは ## と ### を使用してください。
   ```

2. サムネイル画像を `blog/[記事ID]/thumbnail.webp` に配置します（ファイル名は英数字のみ。WebP推奨、PNG併置可）

3. ビルドを実行します

   ```bash
   npm run build:blog
   ```

   以下が自動で生成・更新されます:
   - `blog/[記事ID]/index.html`（記事ページ。OGP・JSON-LD・関連記事・前後記事リンク付き）
   - `blog-posts.json`（一覧ページ・サイドバーが参照するメタデータ）
   - `sitemap.xml`

4. 確認して問題なければコミット＆プッシュ（Markdownソースと生成物の両方をコミット）

### 記事の更新・削除

- **更新**: `content/blog/[記事ID].md` を編集して `npm run build:blog` を再実行
- **削除**: `content/blog/[記事ID].md` と `blog/[記事ID]/` ディレクトリを削除して `npm run build:blog` を再実行

`blog/[記事ID]/index.html` はビルド成果物なので直接編集しないでください（次回ビルドで上書きされます）。

### frontmatter の仕様

| キー | 必須 | 説明 |
|---|---|---|
| slug | ○ | 記事ID（ファイル名と同じ英数字スラッグ。CMSでのファイル名決定に使用） |
| title | ○ | 記事タイトル |
| date | ○ | 公開日（ISO形式 `YYYY-MM-DD`） |
| author | ○ | 著者名 |
| tags | ○ | カンマ区切りのタグ（一覧のカテゴリー・タグクラウド・関連記事の選定に使用） |
| image | ○ | サムネイルのファイル名（`blog/[記事ID]/` 内。`thumbnail.webp` 推奨） |
| summary | ○ | 記事の要約（一覧・meta description・OGPに使用） |

## Web管理画面（Decap CMS）

https://www.minoru-dental.jp/admin/ をブラウザで開き、「GitHubでログイン」するだけで記事の作成・編集ができます（リポジトリに書き込み権限のあるGitHubアカウントが必要）。

### 使い方

1. `/admin/` を開いてGitHubでログイン
2. 「ブログ記事」（公開用）または「下書き」（監修前の原稿置き場）を選び、「新規作成」
3. フォームに入力して本文をエディタで執筆（画像はドラッグ&ドロップでアップロード可能）
4. 保存すると **編集ワークフロー**（下書き → レビュー中 → 公開準備完了）で管理される
   - 「公開」するまで本番には反映されない（内部的にはPull Requestとして管理）
   - 院長監修は「レビュー中」の段階で行う運用を想定
5. 「公開」すると `content/blog/` にコミット → GitHub Actionsが自動ビルド → Vercelが自動デプロイ

### 仕組み

```
/admin/（Decap CMS）
  → GitHub OAuth（api/auth.js, api/callback.js ※Vercelサーバーレス関数）
  → GitHub APIで content/blog/*.md をコミット
  → GitHub Actions（build-blog.yml）が自動ビルド・コミット
  → Vercelが自動デプロイ
```

### 初回セットアップ（要・手動作業）

1. **GitHub OAuth Appの作成**: GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
   - Application name: `minoru-dental CMS`（任意）
   - Homepage URL: `https://www.minoru-dental.jp`
   - Authorization callback URL: `https://www.minoru-dental.jp/api/callback`
2. **Vercelの環境変数を登録**: Vercelプロジェクト → Settings → Environment Variables
   - `OAUTH_GITHUB_CLIENT_ID`: OAuth AppのClient ID
   - `OAUTH_GITHUB_CLIENT_SECRET`: OAuth AppのClient Secret（Generate a new client secretで発行）
3. 再デプロイ後、`/admin/` からログインできることを確認

## 人気記事ランキング

GitHub Actions（`.github/workflows/update-popular-posts.yml`）が毎日6:00 JSTにGA4のページビューを集計し、`popular-posts.json` を自動コミットします。`blog.html` のサイドバー「よく読まれている記事」に表示されます。

- 認証: Workload Identity Federation（キーレス）
- 集計範囲: 直近90日の `/blog/` 配下ページビュー
- 手動実行: GitHubの Actions タブ → Update Popular Posts → Run workflow

## デプロイ方法

GitHubの `main` ブランチにプッシュすると、Vercelが自動でデプロイします。

Vercelプロジェクト設定（`vercel.json` で構成済み）:

- Framework Preset: `Other`
- Build Command: なし（静的配信）
- Output Directory: `.`

## ライセンス

このプロジェクトは非公開です。無断複製・転載を禁じます。
