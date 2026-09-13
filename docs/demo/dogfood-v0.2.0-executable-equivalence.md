# Sutura v0.2.0 dogfood executable equivalence

Ten consecutive live repairs ran at `a99e23199a80ae6ee51fe1680afb74188416160c`.

The v0.2.0 release commit is `a943ded4c734aed75c5c63f2b2dd63a2f44556c2`. Its Action metadata and executable bundle have the same Git-object fingerprint as the streak Action.

No dogfood run executed at `a943ded4c734aed75c5c63f2b2dd63a2f44556c2`.

Fixed attempts: 10

Total live spend: USD 13.450513

Executable fingerprint: `226ec0ab9050e1776ed869841ab5f673b364a4bf92cbfdd1866d0b37351e0ee4`

Executed paths:

- `action.yml`
- `packages/action/action.yml`
- `packages/action/dist/index.cjs`

The wider package tree differs only in these CLI setup and test files:

- `packages/action/src/checks.test.ts`
- `packages/action/src/workflow.test.ts`
- `packages/cli/src/setup.test.ts`
- `packages/cli/src/setup.ts`
- `packages/placebo/src/corpus.test.ts`
