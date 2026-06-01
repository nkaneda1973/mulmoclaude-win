# fix(deps): pin vite to 8.0.13 — 8.0.15 breaks e2e mass (#1579)

## 背景

PR #1572（2026-06-01 の deps 一括更新）が `vite` を 8.0.13 → 8.0.15
にしたところ、e2e (shard 1) が大量失敗・タイムアウトで CI の
`timeout-minutes: 15` を踏み抜いてキャンセル。#1572 はすでに main で
リバート済みで、現状は `vite ^8.0.13` が active。

## ローカル再現

main (HEAD `4eab2b85`) から debug ブランチで切り分け検証:

| vite | 結果 | 時間 |
|---|---|---|
| `8.0.13`（baseline）| 237 passed | **5.2 min** |
| **`8.0.15`** | **3 passed**、残り fail/timeout | **7.2 min**（CI なら 15 min 制限を踏む）|

実行: `yarn add -W vite@8.0.15 && yarn test:e2e -- --shard=1/2`。
puppeteer 25.0.3 → 25.1.0 は **e2e 経路に絡まない**ことを確認
（puppeteer は `server/api/routes/pdf.ts` 専用、e2e は Playwright + 専用
Chromium）。よって vite が単独原因。

## 仕様

- `package.json` の `devDependencies.vite` を **`"8.0.13"`（exact、
  caret なし）** に変更
- `yarn.lock` も 8.0.13 に固定
- 将来の `yarn upgrade` / Dependabot で 8.0.15 が silently 入り込むのを
  防ぐ
- 解禁のタイミングは別 issue で changelog 調査後に判断
  （8.0.14 / 8.0.16+ で safe なら caret 復帰 or 上位 pin に移行）

## 変更ファイル

- `package.json` — `"vite": "^8.0.13"` → `"8.0.13"`
- `yarn.lock` — 反映
- `plans/fix-pin-vite-8.0.13-1579.md`（このファイル）

## 検証

- `yarn lint` / `yarn typecheck` / `yarn build` green（vite version の
  patch 差分は build 出力に影響しない）
- e2e は main と意味的に同じ vite バージョンに固定なので回帰なし
  （直前の baseline で 237 passed 確認済み）

## スコープ外（別 PR）

- **vite 8.0.13 → 8.0.14 / 8.0.15 の breaking change 特定**
  （changelog 当たり、upstream issue / safe-bump 判定）
- 他 deps の caret → exact pin への一般化
- `timeout-minutes: 15 → 20` への余裕化
