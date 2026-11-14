# サムネイルの上書き設定

`content/.thumb-overrides/<slug>.json` に {"title": "...", "tags": ["..."], "sub": "..."} を置くと、
`scripts/make-thumbnail.js` がその文字で仮サムネイルを描く（GitHub Actions が push 時に作り直す）。
運営者が PR コメントで「サムネの文字を〜にして」と頼んだときに、修正エージェントが書く。本番サイトには出ない。
