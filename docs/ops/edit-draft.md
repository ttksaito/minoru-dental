# 下書きの修正（PR コメントで自然言語の指示 → AI が直す）

人間は GitHub の PR ページ（確認メールの「公開する」ボタンで開くページ）の一番下のコメント欄に、
日本語で直してほしいことを書くだけ。例:

- 「3 段落目が長いので半分に」
- 「タイトルに『東松山市』を入れて、もう少し柔らかく」
- 「休日歯科センターの電話番号は 0493-xx-xxxx。市の公式ページで確認済みなので本文に入れて」
- 「まとめの前に『子どもの場合』の見出しを足して」
- 「サムネの文字を『日曜に歯が痛い！東松山の相談先』にして」（仮サムネの文字を変える）
- 写真を添付して「サムネはこれにして」（添付画像をサムネにする）

修正担当のエージェント（routine `trig_01DkdubRACRuw8RJegjm4Yzx`、毎時 0 分・7:00〜23:00 JST）が未対応のコメントを見つけて修正し、push して PR に「🤖 直した内容」を返信する。
push によって確認メールも修正版で再送される。納得したら「Merge pull request」で公開。
反応までは最大 1 時間。コメントは 1 つの PR に何回でも書ける（会話のように続けられる）。

> 即時反応にするには、https://claude.ai/code/routines でこの routine に GitHub の `issue_comment` イベントのトリガーを付ける（運営者の操作が必要。Claude Code からの作成は安全確認で止められた）。

## エージェントへの指示（毎時起動する定期エージェントはこの節に従う）

あなたは「みのる歯科」サイトのブログ下書きを、運営者のコメントに従って修正するエージェント。リポジトリはチェックアウト済み。GraphQL（`gh pr` 系コマンド）は使えないので `gh api` の REST だけ使う。

### 0. 未対応のコメントを探す
1. `gh api 'repos/ttksaito/minoru-dental/pulls?state=open&per_page=50'` でオープンな PR を取り、`head.ref` が `cms/blog/` で始まるものだけ対象にする
2. 各 PR の `gh api repos/ttksaito/minoru-dental/issues/<番号>/comments?per_page=100` を見る
3. 「最後の `🤖` で始まるコメント（なければ PR 作成時刻）より後に、`user.login` が `ttksaito` が書いた、`🤖` で始まらないコメント」が未対応
4. 未対応がなければ「未対応のコメントなし」とだけ出力して終了
5. 修正指示でないコメント（「ありがとう」「OK」など）には `🤖 了解しました` のような短い返信だけ返し、次回以降の対象から外す

### 1. ブランチを取り出す
```bash
git fetch origin
git checkout -B cms/blog/<slug> origin/cms/blog/<slug>
```
slug はブランチ名の `cms/blog/` 以降。記事は `content/blog/<slug>.md`。

### 2. 直す
- `docs/ops/blog-workflow.md` の「② 下書きを書く」「③ セルフチェック」のルールは修正後も守る（断定しない、治療法の優劣を書かない、数字は出典付き、運営者視点）
- 運営者が「確認済み」と明言した事実（電話番号・時間など）はそのまま反映してよい。明言がない数字は追加しない
- 指示にない部分は変えない。文体・構成は元の記事に合わせる
- frontmatter の `slug` と `image` は変えない。タイトル変更の指示があれば `title` を変える（`slug` は変えない）
- 変更が summary や date に関わるなら整合させる
- 指示が曖昧で複数の解釈がある場合は、いちばん自然な解釈で直し、返信にその旨を書く。指示が実行不能（事実が確認できない等）な場合は直さずに返信で理由を伝える

### 2b. サムネイルの指示があるとき
- **文字を変える指示**: `content/.thumb-overrides/<slug>.json` を書く（例 `{"title": "日曜に歯が痛い！東松山の相談先", "tags": ["緊急時の相談先"], "sub": "休日歯科センターの使い方"}`）。`title` は 30 文字以内、`sub` は任意。画像そのものは作らない（push 後に GitHub Actions が Chrome で作り直す）。frontmatter の `image` は `/blog/uploads/<slug>.png` のまま
- **画像が添付された指示**: コメント本文の画像 URL（`https://github.com/user-attachments/assets/...` や `![...](...)`）を `curl -fsSL -o blog/uploads/<slug>-custom.<拡張子> <URL>` で保存する（拡張子は `file` コマンドか Content-Type で判定。png/jpg/webp のみ）。成功したら frontmatter の `image` を `/blog/uploads/<slug>-custom.<拡張子>` に変える。ダウンロードできなければ直さずに、返信で「画像を取得できなかったので CMS のサムネイル欄からアップロードしてください」と伝える
- 変更したファイル（json / 画像 / md）は 3 のコミットに含める

### 3. push して返信
```bash
git add content/blog/<slug>.md content/.thumb-overrides/<slug>.json blog/uploads/<slug>-custom.* 2>/dev/null
git commit -m "記事を修正: <slug>（コメント対応）"
git push origin cms/blog/<slug>
gh api -X POST repos/ttksaito/minoru-dental/issues/<番号>/comments -f body="🤖 直しました。
- <変更点を箇条書き、1〜5 行>

数分後に修正版の確認メールが届きます。よければ上の「Merge pull request」で公開してください。"
```
- 返信は必ず `🤖 ` で始める（自分の返信で再起動しないため）
- 直さなかった場合も `🤖 ` で始めて理由を返信する
- main には触らない。マージしない

### 最後に出力すること
PR 番号、受け取った指示の要約、変更点、返信したかどうか。
