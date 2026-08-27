# みのる歯科 Webサイト・オンライン対策 TODO

最終更新: 2026-08-28

## 📊 完了済み項目

### Webサイト改善

#### フェーズ1: 即座に対応すべき項目 ✅
- [x] 診療時間の不一致を修正（9:30-13:00, 14:30-18:30に統一）
- [x] メタキーワードタグを削除（Google非推奨）
- [x] 構造化データのURLをVercelに更新
- [x] 構造化データの電話番号修正（0493-24-9080）
- [x] Open GraphタグとTwitter Cardを追加
- [x] プレースホルダー画像を実際の画像に置き換え
- [x] Google Analytics設定（測定ID: G-P8PPKGZVRT）

#### フェーズ2: 早めに対応すべき項目 ✅
- [x] 画像のalt属性を充実（7箇所改善）
  - ロゴ、外観、ブログ画像、設備画像
- [x] CTAボタンのデザイン改善
  - オレンジグラデーション適用
  - ホバーエフェクト追加
  - シャインアニメーション追加
- [x] モバイル固定CTAボタン追加
  - 画面下部に固定表示
  - ワンタップ電話機能

#### フェーズ3: 時間があれば対応 ✅
- [x] sitemap.xml作成
- [x] robots.txt作成
- [x] パンくずリスト構造化データ追加
- [x] FAQ構造化データ追加（5項目）

### Googleビジネスプロフィール
- [x] アカウント作成
- [x] 基本情報登録（住所、電話、営業時間）
- [x] ビジネス説明文追加

---

## 🔴 優先度：高（明日対応）

### Googleビジネスプロフィール

#### 1. オーナー確認を完了（最優先）
**期限**: 明日（2025-07-21）朝一番

**手順**:
1. Googleビジネスプロフィール管理画面にログイン
2. 「オーナー確認を行う」ボタンをクリック
3. 確認方法を選択：
   - **推奨**: 電話確認（即日完了、5分程度）
   - または: 郵送ハガキ（2週間待ち）
4. 確認コードを入力
5. 確認完了を確認

**完了すると**:
- 一般ユーザーに完全に表示される
- Google検索・Googleマップに掲載される
- パフォーマンスデータが見られる

#### 2. 写真を10枚以上追加
**期限**: 2025-07-21中

**必須写真**（優先順）:
1. [ ] 外観（別角度、看板が見える）
2. [ ] 受付・待合室
3. [ ] 診療室（診療チェアと設備）
4. [ ] 駐車場（4台完備が分かる）
5. [ ] 院長の写真
6. [ ] レーザー治療器などの設備
7. [ ] 洗面所・トイレ
8. [ ] 待合室の雑誌や本棚
9. [ ] 滅菌室・衛生管理の様子
10. [ ] スタッフの集合写真（可能であれば）

**撮影のコツ**:
- 明るい時間帯に撮影（自然光）
- 横向きで撮影
- 整理整頓してから撮影
- スマホで十分

**アップロード方法**:
1. Googleビジネスプロフィール管理画面
2. 「写真」タブ → 「写真を追加」
3. 各写真にキャプション（説明）を追加

---

## 🟡 優先度：中（1週間以内）

### Googleビジネスプロフィール

#### 3. サービス（診療科目）を追加
**期限**: 2025-07-27まで

**追加する診療科目**:
- [ ] 一般歯科
- [ ] 小児歯科
- [ ] 予防歯科
- [ ] 口腔外科
- [ ] 審美歯科
- [ ] ホワイトニング

#### 4. 属性を設定
**期限**: 2025-07-27まで

**設定する属性**:
- [ ] 駐車場あり
- [ ] 予約制
- [ ] バリアフリー設備（該当する場合）
- [ ] クレジットカード対応（該当する場合）
- [ ] 車椅子対応（該当する場合）

#### 5. 質問と回答（FAQ）を追加
**期限**: 2025-07-27まで

