# 運用タスクの資料置き場

Google カレンダーに登録した定期タスクには、Claude Code に貼り付けるプロンプトが書いてあります。
プロンプトはこのフォルダのファイルを指しているので、Claude はまずそのファイルを読んでから作業します。

| 日付 | ファイル | 内容 |
|---|---|---|
| 2026-11-15 | `2026-11-15-ga4-key-events.md` | GA4 キーイベント登録の仕上げ → Google 広告へのインポート |
| 2026-12-05 | `2026-12-05-top-page-seo-check.md` | トップページ見直しの効果確認（「東松山 歯医者」の順位） |
| 2026-12-05 | `2026-12-05-google-ads-check.md` | Google 広告の配信範囲 10 km・リンク先サイト化の効果確認 |

## 日付に紐づかない手順書

| ファイル | 内容 |
|---|---|
| `blog-workflow.md` | ブログ投稿のフロー（ネタ決め→執筆→チェック→公開→数値確認、下書きストックの扱い） |

## 共通の前提

- 集客ダッシュボード: https://www.minoru-dental.jp/dashboard/ （パスワードは GitHub Secrets の `DASHBOARD_PASSWORD`）
- Claude が数値を読むときは、最新を取り込んでから復号する:
  ```bash
  git pull
  DASHBOARD_PASSWORD='パスワード' node scripts/decrypt-dashboard-data.js
  ```
  復号結果は `dashboard/data.json`（git 管理外）に出る。要点はコマンドの出力にも表示される
- ダッシュボードのデータは毎朝 6:30 JST に更新。手動更新は GitHub Actions「集客ダッシュボードの更新」→ Run workflow（`gh workflow run update-dashboard.yml`）
- 優先順位の全体像は `TODO.md` の先頭セクション
