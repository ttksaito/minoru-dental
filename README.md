# みのる歯科 Webサイト

埼玉県東松山市の歯医者「みのる歯科」の公式Webサイトです。このサイトは11ty（Eleventy）を使用して構築されています。

## 機能

- 静的サイトジェネレーター（11ty）を使用した高速なサイト
- レスポンシブデザイン（モバイル、タブレット、デスクトップ対応）
- ブログ機能（Markdownで記事作成）
- タグ別アーカイブ
- SEO対策（構造化データ、メタタグ最適化）

## 開発環境のセットアップ

```bash
# 依存関係のインストール
npm install

# 開発サーバーの起動
npm start
# または
npm run serve

# 本番ビルド
npm run build
```

## ディレクトリ構成

```
/minoru-dental/
├── _includes/             # 共通パーツ（ヘッダー、フッターなど）
├── _site/                 # ビルド後の出力先
├── src/                   # ソースファイル
│   ├── posts/             # ブログ記事用Markdownファイル
│   └── ...
├── _data/                 # サイト共通データ
├── assets/                # 静的アセット（CSS、JS、画像）
├── .eleventy.js           # Eleventyの設定ファイル
└── package.json           # npm設定ファイル
```

## ブログ記事の追加方法

1. `src/posts/` ディレクトリに新しいMarkdownファイルを作成
2. ファイル名は `YYYY-MM-DD-slug.md` の形式で作成（例: `2025-05-01-dental-hygiene.md`）
3. 以下のフロントマターを記事の先頭に追加:

```markdown
---
title: 記事タイトル
description: 記事の説明文（メタディスクリプションにも使用）
date: YYYY-MM-DD
featured_image: /path/to/image.jpg
tags:
  - タグ1
  - タグ2
---

記事の本文をここに記述...
```

## デプロイ方法

GitHub Pagesにデプロイする場合:

```bash
# ビルド
npm run build

# _siteディレクトリの内容をGitHubリポジトリにプッシュ
```

## ライセンス

このプロジェクトは非公開です。無断複製・転載を禁じます。