**事前に追加すべき質問**:
- [ ] 初診の場合、何を持っていけばいいですか？
- [ ] クレジットカードは使えますか？
- [ ] 子どもは何歳から診てもらえますか？
- [ ] 急患は受け付けていますか？
- [ ] 定期検診はどのくらいの頻度が良いですか？

#### 6. 最初の投稿を作成
**期限**: 2025-07-27まで

**投稿例**:
```
みのる歯科医院です。
この度、Googleビジネスプロフィールを開設いたしました。

当院では「痛みを抑えた優しい治療」をモットーに、
地域の皆様のお口の健康をサポートしております。

お口のお悩みがございましたら、
お気軽にご相談ください。

📞 0493-24-9080
🌐 https://minoru-dental.vercel.app
```

---

## 🟢 優先度：低（1ヶ月以内）

### Webサイト

#### 7. ページ速度の最適化
**期限**: 2025-08-20まで

**実施内容**:
- [ ] 画像の圧縮・WebP形式への変換
- [ ] CSS外部ファイル化（現在インライン化されている）
- [ ] 画像の遅延読み込み（lazy loading）実装
- [ ] フォントの最適化

**目標**:
- PageSpeed Insights スコア 90点以上
- First Contentful Paint: 1.8秒以下
- Largest Contentful Paint: 2.5秒以下

#### 8. Google Search Consoleの設定
**期限**: 2025-08-20まで

**手順**:
1. [ ] https://search.google.com/search-console にアクセス
2. [ ] プロパティを追加: `https://minoru-dental.vercel.app`
3. [ ] 所有権の確認（HTMLタグまたはDNS）
4. [ ] サイトマップを送信: `https://minoru-dental.vercel.app/sitemap.xml`
5. [ ] インデックス登録状況を確認

#### 9. レビュー構造化データの追加
**期限**: 2025-08-20まで

**前提条件**: 患者さんからのレビューが3件以上集まったら

**実施内容**:
- [ ] Review構造化データをindex-old.htmlに追加
- [ ] 星評価の表示
- [ ] レビュー数の表示

---

## ✍️ ブログ記事プラン（2026-08-27 下書き10本完成 → 院長監修待ち）

患者さんの素朴な疑問に答える「豆知識系」10テーマ。**下書きは `content/drafts/` に作成済み**（ビルド対象外。監修完了後に `content/blog/` へ移動すると公開対象になる）。

| # | テーマ | 記事ID | 下書き | 予定日（仮） |
|---|--------|--------|:---:|------|
| 1 | 歯を磨くベストなタイミング | `best-brushing-timing` | ✅ | 2026-09-01 |
| 2 | 食後30分は磨かない方がいい？ | `brushing-after-meals` | ✅ | 2026-09-08 |
| 3 | フロスは歯磨きの前？後？ | `floss-before-or-after` | ✅ | 2026-09-15 |
| 4 | 歯磨き後のうがいは何回？ | `rinsing-after-brushing` | ✅ | 2026-09-22 |
| 5 | 入れ歯になるとどのくらい噛めなくなる？ | `denture-chewing-ability` | ✅ | 2026-09-29 |
| 6 | 舌の「味覚地図」は本当？ | `tongue-taste-map` | ✅ | 2026-10-06 |
| 7 | 虫歯は甘いものの量と回数、どちらが重要？ | `sugar-amount-vs-frequency` | ✅ | 2026-10-13 |
| 8 | 歯周病はなぜ痛くない？ | `painless-periodontal-disease` | ✅ | 2026-10-20 |
| 9 | 口が乾くとなぜ虫歯になる？ | `dry-mouth-cavities` | ✅ | 2026-10-27 |
| 10 | 歯は骨と同じもの？ | `teeth-vs-bones` | ✅ | 2026-11-03 |

※予定日は週1本ペースの仮設定（frontmatterのdateに記入済み）。公開時に実際の日付へ変更する。

