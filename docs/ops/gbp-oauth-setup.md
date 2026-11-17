# ビジネスプロフィールのデータ取得を運営者アカウントの OAuth に切り替える

作成: 2026-11-17（同日に設定完了。以下は再設定するときの手順）

## 現在の設定

- OAuth 同意画面: アプリ名「みのる歯科ダッシュボード」、対象 **内部**（info@minoru-dental.jp の Workspace 組織内だけ。Google の確認不要、トークンの 7 日失効なし）、スコープ business.manage
- OAuth クライアント: デスクトップ アプリ `dashboard-gbp`
- 認可したアカウント: info@minoru-dental.jp（店舗「みのる歯科医院」の管理者、locations/17449218090490710647）

## 背景

- ビジネスプロフィール API の利用申請は 2026-11-17 に承認された（ケース 2-7334000041728、300 QPM）。
- しかし、ダッシュボードが使っているサービスアカウント（`ga4-popular-posts@minoru-dental.iam.gserviceaccount.com`）は、店舗の管理者招待を API で承諾しようとすると `400 FAILED_PRECONDITION (Precondition check failed)` になる。これはサービスアカウント全般に起きる既知の制限で、Google のフォーラムでも未解決。
- そのため、店舗のオーナー/管理者である運営者の Google アカウントで一度だけ OAuth 認可し、そのリフレッシュトークンでマップのデータを取る方式にする。GA4・Search Console・Clarity は今までどおりサービスアカウント。

## 手順（30 分ほど、1 回だけ）

### 1. Google Cloud で OAuth クライアントを作る

Google Cloud Console → プロジェクト `minoru-dental`（番号 522170574882）で:

1. **API とサービス → OAuth 同意画面**
   - ユーザーの種類: **内部**（Workspace のアカウントで店舗を管理している場合。Gmail で管理しているなら外部にし、テストユーザー追加と本番公開が必要）
   - アプリ名: みのる歯科ダッシュボード、サポートメール: 運営者のメール
   - スコープ: 「スコープを追加」で `https://www.googleapis.com/auth/business.manage` を追加
   - テストユーザー: 店舗を管理している Google アカウントを追加
   - 作成後、**「アプリを公開」で本番環境にする**（テスト状態のままだとリフレッシュトークンが 7 日で失効する）。「確認が必要」と出ても、自分しか使わないので確認申請は不要。認可画面で「このアプリは Google で確認されていません」と出たら「詳細 → （アプリ名）に移動」で進める
2. **API とサービス → 認証情報 → 認証情報を作成 → OAuth クライアント ID**
   - アプリケーションの種類: **デスクトップ アプリ**
   - 名前: dashboard-gbp
   - 作成後に出るクライアント ID とクライアント シークレットを控える（JSON をダウンロードしてもよい）
3. **API とサービス → ライブラリ** で次が有効になっているか確認（承認メールにも「Activate the API」とある）
   - My Business Account Management API
   - My Business Business Information API
   - Business Profile Performance API

### 2. 認可してリフレッシュトークンを取る（運営者の PC で）

クライアント作成時にダウンロードした JSON（`client_secret_….json`）を ~/Downloads に置いたまま、1 行で実行する（JSON を自動で読む。別の場所なら引数でパスを渡す）。

```bash
cd ~/projects/minoru-dental && node scripts/gbp-oauth-setup.js
```

コマンドを 2 行に分けて貼ると `node` だけが動いて入力待ちになるので注意。

- 表示された URL をブラウザで開き、**店舗を管理している Google アカウント**でログインして許可する
- ターミナルに「見える店舗: みのる歯科医院（locations/…）」と出れば権限は足りている。出なければログインしたアカウントが店舗の管理者ではない
- 続けてリフレッシュトークンと、Secrets 登録用のコマンドが表示される

### 3. GitHub Secrets に登録する

```bash
gh secret set GBP_CLIENT_ID --body 'xxxx.apps.googleusercontent.com'
gh secret set GBP_CLIENT_SECRET    # 貼り付け → Enter → Ctrl-D
gh secret set GBP_REFRESH_TOKEN    # 貼り付け → Enter → Ctrl-D
```

トークンはターミナル以外（メモ、チャット、git）に残さない。

### 4. 確認

```bash
gh workflow run update-dashboard.yml
```

ログの「GA4・Search Console からデータを取得」に「ビジネスプロフィール: 運営者アカウントの OAuth トークンで取得します」「ビジネスプロフィール: みのる歯科医院（locations/…）」と出て、ダッシュボードのサマリーに「Google マップ」の数値が入れば完了。初回は過去 18 か月ぶんのうち直近 90 日を取る。

## うまくいかないとき

| 症状 | 対処 |
|---|---|
| `invalid_grant` | リフレッシュトークンが失効。同意画面が「テスト」のままなら本番に公開してから手順 2 をやり直す |
| refresh_token が表示されない | Google アカウント → セキュリティ → サードパーティのアプリとサービス でこのアプリの接続を解除し、手順 2 をやり直す |
| 見える店舗がありません | ログインしたアカウントが店舗のオーナー/管理者ではない。ビジネスプロフィールの管理画面 → ユーザー で確認 |
| 403 / API が無効 | 手順 1-3 の 3 つの API を有効にする |

## 関連

- サービスアカウント宛ての招待は承諾できないまま残る。害はないが、気になるならビジネスプロフィールの管理画面 → ユーザー から削除してよい
- 取得コード: `scripts/fetch-dashboard-data.js` の `getGbpToken()`。`GBP_REFRESH_TOKEN` が無いときは従来どおりサービスアカウントで試す
