# Phase 5: Product Hunt launch on 2026-09-18

Plan: [2026-09-15-launch-readiness-v0.3.1.md](../2026-09-15-launch-readiness-v0.3.1.md)

Status: **done 2026-09-17.** Scheduled for 2026-09-18 00:01 PT with the
GPT-6 Astra Challenge opt-in after the v0.3.1 smoke run (see
`docs/release/v0.3.1-case-lab-record.md`). Listing copy, the challenge
answer, the gallery and the launch URL are in
`docs/launch/product-hunt-2026-09-18/listing.md`.

Contest facts (Juan's research, 2026-09-15; the contest page has no rules
page — the embedded contest JSON and Product Hunt staff replies are the
sources): window `2026-09-18T00:00:00-07:00` to `23:59:59-07:00`; enter by
scheduling a launch for that day and accepting the "join the GPT-6 Astra
Challenge" prompt; prizes top 5; "built with Astra" counts, including
pre-existing projects accelerated with Astra; the launch guide asks the
Maker comment to describe "what your GPT-6 Astra Challenge was like".

## Assets (prepare Wednesday; all sources are tracked and public-safe)

| Asset | Source | Work |
| --- | --- | --- |
| Gallery (PH prefers 1270×760) | `docs/devpost/gallery-2026-09-13/01-verified-repair.png` … `08-case-lab.png` (1536×1024) | `sips -Z 1270 --cropToHeightWidth 760 1270` (or `-c 760 1270` after resize) into `docs/launch/product-hunt-2026-09-18/gallery/0N-*.png`; keep the eight captions from `index.html` as alt text; put the three real Case Lab screenshots (`docs/demo/case-lab/*.jpg`, 1204×985) after the illustrations, cropped the same way |
| Thumbnail (240×240) | `packages/case-lab/assets/favicon.svg` on the `#052B42` hero colour, or a 240×240 crop of the social card | `docs/launch/product-hunt-2026-09-18/thumbnail.png` |
| Social/OG | `packages/case-lab/assets/social-card.png` (1200×630) | reuse |
| Video | none exists; script `docs/devpost/sutura-video-script.md` | optional manual: a 60–90 s screen capture of a live Case Lab run (after Phase 4) — Juan's call; PH accepts launches without video |
| `prompts.json` | discloses image generation | do not upload |

## Copy (draft in `docs/launch/product-hunt-2026-09-18/listing.md`, reviewed by Juan)

- Name: `Sutura`. Tagline ≤ 60 chars, from `README.md:1-22` /
  `packages/case-lab/src/site.ts:63-64` — e.g. "Verified self-healing CI —
  proves the fix, not just the green".
- Description (from `docs/devpost/sutura-submission.md` Problem / workflow
  sections, updated to v0.3.1): reproduce → separate flakes → search repairs
  in sandboxes → reject green-wash → adversarial audit by Nemotron **with a
  GPT-6 Astra second opinion** → evidence-backed PR for human review. Links:
  Case Lab, repo, npm.
- Topics: Developer Tools, GitHub, Artificial Intelligence, Open Source.
- First comment (Maker): the honest section — runtime is NVIDIA Nemotron on
  Nebius Token Factory (hackathon constraint); GPT-6 Astra is an optional
  veto-only second auditor; the Case Lab runs at most 24 live repairs per UTC
  day and 4 per hour, after which every case still has a deterministic replay;
  the v0.3.1 benchmark numbers (51 cases, false approvals, fix rate) with the
  evidence links; "what the GPT-6 Astra Challenge was like": the repo was
  built with Astra from 2026-09-08 (Juan's figures: 341 commits in 30 days,
  163 Astra turns since 09-08 — VERIFY these two numbers from git and the
  session log before publishing; do not print them otherwise).
- No metric that is not in a committed evidence file.

## Draft and schedule (Plan B: browser automation in Juan's logged-in session)

1. `mcp__claude-in-chrome__tabs_context_mcp`, new tab on
   `https://www.producthunt.com/launches/new` (or the contest's "Submit now"),
   fill name, tagline, links, topics, description, upload thumbnail and
   gallery, first comment. Save as draft. Read the draft back and show Juan
   the summary.
2. **Only after Phase 4's smoke run and Juan's explicit go:** schedule for
   2026-09-18 00:01 PT, accept the challenge prompt, confirm the challenge
   badge appears on the draft. Record the launch URL in
   `docs/launch/product-hunt-2026-09-18/listing.md`.
3. Launch-day prep: README top link to the PH page (commit after scheduling
   — the gate passes; docs only), and the Case Lab About page one-liner if
   Juan wants it (it's a rebuild + deploy; skip if time is short).

## Success criteria

Manual only (Product Hunt has no API for drafts): the scheduled launch shows
date 2026-09-18, the challenge is joined, gallery and thumbnail render, the
first comment is posted at launch. Juan reviews the copy before scheduling.

## Done when

Scheduled, recorded, README link committed. STOP. Friday: watch
`https://sutura-case-lab.vercel.app/api/health` and the demo's `case-lab.yml`
runs; the daily cap refuses politely at 24.
