# Sutura: Verified Self-Healing CI

## One-liner

AI agents make CI pass. Sutura verifies the fix, filters flaky failures,
rejects unsafe shortcuts, and opens evidence-backed PRs for human review.
It reproduces real failures and races candidate repairs in isolated sandboxes.
"Sutura" means suture. It repairs the pipeline while preserving human approval.

## Context

Entry for the Nebius x NVIDIA Global AI Hackathon (deadline 2026-10-30,
track: Coding and Agentic Engineering; Tavily side prize targeted).
The [technical evaluation guide](docs/evaluation/README.md) maps the criteria to
implementation, tests, dated evidence, and limitations.
This repo is PUBLIC (MIT) from day 1 — never commit secrets, personal data,
or anything from Juan's private fleet.

## Stack

- TypeScript (pinned `^6` — typescript-eslint has no TS7 support), Node 22,
  pnpm, Vitest, ESLint flat config
- LLM: NVIDIA Nemotron models via Nebius Token Factory
  (OpenAI-compatible API, `https://api.tokenfactory.nebius.com/v1/`)
- Web grounding: Tavily API
- Env vars: `NEBIUS_API_KEY`, `TAVILY_API_KEY` — fail closed, never commit

## RPI Workflow

This project follows Research-Plan-Implement (RPI).

1. /research -- Understand the codebase as-is
2. /plan -- Create a phased implementation spec
3. /implement -- Execute one phase at a time with review gates
4. /validate -- Verify implementation against the plan

Each phase is its own conversation. STOP after each phase.
Use /clear between tasks, /compact when context is heavy.

## Key Commands

```bash
pnpm run test        # Vitest
pnpm run typecheck   # tsc --noEmit
pnpm run lint        # ESLint
pnpm run build       # tsc
```

## Git Workflow

- Integration branch (default): `develop`
- Production branch: `main` — releases and Devpost submission point here
- Implementation happens in git worktrees or temporary branches
- Verify current branch before committing; run typecheck + lint first
- Conventional commits:
  `feat|fix|test|refactor|chore|docs(scope): description`

```bash
# Commit before pulling (hook enforced)
git add <files> && git commit -m "msg"
git pull --rebase && git push
```

Run verification sequentially with `;` or `&&`, never as parallel Bash calls.

## Deployment

The repair artifact is a GitHub Action + CLI; releases are tagged from `main`.
The hosted [Case Lab](packages/case-lab/README.md) presents labeled demo results;
live dispatch has a separate authorization gate. Demo assets (video, sample runs)
live in `docs/demo/`. This overview does not record a fresh deployment check.

Rules load from `.claude/rules/` and `.claude/skills/` automatically.

## Agent Behavior

Exhaust tools before asking the user. Production actions need human
authorization. Save operational lessons to auto memory immediately.
Don't wait to be asked.

## Project File Locations

Go directly to these paths -- never search for them.

| Topic    | Path                            | Notes                       |
| -------- | ------------------------------- | --------------------------- |
| Repository evaluation | [Technical evaluation guide](docs/evaluation/README.md) | Architecture, tests, evidence modes, and limitations |
| Agent reports | `docs/agents/*-report.md` | Gitignored on public repos; tracked on private (Rule #70) |
| Active hackathon roadmap | `docs/plans/2026-08-31-sutura-hackathon-winning-roadmap.md` | Remaining work through submission |
| Research | `docs/research/YYYY-MM-DD-*.md` |                             |
| Plans    | `docs/plans/YYYY-MM-DD-*.md`    | Phase files in `-phases/`   |
| ADRs     | `docs/decisions/`               |                             |
| PR descriptions | `docs/prs/{number}_description.md` |                   |
| Release playbook | `docs/release/e2e-pro-playbook.md` | Wave A adopted; profile pending first release |