**公開手順（1記事ごと）**:
- [ ] `content/drafts/[記事ID].md` を**院長が監修・確認**（医学的内容の正確性チェック）
- [ ] frontmatterの `date` を実際の公開日に修正
- [ ] `content/drafts/` → `content/blog/` へファイル移動（git mv）
- [ ] サムネイル画像を `blog/[記事ID]/thumbnail.webp` に配置（英数字ファイル名、WebP形式）
- [ ] `npm run build:blog` 実行（記事HTML / blog-posts.json / sitemap.xml が自動生成される）
- [ ] コミット＆プッシュ → デプロイ後に表示・OGP確認

**方針メモ**:
- 週1本ペースで公開すれば約2.5ヶ月分のネタになる（継続タスクの「ブログ記事を1本追加」に対応）
- 10本追加すると人気記事ランキング・タグ別推薦が意味を持ち始める
- サムネイルは未作成（10枚必要）。画像生成ツール等で作成し、WebP変換して配置する

---

## 📝 ブログ機能の改善課題（2026-08-27 整理 / 同日B-1〜B-4・B-6・B-8対応完了）

### 現在の仕組み（B-1自動化後）
```
content/blog/[記事ID].md（Markdown + frontmatter）
  → npm run build:blog（scripts/build-blog.js + templates/blog-post.html）
  → blog/[記事ID]/index.html ＋ blog-posts.json ＋ sitemap.xml を自動生成
```
詳細な記事追加手順は README.md 参照。

### ✅ 完了（2026-08-27）

#### B-1. 記事追加ワークフローの自動化 ✅
- 案A（Node.jsスクリプト方式）を採用。依存は `marked` のみ（package.json新設）
- 副次的に修正: 壊れたプレースホルダー画像（/api/placeholder/）、ダミーのサイドバー固定データ、死んでいたシェアリンク（実URLのX/Facebook/LINEシェアに変更）、存在しない記事への関連リンク
- 記事ページにOGP/Twitter Cardを追加。関連記事・前後記事・カテゴリー数はビルド時に実データから生成

#### B-2. コード重複の解消 ✅（実質解決）
- 記事HTMLは `templates/blog-post.html` から生成されるため、デザイン変更はテンプレート修正＋再ビルドで全記事に反映
- （CSSの外部ファイル化自体は未実施。必要になれば対応）

#### B-3. 日付形式のISO化 ✅
- frontmatter / blog-posts.json は `YYYY-MM-DD`。blog.html / blog-detail.html に `formatDateJa()` を追加し表示は「YYYY年M月D日」

#### B-4. 画像ファイル名の英数字化 ✅
- 3記事とも `thumbnail.webp` / `thumbnail.png` にリネーム（git mv）。参照はビルドで自動更新

#### B-6. README.md修正 ✅
- Eleventy記載を削除し、実際のMarkdownワークフローを文書化

#### B-8. sitemap.xml の lastmod ✅
- 記事は公開日、トップ/一覧ページはビルド日を自動設定

#### B-5. 一覧ページのSEO改善 ✅（2026-08-28）
- blog.html は `templates/blog-list.html` から自動生成に変更（**直接編集禁止**。テンプレートを修正して再ビルド）
- 記事一覧・最新記事・カテゴリー・タグをビルド時に静的HTML化（JS非対応クローラーでも読める）
- JSはカテゴリー絞り込み・キーワード検索・人気記事ランキング表示のみに縮小（検索ボックスはこの対応で実際に動作するようになった）
- 副次修正: blog.htmlの壊れたロゴ/ヒーロー画像（/api/placeholder/）、blog.html・記事テンプレートのfooter診療時間誤り（9:00〜12:00→9:30〜13:00, 14:30〜18:30/土曜17:00）

### 🟢 優先度：低

- [ ] B-7. RSSフィード（feed.xml）追加（build-blog.jsへの追加で対応可能）
- [ ] B-9. 存在しない記事IDアクセス時の404ページ整備

---

## ✏️ Web管理画面（Decap CMS）（2026-08-27 実装完了 / セットアップ残り）

