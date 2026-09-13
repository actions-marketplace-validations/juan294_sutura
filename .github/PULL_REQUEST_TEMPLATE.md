## Description

<!-- What does this PR do, and why is it needed? -->

## Related Issues

<!-- Link related issues: Fixes #123, Closes #456 -->

## Verification

- [ ] `pnpm run typecheck` passes
- [ ] `pnpm run lint` passes
- [ ] `pnpm run test` passes
- [ ] `pnpm run verify:bundle` passes
- [ ] `pnpm run ci:local` passes when `packages/core` changes

## Safety and Review

- [ ] PR targets `develop`
- [ ] No tokens, credentials, private source, or personal data are included
- [ ] Product guards have a real or captured replay fixture
- [ ] Tests and verification were not removed, skipped, or weakened
- [ ] Generated `packages/action/dist/index.cjs` is current when source changed
