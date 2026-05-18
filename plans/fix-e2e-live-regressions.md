# fix-e2e-live-regressions

`yarn test:e2e:live` を main(675c3e2a) で 2 周 (Docker off / on) 回した結果、5 シナリオが fail。原因調査と修正計画。

## 結果サマリ

| モード | passed | failed | did not run | 所要時間 |
|---|---:|---:|---:|---:|
| Docker **off** (1 周目) | 38 | 4 | 1 | 6.2 min |
| Docker **on** (2 周目) | 39 | 4 | 0 | 9.4 min |

## 失敗テスト一覧

| ID | spec | Docker off | Docker on | 初回 PR scope |
|---|---|:---:|:---:|:---:|
| L-ERR | [error-banner.spec.ts:17](e2e-live/tests/error-banner.spec.ts#L17) | fail | fail | ✅ |
| L-22 | [skills.spec.ts:111](e2e-live/tests/skills.spec.ts#L111) | fail | fail | ✅ |
| L-15b | [wiki-nav.spec.ts:155](e2e-live/tests/wiki-nav.spec.ts#L155) | fail | fail | ✅ |
| L-SETTINGS-EFFORT | [settings.spec.ts:155](e2e-live/tests/settings.spec.ts#L155) | fail | pass | 2nd PR |
| L-31 | [skills.spec.ts:205](e2e-live/tests/skills.spec.ts#L205) | pass | fail | 2nd PR |

PR の切り方: **初回 PR は両モード fail (L-ERR / L-22 / L-15b)**。 モード差分のあるテストは別 PR。

---

## L-ERR — 真の症状 = 別エラー (409) が表示されている

期待した fake-echo の forced error は **届いておらず**、 代わりに `POST /api/agent` の **409 Conflict** がエラーカードに出ている。

- **期待**: `fake-echo forced error for the e2e-live error-banner canary`
- **実際**: `[Error] Server error 409: {"error":"Session is already running"}`

`text-response-assistant-body` testid 自体は存在する。 中身が違う。 fake-echo の `__FAKE_ERROR__` 検知ロジック ([server/agent/backend/fake-echo.ts:89](server/agent/backend/fake-echo.ts#L89)) より手前で、 backend が「session が既に running」と判断して 409 を返している。

### 仮説

- `startNewSession` 直後に `sendChatMessage` が走り、 まだ前の turn が in-flight な状態でバックエンドが 409 を返す
- session race / state 管理の問題で、 fake-echo backend 切替直後特有の挙動の可能性
- **回帰させた PR は未特定**。 fake-echo backend 周りで session in-flight 判定が厳しくなった PR を探す必要あり

### 次のアクション

- [ ] `git log --oneline -p -S "Session is already running"` で 409 を投げる箇所と最近の変更を確認
- [ ] `startNewSession` フィクスチャ ([e2e-live/fixtures/live-chat.ts](e2e-live/fixtures/live-chat.ts)) の実装を読み、 初期 turn の有無を確認
- [ ] dev sub-agent: L-ERR root cause を再調査 (この発見を踏まえて再フォーカス)

---

## L-22 — 真の症状 = Claude が seeded skill の実行に失敗

assistant の応答 (Japanese, real LLM):

> "スキル e2e-live-l22-... の実行を試みましたが、エラーが返りました。 これは L-22 canary スキル ... として登録されているもののようです。"

- skill 自体は staged されている (sidebar に `/e2e-live-l22-chromi` が見える)
- slash command `/e2e-live-l22-...` は送信されている
- だが Claude の skill 実行 (Agent SDK 経由) が失敗 → 自然言語で言い訳

### 仮説

- PR **#1386** (external skill repos backend, 0135527e) で skill catalog/discovery 機構が変わった影響の可能性 (medium confidence)
- PR **11fdf900** (`refactor(hooks): unify into one dispatcher; bridge data/skills/ → .claude/skills/`) で skill 実行系の hook 経路が変わった影響の可能性
- skill body が staged 場所 (`.claude/skills/<slug>/SKILL.md`) にちゃんと書き出されているかを test 走行中に確認する必要あり

### 次のアクション

- [ ] L-22 test の seed コードを読み、 何処に SKILL.md を書いているか確認
- [ ] 失敗時の `.claude/skills/<slug>/SKILL.md` の中身を物理的に確認 (test cleanup されてしまうので run 中 trace 必須)
- [ ] `git log --since='2026-05-10' -- server/skills server/api/routes/skills.ts server/workspace/hooks/`

---

## L-15b — 真の症状 = target page が "does not exist yet"

navigation 後の page snapshot:

```
- heading "日本語タイトル-chromium-L-15b-1779093371043-6a6e0c" [level=2]
- paragraph: The page "日本語タイトル-chromium-L-15b-..." does not exist yet.
- button "auto_fix_high Request creation of this wiki page"
```

[src/plugins/wiki/View.vue:232-246](src/plugins/wiki/View.vue#L232-L246) によれば `wiki-page-body` testid は `pageExists` かつ `content` が非空のときだけマウントされる。 ここは `pageExists === false` の枝。

つまり target page の **seed が disk に届いていない or wiki backend が non-ASCII slug を resolve できていない**。 fuzzy-resolve バグ (PR #1194 の sentinel) というより、 そもそもページの作成 / 検出 で失敗している。

### 仮説

- non-ASCII slug の seed が、 最近の wiki resolve / file write 周りの refactor で壊れた
- 候補 PR (要確認):
  - `dbeb1019 refactor(wiki): pure-text helpers in src/lib/wiki-page/ — fixes #1297`
  - `423d7a5c fix(wiki): score-based fuzzy resolve to stop iteration-order miss-matches (#1194)`
  - `f16eafdb fix(wiki): parseBulletWikiLinkRow splits [[slug|display]] via parseWikiLink`
- test fixture (`seedWikiPage` 相当) を確認、 何の API でファイルを書いているか追跡

### 次のアクション

- [ ] `e2e-live/fixtures/` の wiki seed helper を読む
- [ ] non-ASCII slug の write/read の挙動を `git log -p` で確認
- [ ] `git bisect` の対象範囲を絞る (前回 pass していた commit が分かれば bisect が確定)

---

## L-SETTINGS-EFFORT (Docker off only) — 2nd PR

- 期待: `effortLevel` を clear すると settings.json から key が消える (null sentinel)
- 実際: `effortLevel: "low"` が残る
- Docker on では pass、 off のみ fail → 環境依存 (FS event の reorder?) かフレーキーの可能性

### 次のアクション (初回 PR 後)

- [ ] settings.json の write 経路を確認 ([server/utils/files/settings-io.ts](server/utils/files/settings-io.ts) 等)
- [ ] null sentinel handling のロジックを確認
- [ ] Docker off だけで再現するか、 フレーキーかを切り分け (リトライ)

---

## L-31 (Docker on only) — 2nd PR

- 期待: General role の agent が `data/skills/<slug>/SKILL.md` に `Write` する
- 実際: `Write` 呼び出しが行われない (`stagingWrites: []`)
- Docker on のみ fail → サンドボックス境界で hook bridge が動いていない可能性

L-22 と一見近いが別のレイヤ (L-22 は skill 実行、 L-31 は skill 作成)。 PR #1430 でロール分割が入ったが、 `mc-manage-skills` は skill preset で `availablePlugins` には乗らないため General からは引き続き使えるはず。

### 次のアクション (初回 PR 後)

- [ ] sandbox mode で hook bridge (`server/workspace/hooks/dispatcher.mjs`) が動くかを確認
- [ ] L-22 を直したら L-31 も直る可能性があるので、 初回 PR 後に再実行して挙動を見る

---

## 進捗管理

- [x] worktree 作成 + deps install
- [ ] **L-ERR / L-22 / L-15b 各々の breaking PR (or root cause) を特定**
- [ ] 初回 PR (両モード fail 3 件) 修正
- [ ] 初回 PR の codex-cross-review
- [ ] 初回 PR マージ後に再度 e2e-live を 2 周
- [ ] 2nd PR (L-SETTINGS-EFFORT, L-31) スコープ精査と修正