VSCodeを使わず、ブラウザの管理画面（https://www.minoru-dental.jp/admin/ ）から記事を作成・編集できる仕組み。無料（Decap CMSはOSS、ホスティングは既存のVercel/GitHubのみ）。

### 仕組み
```
/admin/（Decap CMS 管理画面）
  → GitHub OAuthでログイン（api/auth.js, api/callback.js ※Vercelサーバーレス関数）
  → 記事を作成・編集 →「編集ワークフロー」（下書き→レビュー中→公開準備完了）で管理
  → 「公開」で content/blog/*.md にコミット
  → GitHub Actions（build-blog.yml）が自動ビルド（記事HTML / blog-posts.json / sitemap.xml をコミット）
  → 本番サイト（GitHub Pages）へ自動反映
```
- **注意**: 本番ドメイン（www.minoru-dental.jp）はGitHub Pages配信でサーバーレス関数が動かないため、OAuthのみVercel（https://minoru-dental.vercel.app）を利用（config.ymlのbase_url / 2026-08-27判明・対応済み）
- 公開前の記事はPull Requestとして保持されるため、**院長監修を「レビュー中」ステータスで運用できる**
- ローカルの `npm run build:blog` は不要になった（確認用に残置）

### 実装済み（2026-08-27）
- [x] `.github/workflows/build-blog.yml`（content/blog/** のpushで自動ビルド・自動コミット）
- [x] `admin/index.html` + `admin/config.yml`（GitHub backend / editorial_workflow / 日本語UI / ブログ・下書きの2コレクション）
- [x] `api/auth.js` / `api/callback.js`（GitHub OAuth。state Cookie照合によるCSRF対策付き）
- [x] 既存md 13ファイルに `slug` フィールド追加（CMS互換）
- [x] build-blog.js をfrontmatterのクォート付き値に対応（CMSがYAMLをクォートで書くケース）

### ✅ セットアップ完了（2026-08-28）
- [x] C-1. GitHub OAuth Appを作成（GitHub → Settings → Developer settings → OAuth Apps）
  - Homepage URL: `https://www.minoru-dental.jp`
  - [x] callback URLを `https://minoru-dental.vercel.app/api/callback` に修正済み（www.minoru-dental.jp はGitHub Pages配信のため不可）
- [x] C-2. Vercel環境変数を登録（Settings → Environment Variables）
  - `OAUTH_GITHUB_CLIENT_ID` / `OAUTH_GITHUB_CLIENT_SECRET`
- [x] C-3. `/admin/` からのログイン・記事一覧表示を確認済み（2026-08-28）

---

## 📊 人気記事ランキング機能（2026-08-27 実装・セットアップ完了 ✅）

### 仕組み
```
GitHub Actions（毎日6:00 JST）
  → WIF（Workload Identity Federation）でGoogle Cloudに認証（JSONキー不使用）
  → scripts/fetch-popular-posts.js がGA4 Data APIで直近90日の記事別PVを集計
  → popular-posts.json を生成・コミット
  → Vercelが自動デプロイ
  → blog.html サイドバーに「よく読まれている記事」TOP5を表示
```
- データが空・取得失敗の場合はセクション自体が非表示になる（サイトに影響なし）
- 手動実行: GitHubリポジトリ → Actions → 「人気記事ランキングの更新」→ Run workflow

### 設定情報（2026-08-27 セットアップ完了）
| 項目 | 値 |
|------|-----|
| GCPプロジェクト | `minoru-dental` |
| サービスアカウント | `ga4-popular-posts@minoru-dental.iam.gserviceaccount.com`（GA4閲覧者権限） |
| GA4プロパティID | `546270564`（GitHub Secret `GA4_PROPERTY_ID` に登録済み） |
| 認証方式 | Workload Identity Federation（Pool: `github` / Provider: `minoru-dental`、`ttksaito/minoru-dental` リポジトリに限定） |

※ 組織ポリシーによりサービスアカウントのJSONキー発行が禁止されていたため、当初予定のJSONキー方式からWIF方式に変更。`GA4_SERVICE_ACCOUNT_KEY` は不使用。

### 完了済み
- [x] GCPプロジェクト作成・Analytics Data API有効化
- [x] サービスアカウント作成・GA4に閲覧者として追加
- [x] WIF（Workload Identity Pool / OIDC Provider）設定・リポジトリ限定
- [x] GitHub Secret登録（GA4_PROPERTY_ID）
- [x] ワークフロー・スクリプトのWIF対応
- [x] 手動実行で動作確認（認証〜popular-posts.json生成まで成功。現時点は0件で正常）

### ⏳ 残タスク（データ蓄積待ち）
- [ ] P-6. データ反映の確認（目安: 1〜2週間後）
  - GA4の「レポート」→「エンゲージメント」→「ページとスクリーン」で `/blog/` 配下のPVが記録され始めているか確認
  - Actionsの実行ログで「popular-posts.json を更新しました（1件以上）」になっているか確認
  - https://www.minoru-dental.jp/blog.html のサイドバーに「よく読まれている記事」が表示されるか確認
- [ ] P-7. ランキング表示の見た目調整（実データ表示後に必要なら実施）

### 📌 注意事項
- ブログ関連ページのGAタグが `G-XXXXXXXXXX`（プレースホルダー）のままだったため、2026-08-27に `G-P8PPKGZVRT` へ修正済み。**それ以前のブログ閲覧データはGA4に存在しない**ので、ランキングにデータが反映されるのは修正デプロイ後にアクセスが蓄積されてから
- 記事が3本しかない間はランキングの意味が薄い。記事を増やす（B-1参照）ことが先決

---

## 📈 継続的なタスク

### Googleビジネスプロフィール運用

#### 毎週
- [ ] 新しい写真を1〜2枚追加
- [ ] 投稿を1回作成（お知らせ、ブログ記事など）
- [ ] クチコミに返信（新しいレビューがあれば）

#### 毎月
- [ ] パフォーマンスデータを確認
  - 表示回数
  - クリック数
  - 電話発信数
  - ルート検索数
- [ ] 写真を追加（季節やイベントに合わせて）
- [ ] 営業時間・休診日の更新（変更があれば）

### Webサイト

#### 毎月
- [ ] Google Analyticsでアクセス解析
  - ページビュー数
  - ユーザー数
  - 流入元
  - 離脱率
- [ ] ブログ記事を1本追加（可能であれば）

---

## 🎯 長期目標（3ヶ月後の目標値）

### Googleビジネスプロフィール
- 表示回数: 5,000〜8,000回/月
- クリック数: 200〜300回/月
- 電話発信: 50〜80回/月
- ルート検索: 30〜50回/月
- クチコミ: 10件以上（平均4.5以上）

### Webサイト
- 月間訪問者数: 500人以上
- 直帰率: 60%以下
- 平均滞在時間: 2分以上
- お問い合わせ: 月10件以上

---

## 📞 緊急時の連絡先

### Vercelデプロイ
- URL: https://minoru-dental.vercel.app
- 管理画面: https://vercel.com/dashboard

### Google Analytics
- 測定ID: G-P8PPKGZVRT
- 管理画面: https://analytics.google.com

### Googleビジネスプロフィール
- 管理画面: https://business.google.com

---

## 📝 メモ

### 完了したコミット
- Phase 1 SEO improvements
- Phase 2 UX improvements
- Phase 3 SEO improvements
- Google Analytics tracking
- URL updates to production domain

### 技術情報
- フレームワーク: 静的HTML
- ホスティング: Vercel
- ドメイン: minoru-dental.vercel.app
- Git リポジトリ: github.com:ttksaito/minoru-dental.git

---

## ✅ チェックリスト（明日）

**2025-07-21 朝一番にやること**:
- [ ] Googleビジネスプロフィールのオーナー確認を完了
- [ ] 写真10枚を準備・撮影
- [ ] 写真をアップロード

**完了予定時刻**: 2025-07-21 12:00まで

---

このTODOリストは定期的に更新してください。
