# MulmoClaude — Product Hunt Launch Strategy

> **Canonical launch plan.** This file is the single source of truth for the Product Hunt launch. Its spine is the **file-system memory in two forms** — a linked **wiki** (Karpathy's LLM knowledge base, shipped) and **DSL-authored collections** that turn structured data into apps — operated by the platform surface from `README.md` / `MANIFEST.md` (Claude as a *universal controller*; *chat summons GUIs*). The earlier split drafts (`launch-ph-listing.md`, `launch-product-hunt-ja.md`) are retired to `plans/obsolete/`. The HN launch already ran with little traction (`plans/done/launch-hn.md`); **PH now stands alone** — do not assume an HN warm-up precedes it.

**Owner:** Satoshi (strategy + maker post), Engineering (demo assets + activation path), Community (day-of ops)
**Target launch:** **Tuesday, June 23, 2026 — 12:01 AM PT kickoff** (today is 2026-06-06; this gives ~2.5 weeks of asset build. Slip to June 30 if the activation path (§10.5) isn't ready — do not launch without it.)
**Install / CTA (verified):** `npx mulmoclaude` — the published one-command launcher. *(`npx create-mulmoclaude` does not exist; never ship it.)*

---

## 0. The spine — file-system memory in two forms (read this first)

**The key to MulmoClaude is not the UI, the chat, or even the agent. It's the memory that accumulates on the file system — `~/mulmoclaude/`.** Everything else is how you write to it, read from it, and act on it. The agent has a home, and the home is the database. Hold this as the spine; every surface traces back to it, and no surface may contradict the README.

**That memory exists in two forms — and the second is what puts us a step or two past the state of the art.**

**Form 1 — the Wiki (unstructured memory).** Pages of prose linked by `[[links]]`, grown automatically from every chat. This is *what Claude knows*. It is exactly Karpathy's *LLM knowledge base* idea — shipped, maintained by the agent itself, in plain Markdown.

**Form 2 — Collections (structured memory).** The same folder also holds *structured* records under a schema. The leap: **the schema is a small DSL, so writing that DSL turns the memory into an application.** Fields, references, computed values, action buttons, scheduled triggers — declare them and the data starts to *compute, relate, and act*. A reading list, an invoicing app, a CRM, a portfolio tracker — each is a schema, not code. This is *what Claude can do*: memory that doesn't just inform, it runs.

**Why this is Karpathy +1 and +2.** Karpathy gave the LLM a wiki (Form 1) — linked prose it builds and reads. **Step one: we add structured memory beside the prose.** **Step two — the deep one: that structure is authored by a DSL, which makes it a harness.** A deliberately-limited, legible, *validatable* surface the **user** declares and Claude operates inside. Designing the environment an agent works in (the harness) used to be an engineer's job; with Collections the end user does it by writing a tiny schema, and **Claude is the runtime.** Applications stop being code engineers write and become *data users author*. This is the freshest, most defensible thing we ship — and the most significant in LLM-engineering terms.

**How you operate the memory (the platform surface — matches `README.md` / `MANIFEST.md`).** Wrapped around the two-form memory is the application platform: **Claude is a universal controller** that composes across both forms (and every plugin) in a single turn, and **chat summons the right GUI** to view or edit either — markdown, wiki page, chart, form, spreadsheet, 3D scene, narrated video. The agent↔GUI contract is an open protocol (`gui-chat-protocol`) extending MCP for the visual layer. **The platform is the *means*; the two-form memory is the *point*.**

**It's all yours.** Both forms are plain files — Markdown for the wiki, JSON + schema for collections — in one local folder. git-friendly, inspectable, no cloud, no lock-in.

**2026 reality check:** rich output (Artifacts), mobile AI (OpenClaw), sandboxing, code generation are **commoditized** — never lead with them. The live frontier is exactly the spine: **a file-system memory in two forms, the structured one authored by a DSL the user writes — Karpathy's wiki plus an app layer no one else has.**

**Target early adopter (one audience):** Claude power users who have hit the limits of a single chat and a terminal. Honest tension: the "ask → app appears" hook reads non-engineer, but our channels (PH Dev Tools, r/ClaudeAI) are engineers. **Resolution:** to engineers, frame Form 2 as *"you stop writing a plugin per feature — you write a small schema (a DSL) and Claude runs it."* The harness framing is the engineer-legible version of the same magic. Phase-2 audiences (productivity, knowledge workers, JP, enterprise) arrive later, pulled by the dev-native gravity.

---

## 1. Taglines & category

### Product Hunt listing fields

- **Name / headline (≤60):** `MulmoClaude — a local AI memory that grows into apps` *(51 chars — the two-form-memory spine: it remembers, and the structured half becomes software)*
- **Tagline (≤60):** `A linked wiki + apps you build by asking. All local.` *(51 chars)*

### Supporting taglines (A/B for social + hero imagery)

1. *Karpathy gave the LLM a wiki. MulmoClaude adds a second memory — structured data that becomes apps when you write a schema.*
2. *Two memories in one folder: a linked wiki (what Claude knows) and DSL-authored collections (what Claude can do).*
3. *Need an app? Don't install a plugin — write a tiny schema, or just ask. The data becomes the app; Claude is the runtime.*
4. *A schema is a harness. The user writes it, Claude runs it. That's how memory turns into software.*
5. *`~/mulmoclaude/` — your wiki and your apps, all plain Markdown/JSON, all yours.* **(geek-targeted: HN, X-dev, terminal-native.)**

### Category

Primary **Developer Tools** · Secondary **Artificial Intelligence** · Tertiary **Open Source** (MIT, npm-distributed, the protocol is part of the product). Skip Productivity — chasing two audiences on PH day lands neither.

---

## 2. The one-sentence pitch

**MulmoClaude's core is a file-system memory that grows in two forms — a linked wiki of everything Claude learns, and schema-driven collections where writing a small DSL turns that memory into working apps — all operated by Claude as a universal controller that summons the right GUI, as plain files in one local folder you own.**

Clauses in the order a viewer asks them: *What's the memory? → How does it become apps? → Who operates it? → Whose is it?*

### The anti-wrapper line (use whenever "is it just a ChatGPT clone?" appears)

> **This doesn't call the Claude API. It runs Claude Code directly — your auth, your tools, your files, your environment. The host contains zero domain code; every app is a schema you or Claude authored.**

Repeat verbatim in the maker post, any HN relaunch, and tweet #1.

---

## 3. Why this wins on Product Hunt

| Hunt instinct | MulmoClaude's answer |
| --- | --- |
| "Another AI chat wrapper?" | No — it runs the Claude Code CLI directly (not the API), and the pitch is **a platform Claude composes across, that you extend by asking.** |
| "What's the new idea?" | **Two forms of memory in one folder.** Karpathy's linked wiki (what Claude knows) *plus* DSL-authored collections (what Claude can do) — write a small schema and the data becomes an app, with Claude as the runtime. Zero host code. |
| "Isn't that Airtable / Notion / Retool?" | Those are no-code too — but an *engineer* designs the environment and there's no agent runtime. Here the **user** declares a schema (a DSL) and **Claude operates inside it.** |
| "Isn't that just MCP?" | MCP is transport (agent↔tool). `gui-chat-protocol` adds the layers MCP doesn't: **GUI surfaces, agent↔UI state, and cross-plugin composition.** It sits *on top of* MCP. |
| "What's the moat?" | **Memory that compounds, in two forms.** The wiki links keep growing (Karpathy's KB idea, shipped) and so does your set of DSL-authored apps — all local plain text, painful to leave. |
| "Why care tomorrow?" | It **works while you sleep.** Register a source → morning briefing. Declare a recurring obligation as a collection → it nudges you before each due date. |

---

## 4. Key messages (4, rank-ordered)

A PH viewer remembers **one** idea in ~10 seconds. Lead with the spine: the two-form memory.

**1. Memory in two forms — a linked wiki, and apps you grow by schema.** — *Karpathy gave the LLM a wiki. This adds a second memory that becomes software.*
MulmoClaude's heart is the memory that accumulates in `~/mulmoclaude/`, and it grows in two directions:
- **The wiki (what Claude knows).** A cross-linked Markdown knowledge base that grows automatically from every chat — Karpathy's LLM-KB idea, shipped. Ask a question three days later and Claude wires it to what it learned, with nothing saved by hand.
- **Collections (what Claude can do).** The same folder holds structured records under a schema — and **the schema is a tiny DSL, so writing it turns the memory into an app.** "Build me an invoicing app with line items and a PDF button" → fields, a computed total, a "Generate PDF" action appear, with **zero host code**. Update one stock quote and every portfolio holding revalues via a reference (`value = shares × ticker.price`). You asked for it; you didn't code it.

This is the headline and the moat at once: the wiki remembers, the collection remembers *and runs*, and the structured half is a **harness the user authors and Claude executes** — the genuine step past the state of the art.
- *vs ChatGPT Memory:* a bullet list, not a cross-linked knowledge base — and it can't become an app.
- *vs Mem.ai / Obsidian:* zero manual effort; the wiki grows as a byproduct of conversation.
- *vs Airtable / Notion / Retool:* no-code too, but an engineer designs the environment and no agent runs inside. Here the user declares a schema (a DSL) and Claude operates within it.
- *vs plugin marketplaces (incl. our own retired Worklog/Client/Invoice plugins):* no install, no marketplace, no per-feature prompt bloat. One generic engine; infinite user-authored apps.
- *Engineer framing:* you stop writing a plugin per feature; you write a small schema and Claude runs it.

**2. Claude operates both forms — universal controller; chat summons the GUI.** — *One chat reads the wiki and runs the apps, and the reply isn't a string — it's the right surface.*
Claude composes across the whole plugin registry in a single turn: *"summarize Q1 expenses as a chart"* reads accounting, writes a chart — no app-switching, no copy-paste. And the agent picks the *format* for the content: markdown for prose, a chart/form/wiki/spreadsheet/3D-scene surface for rich output, MulmoScript for narrated video. It can also ask *you* for structured input via a form when free text isn't right.
- *vs Claude Desktop / one-agent-plus-tools:* this is a registry of GUI-bearing apps Claude composes across — a different layer of the stack.
- *The open protocol:* `gui-chat-protocol` is a versioned npm package extending MCP; built-in plugins, third-party npm plugins, and any future host implement the same contract.

**3. The agent that works while you sleep.** — *Other agents wait for you. This one has a schedule, and the apps wire into it.*
Register a source → a morning briefing is waiting; schedule a report → find it done; declare a recurring obligation as a collection → it reminds you ahead of each due date and rolls itself to the next cycle, no code. Behaviors are declarative too — a reading-list collection lights up the notification bell for every unread link from three keys in its schema.
- *vs Devin / Codex / Claude Code today:* one-shot executors that stop when you close them; this runs on a schedule with catch-up after missed runs.
- *Why it compounds with #1:* autonomous runs keep writing into both forms of memory — the wiki and the collections — while you're not looking.

**4. Your machine, your data, your apps.** — *It all lives in `~/mulmoclaude/`. Plain Markdown/JSON. Git-friendly. No cloud. No lock-in.*
Web articles, chats, local files, generated images/videos, search results, scheduled outputs — **and the apps themselves** (every collection is a `schema.json` + plain-JSON records) — land in one folder as plain text. `git push` is the backup; open any file in any editor; read it in 10 years with no migration.
- *vs Notion / Mem.ai / ChatGPT:* not cloud; no export flow because it's already plain text on disk.
- *vs Obsidian:* local, but the AI grows it for you.
- Sandbox (Docker, auto-detected) folds in here — it's *how* "your machine, your data" stays honest, not a separate pitch.

### Visual hooks (demo bangers, not messages)

- **"Ask → app appears."** Type *"make me an invoicing system with line items and a PDF button"* and watch a real app materialize — fields, a live computed total, an action button. The single most novel thing we can show; use it as the cold open wherever you have >10 seconds.
- **Update one quote → a whole portfolio revalues itself.** `value = shares × ticker.price` following a reference. The "wow" that proves Collections has depth.
- **Three parallel Claude sessions at once** (secondary B-roll) — instantly legible "wait, it runs multiple agents?" Use as a 2-second cutaway, not the lead.

### Kept in reserve (2026 table stakes — FAQ fuel, never the lead)

Multi-modal output (Artifacts commoditized it; still a Collections proof point — a "Generate PDF" action hands off to an office-role chat), mobile bridges (Telegram/Slack/Discord/LINE — *your phone writes into the same memory and apps as your laptop*), Docker sandbox (absorbed into msg #4), roles / skills launcher / ECharts / file attachments (comment-thread fuel).

---

## 5. Product Hunt listing copy

### Description (≤260 chars)

> A local file-system memory for Claude, in two forms: a linked wiki of everything it learns, and schema-driven collections where a tiny DSL turns data into working apps. Claude operates both as a universal controller. Open source, MIT · `npx mulmoclaude`.

*(252 chars. Leads with the two-form-memory spine + the DSL→app leap + who operates it + install.)*

### Topics

Developer Tools (primary) · Artificial Intelligence (required) · Open Source (required) · *(skip Productivity — dilutes the dev-tools framing.)*

### Maker's first comment (pinned — goes up within 90 seconds)

```
Hi Product Hunt 👋

I'm Satoshi Nakajima. I spent thirteen and a half years at Microsoft
working on operating systems (lead architect on early Windows
releases), then spent the last year on one question: **what does an
AI-native OS actually look like?**

I don't think it's ChatGPT or Copilot. I think the kernel is something
like Claude Code — an agent with direct access to your files, tools,
and environment. Powerful, but living in a terminal. Terminals were
the OS shell of 1975. We can do better.

MulmoClaude is my attempt at the **shell for that new kernel** — an
open-source, AI-native application platform. Three commitments:

**1. Claude is a universal controller.** Capabilities are plugins in
one registry, and Claude composes across them in a single turn.
"Summarize Q1 expenses as a chart" reads the accounting plugin and
writes a chart — no app-switching, no copy-paste. Real apps running
today: a full accounting system with server-side bookkeeping, a
personal wiki, an SEC-filings reader (Edgar), and schema-driven
collections.

**2. Chat summons the GUI.** The reply isn't a string. Claude picks
the format for the content — markdown, chart, form, wiki, spreadsheet,
3D scene, or a narrated video via the built-in MulmoScript/MulmoCast
engine. It can also ask *you* for structured input via a form when
free text isn't the right modality. The contract is an open protocol,
`gui-chat-protocol`, that extends MCP for the visual layer.

**3. You extend it by asking — no code, no plugin install.**
This is the part I'm most excited about. Need a tool the platform
doesn't have? *Ask.* "Build me an invoicing app with line items and a
PDF button" and a real app appears — fields, a computed total, an
action button. Under the hood it's a `schema.json` Claude wrote plus
plain-JSON records; Claude itself is the runtime, and the host
contains zero code about invoices. My portfolio holdings carry
`value = shares × ticker.price` following a reference into my quotes
collection — update one quote and every holding revalues itself, no
sync code. That's not a feature I wrote; it's a schema I asked for.
(Written up in docs/collections-architecture.md and docs/dsl-as-harness.md —
applications as data, the user authoring the harness, Claude as runtime.)

And it remembers: a cross-linked wiki grows from every chat
(inspired by @karpathy's *LLM Knowledge Bases* post) — the
unstructured half of memory; collections are the structured half.
Both plain Markdown/JSON in ~/mulmoclaude/ — git-friendly, yours.
Every other Claude client starts from zero; this one compounds.

Two details that matter:
- **Not a wrapper.** It doesn't call the Claude API — it runs the
  actual Claude Code CLI: your auth, your filesystem, your skills,
  your MCP servers. That's why it can do what it does.
- **Sandboxed by default.** Claude runs in a Docker container that
  only sees your workspace. SSH keys, .env, home dir — invisible.
  Auto-detected, no config.

Reach the same workspace — same wiki, same apps — from Telegram,
Slack, Discord, LINE. Fire a task from the subway, see the result on
your laptop.

Open source, MIT. Install: `npx mulmoclaude` (needs Node 20+ and the
Claude Code CLI authenticated). Full thesis: MANIFEST.md in the repo.

If you're a Claude power user who's hit the walls of one chat and a
terminal, this is built for you. I'd love your honest feedback — this
is the first visible surface of a much bigger bet about what computing
looks like when AI is the kernel and the *user*, not the engineer,
designs the environment.

— Satoshi
```

*(Optional first line if a fresh "Show HN" relaunch lands the same week: "This was on HN this morning — the thread helped sharpen the framing. [link]")*

### Gallery captions (one per screenshot — 6 shots, no orphans)

1. **Hook — Ask → app appears** — "Type 'build me an invoicing app with line items and a PDF button.' Watch a real app materialize — no code, no plugin install. Just ask."
2. **#1 Collections depth** — "Update one stock quote — every holding revalues itself. `value = shares × ticker.price`, following a reference. You asked for it; you didn't code it."
3. **#2 Universal controller** — "One chat composes across every plugin in a single turn. 'Summarize Q1 expenses as a chart' reads accounting, writes a chart. No app-switching."
4. **#2 Chat summons GUIs** — "The reply isn't a string. Claude picks the format: chart, form, wiki, spreadsheet, 3D scene, or a narrated video — and asks you for structured input via a form when text isn't right."
5. **#3 Memory + autonomy** — "Every AI agent has amnesia. This one doesn't — a cross-linked wiki grows from every chat. Register a source, get a morning briefing while you sleep."
6. **#4 Ownership / not a wrapper** — "Your data AND your apps live in `~/mulmoclaude/` as plain text. Runs the Claude Code CLI directly, zero domain code in the host, sandboxed in Docker."

---

## 6. Demo video plan

Three videos, different channels. **Always record silent first; add one narration pass; ship captions. Zero spinner time — pre-render, splice, never wait.**

### Video A — 60s hero (PH gallery + X)

- **Goal:** one upvote per viewer. No feature-listing.
- **Two money shots, back to back:** (1) the **ask→app** moment (novelty no competitor can show); (2) the **memory** payoff (the moat that makes leaving painful).
- 0:00–0:10 — Cold open: type *"build me an invoicing app with line items and a PDF button."* App materializes — fields, live total, "Generate PDF". No logo. Caption: *"No code. No plugins. Just ask."*
- 0:10–0:18 — Collections depth: edit one stock quote; every holding revalues. Caption: *"Update a quote — your whole portfolio revalues itself. No sync code."*
- 0:18–0:28 — Universal controller: one chat, *"summarize Q1 expenses as a chart"* → reads accounting, renders a chart inline. Caption: *"One chat. Every app. Composed in a single turn."*
- 0:28–0:40 — **Memory payoff (money shot):** wiki sidebar auto-cross-links; time-cut overlay *"Tomorrow"*; a fresh session answers a question grounded in yesterday's wiki page. Caption: *"Every AI agent has amnesia. This one doesn't."*
- 0:40–0:48 — Autonomy + ownership: a scheduled source fires a morning briefing; Finder opens `~/mulmoclaude/` showing plain Markdown + `schema.json`; a `git push` scrolls by. Caption: *"It works while you sleep. Your data and your apps — plain text, git-friendly."*
- 0:48–0:54 — Anti-wrapper frame: *"Not an API wrapper. Claude Code, directly. Zero domain code."*
- 0:54–1:00 — Logo + `npx mulmoclaude` + github URL. *(Swap to "try it in your browser" if the hosted demo (§10.5) ships.)*
- **Notes:** 1080p, 24fps, monospace captions, one lo-fi track at 40% cut at 0:54. Shoot the 0:00 ask→app and 0:28 memory beats twice; pick the crisper take.

### Video B — 3-min deep-dive (YouTube + landing)

- **Arc:** *What is it? → What's new? → Does it remember? → How fast? → Can I trust it?*
- 0:00–0:20 — Satoshi voice: "I worked on Windows for years. Claude Code is the kernel of an AI-native OS — but kernels need shells, and the shell should let *you*, not an engineer, define the apps."
- 0:20–1:00 — Platform demo: one chat composes accounting → chart; show *chat summons GUIs* across a form, a wiki page, a spreadsheet.
- 1:00–1:40 — **Extend-by-asking:** "build me an invoicing app" → working collection; then depth — a `ref` links a client, a `derived` field computes the total, the portfolio revalues on a quote change. Call out: *zero host code; applications as data; Claude as runtime.*
- 1:40–2:10 — **Compounding memory:** ingest two related articles → wiki backlinks appear → fresh "tomorrow" session answers grounded in the wiki.
- 2:10–2:30 — Speed + bridges: two more parallel sessions (PDF→summary doc + deck + narrated video in one, refactor in another); a Telegram/LINE message updates the canvas live — same memory, same apps.
- 2:30–2:50 — Trust: Docker sandbox banner; Claude *unable* to read a file outside the workspace; anti-wrapper line on screen.
- 2:50–3:00 — Open source, MIT. `npx mulmoclaude` + github + MANIFEST link.
- **Notes:** talking-head inset bottom-right for the first 20s, then pure screencast.

### Video C — 15s loop (IG / LinkedIn / PH gallery motion, muted)

Three variants: **(a)** ask→app (lead), **(b)** update one quote → portfolio revalues, **(c)** three parallel sessions. Use (a) for PH; post the others launch day.

### Filming checklist (all videos)

Clean `~/mulmoclaude/`; 1920×1080 min, H.264 8 Mbps; pre-compose all prompts in a file and paste (no live typing); dry-run on the exact network Claude will hit (latency is the #1 demo killer); cut any render wait >8s.

---

## 7. Launch-week timeline (T = June 23, 2026)

### T-14 to T-8 (now → ~June 15) — Asset build

- [ ] **Decide & build the activation path (§10.5) — this is the critical path; nothing else matters if it slips.**
- [ ] Hero video, 3-min video, 3× 15s loops, 6 screenshots
- [ ] Verify `npx mulmoclaude` boots clean on fresh macOS, Windows (WSL + PowerShell), Ubuntu — fix any first-run friction; confirm the Claude Code CLI auth pre-flight is friendly
- [ ] Register/refresh PH account, link to X, warm up with 2 comments on other launches
- [ ] Line up **4 hunters/commenters**; brief them with a 5-min Loom
- [ ] Draft all tweets, Reddit posts, optional Show HN relaunch copy
- [ ] **Record the baseline** (current GitHub stars, npm weekly downloads, X following) so §11 metrics are measurable

### T-3 (~June 20) — Warm-up

- [ ] Publish the thesis blog post: *"A schema is a harness, and Claude is the runtime — letting users build apps by asking."* Source from `docs/dsl-as-harness.md` + `docs/collections-architecture.md`; tie to Karpathy (wiki = unstructured memory; collections = the structured rung past it). The intellectual anchor.
- [ ] Stage the PH listing in Maker Studio (do **not** publish)
- [ ] DM ~10 Claude power users for a launch-morning try + honest feedback

### T-0 (June 23) — Launch day (all times PT)

- **00:01** — Publish on PH; first comment within 90s
- **00:05** — X thread (7 tweets: ask→app hook → 4 messages → anti-wrapper → CTA). Pin it.
- **00:10** — Mastodon + Bluesky cross-post (adapted)
- **01:00** — *(optional)* fresh "Show HN: MulmoClaude — a platform you extend by asking; a schema is the harness, Claude is the runtime." Only if the prior HN run is stale enough to re-submit; otherwise skip.
- **06:00** — Reddit r/ClaudeAI (value-first build log, PH link one line at the bottom)
- **09:00 / 12:00 / 15:00 / 18:00** — Reply to **every** PH comment within 30 min. Non-negotiable.
- **17:00** — Mid-day check: if not top-10, post the bridge round-trip demo and tag @ProductHunt
- **21:00** — Thank-you post regardless of placement; name top commenters
- **JP:** ship the JP maker post + captions; JP launch tweet at 09:00 JST (= 17:00 PT the prior day) to catch the APAC window

### T+1 to T+7 — Compound

Newsletter sends (dev.to, Hacker Newsletter, TLDR Dev); a "day after — what we learned" post; pitch the Changelog / Latent Space / Anthropic community call; **LinkedIn at T+3** (phase-2 productivity audience — skip on day one).

---

## 8. Channel-by-channel playbook

### X / Twitter — launch thread (7 tweets)

1. **[Hook — ask→app GIF]** *"I typed 'build me an invoicing app with line items and a PDF button.' No code, no plugin install — a working app appeared. You extend MulmoClaude by *asking*. Live on Product Hunt today. 🧵"*
2. **[#1 Collections]** *Every app ships the features its engineers chose. This one grows new ones when you ask. Each app is a `schema.json` Claude wrote + plain JSON; Claude is the runtime. Update one quote → my whole portfolio revalues, no sync code. [portfolio gif]*
3. **[#2 Controller + GUIs]** *And it's a platform: one chat composes across every plugin in a single turn. "Summarize Q1 expenses as a chart" reads accounting, writes a chart. The reply isn't text — it's the right GUI. [compose gif]*
4. **[#3 Memory]** *It never forgets. A cross-linked wiki grows from every chat, in plain Markdown. The wiki is what Claude knows; collections are what it can do. ChatGPT Memory is a bullet list; this is the moat. [wiki gif]*
5. **[#4 Ownership]** *Your data AND your apps live in `~/mulmoclaude/` as plain text. `git push` is the backup. No cloud, no lock-in, no export flow. [folder + git gif]*
6. **[Anti-wrapper]** *Not an API wrapper. It runs the Claude Code CLI directly — your auth, your tools, your files — and the host contains zero domain code. That's why it can do what it does.*
7. **[CTA]** *Install: `npx mulmoclaude` — open source, MIT. One upvote on PH costs nothing and means everything today: [link]* *(swap first clause for the hosted demo URL if §10.5 ships.)*

### Hacker News *(only if relaunching)*

**Title:** `Show HN: MulmoClaude – a platform you extend by asking; a schema is the harness, Claude is the runtime`
**Opening:** *"You extend the app by asking — 'build me an invoicing system' produces a working app with no code. The schema is the application; Claude is the runtime; the host has zero domain code."* Walk the DSL-as-harness thesis (`docs/dsl-as-harness.md` + `docs/collections-architecture.md`); tie to Karpathy; state plainly *this runs the Claude Code CLI directly, not the API.* The prior HN run got little traction — only relaunch with the sharper extend-by-asking angle, not the old framing.

### Reddit (r/ClaudeAI, r/LocalLLaMA, r/selfhosted)

Build log, not a launch post: *"I spent months giving Claude a shell — here's how users build their own apps by asking, and the wiki-memory idea underneath."* PH link one line at the bottom.

### Japanese community (Note, X-JP)

Satoshi has a strong JP audience. Translate the maker post + hero captions (a fresh JP plan is **not** in scope for this branch — `launch-product-hunt-ja.md` was retired as stale; re-author from this file when JP assets are scheduled). Launch-day JP tweet at 09:00 JST.

---

## 9. Hunters & community seed list

- **Hunter:** someone with 5k+ PH followers in the Claude/LLM space; self-hunt if none (Satoshi's network is strong enough).
- **Seed voters:** ~50 people who starred the repo or engaged with MulmoChat — DM a Monday-evening reminder.
- **Commenter priming:** 4–6 people leaving substantive comments at hours 1/3/6/9 (PH weights comment velocity + diversity, not just upvotes).

---

## 10. Risks & mitigations

| Risk | Prob | Mitigation |
| --- | --- | --- |
| **Activation gap — setup too heavy for PH day** | **High** | **Commit to an activation path by T-10 (§10.5).** `npx mulmoclaude` alone (Node + Claude CLI auth + optional Gemini key + Docker) ≈ 50% drop-off. **Do not launch without one.** |
| Claude Code CLI auth fails on first run | Medium | In-app pre-flight check + friendly error page linking to Claude Code docs |
| "It's just a wrapper" | Medium | Lead with the anti-wrapper line verbatim; reinforce with the universal-controller + zero-host-code proof |
| Cognitive overload (too many features) | Medium | Hold the 4 rank-ordered messages; rest in reserve. Don't let screenshots creep the list back |
| Demo latency from live Claude calls | Medium | Pre-record, splice, never show >3s of spinner |
| Audience mismatch (no-code hook vs dev channels) | Medium | Use the engineer framing in §0: *"stop writing a plugin per feature; describe a schema, Claude runs it."* |
| MIT + Docker read as "hacker tool" | Low-Med | Reframe: sandbox = *"the care a real shell needs"*; MIT = *"maximally permissive — fork it, ship it, use it commercially."* |
| Anthropic ships a GUI the same week | Low | Frame as complementary — local-first, open-source, plugin-extensible, user-authored apps |

### 10.5 The activation problem — solve this or lose the day

The single biggest gap. Even with `npx mulmoclaude`, the path is Node + Claude CLI auth + (optional) Gemini key + Docker — 5–10 min, developer-only, zero mobile. PH rewards instant gratification; without a zero-install taste, upvotes spike mid-morning and momentum dies by afternoon.

**Three options, ranked:**

**A (strongly recommended — NOT yet built): hosted read-only demo.** A pre-loaded workspace (~10 prepared sessions) led by the **ask→app replay** ("build me an invoicing app" → app appears) + the portfolio-revalue interaction, then the "tomorrow, it remembers" moment, a scheduler catch-up, a wiki with backlinks, a multi-session snapshot. Click-through + canvas replay — no typing, auth, key, or Docker. Budget ~3 eng-days + hosting; reserve a subdomain + VM at T-10. If shipped, every CTA becomes *"try it in your browser."*

**B (minimum viable): `--demo` replay mode.** A local mode with pre-recorded sessions baked into the repo; `npx mulmoclaude --demo` drops into an interactive walkthrough in ~30s with no Gemini key / no Claude auth. Halves drop-off.

**C (last resort): scripted screenshot walkthrough on the landing page.** No real interactivity, but preserves the "I experienced it" feeling for skimmers.

**Decision owed by T-10: commit to A; fall back to B before touching C. Slip the launch date before launching without one of these.**

---

## 11. Success metrics

**Record the baseline at T-8** (current stars / weekly npm downloads / X following) — every target below is measured as a delta from that line.

- **Day of:** PH **Top 5** (Top 10 floor); GitHub **+500 stars/24h**; activation-path sessions **3,000 unique** (if A/B ships, else N/A); installs (npx launches / Gemini-key inputs as proxy) **500** with a demo absorbing casual traffic, **~1,500** if install is the only path (higher volume, lower quality); **50+ substantive PH comments**.
- **Week of:** **+1,500 stars cumulative**; (if relaunched) HN front page >2h; **2M+ X impressions**; **3+ inbound podcast/interview requests**.
- **Month of:** **2,000 WAU**; **5 community-contributed roles/collections/plugins**; one mention by @karpathy / @alexalbert / an Anthropic engineer (aspirational, trackable).

---

## 12. The two bets

**Bet 1 — show both forms of memory in one sequence (earns the upvote).** Hero video 0:00–0:40: the **structured** form first — type "build me an invoicing app" and a real app appears (no code), portfolio revalues on a quote change — then the **unstructured** form — a fresh "tomorrow" session answers grounded in the wiki it built itself. Lead with the novelty (DSL→app), land with the moat (it remembers). Without the ask→app open we're "another Claude wrapper with a pretty UI"; without the memory close we're "a neat no-code toy." With both — a linked wiki *and* apps grown by schema — a new category.

**Bet 2 — the activation path (earns the try).** A zero-install way to experience the ask→app and memory moments (§10.5 A/B/C). Without one, Bet 1's upvote never converts to a star, a follow, or a build. **Decision owed by T-10. This is the unstarted critical-path item — assign an owner now.**

Everything else — bridges, sandbox, roles, skills launcher, multi-modal output, parallel sessions — is confirmation bias for a viewer who already believes. Cut anything that doesn't serve a bet.

---

## 13. The story underneath

Two legs hold up the deeper frame (for HN, long-form, and anyone asking where this goes):

**Leg one — every AI agent today is homeless.** No persistent filesystem, no schedule, no compounding memory. Summoned, work, gone — that's a function call, not an agent. MulmoClaude gives the agent a home: `~/mulmoclaude/`. A bookshelf (the wiki), filing cabinets (documents), a workshop where the user builds new tools (collections), a calendar (the scheduler), phones (the bridges). Because it has a home it accumulates; because it accumulates it gets smarter; because it gets smarter it earns more autonomy. Memory → compounding → trust → delegation.

**Leg two — the user designs the environment, not the code.** The lesson of 2025–2026 agentic engineering: the *harness* matters more than the model, and a deliberately-limited DSL is one of the best harnesses — a small, legible, validatable surface the agent can't drift outside of. MulmoClaude runs on two: **MulmoScript** (the agent writes a script; a deterministic renderer makes the video) and **Collections** (the *user* declares a schema; Claude is the runtime). The radical move is the second: harness design, historically an engineer's job, handed to the end user. A non-programmer declaring a collection schema is — without the word — designing the environment an agent operates in. Applications stop being code engineers write and become *data users author*. Developed at length in [`docs/dsl-as-harness.md`](../docs/dsl-as-harness.md) and [`docs/collections-architecture.md`](../docs/collections-architecture.md).

This is the first visible surface of a bigger thesis: **computing is being re-platformed on AI agents, and the shell that platform needs doesn't exist yet.** Claude Code is the kernel; MulmoClaude is the first draft of the shell, and the shell's user-facing form is one folder every input flows into and every output comes out of. In 1975 the home directory held your files; in 2026 it holds your files, research, conversations, scheduled work, and the knowledge extracted from all of them — maintained by an AI that knows what to remember, what to file, and eventually what to schedule on its own. Both memory and scheduling should become autonomous: the endgame is an agent that decides for itself what to repeat and summarize, the way it already decides what to write into the wiki.

If the launch goes well, we're not celebrating a product launch — we're announcing a new computing surface, through one sharp product.

---

*Canonical PH launch plan. Revise after the asset dry-run at T-7. **Activation-path decision owed at T-10 (§10.5) — the critical-path item.** Retired drafts: `plans/obsolete/launch-ph-listing.md`, `plans/obsolete/launch-product-hunt-ja.md`. HN run: `plans/done/launch-hn.md`.*
