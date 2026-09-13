# Contributing to Sutura

Thanks for helping improve Sutura.

## Development Setup

1. Fork and clone the repository.
2. Create a branch from `develop`.
3. Install dependencies with `pnpm install`.
4. Use synthetic or public fixtures only.

## Development Workflow

Use the repository's Research-Plan-Implement workflow for substantial changes. Keep implementation off `develop` and `main`, and open pull requests against `develop`.

Run the standard local checks before opening a pull request:

```bash
pnpm run typecheck
pnpm run lint
pnpm run verify:bundle
pnpm run test
```

Run `pnpm run ci:local` for changes to `packages/core`. Rebuild and commit `packages/action/dist/index.cjs` with any source change that affects the Action bundle.

Use lowercase Conventional Commits:

```text
feat(scope): add a capability
fix(scope): correct a defect
docs(scope): clarify behavior
test(scope): add regression coverage
chore(scope): update tooling
```

Never commit tokens, provider keys, private source, personal data, or unsanitized CI logs. Product guards need a fixture captured from a real failure or provider response. Report security problems through [SECURITY.md](SECURITY.md), not a public issue.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
