# Sutura CLI

Sutura verifies AI-generated CI repairs before it opens a pull request.

Install Sutura in a GitHub repository:

```bash
npx sutura@0.2.1 init
npx sutura@0.2.1 doctor
```

`init` resolves the `v0.2.1` Action tag to one immutable commit and writes that
SHA into the workflow. `doctor` verifies the pin against the tag. Release
candidate checks can pass `--action-sha <40-character-commit>` to both commands;
mutable refs are rejected.

Sutura uses bring-your-own-key billing. Your repository supplies its own
Nebius Token Factory and ConTree credentials. Tavily is optional.

Sutura handles pull request, push, scheduled, and manual CI failures. It records evidence on the pull request or failing commit and in one GitHub Check on the exact failing SHA.

Node and Python projects use separate sandbox adapters. Detection is automatic
for a single runtime. Set `runtime` to `node` or `python` in `.sutura.json` for a
polyglot repository, or pass `--runtime node|python` to a local `sutura heal`
run. Python preparation requires `uv.lock` or exact hash-locked binary
requirements and never runs repository source with network access.

A local `sutura heal` reproduces `pnpm test` (Node) or `python -m unittest`
(Python) unless `--failing-command "<command>"` names the command CI ran. The
Action always passes the command it extracted from the failing log.

For a local review that does not use ConTree, run:

```text
sutura audit --case-dir /tmp/case --candidate-diff /tmp/fix.diff --before-log /tmp/before.log --after-log /tmp/after.log --format json
```

Audit-only mode requires only `NEBIUS_API_KEY`. It uses supplied evidence and never executes or verifies the patch. Its separate `AuditFile` output always says `assurance: "reduced"` and never reports a verified repair outcome.

Replay a complete captured run without network access:

```text
sutura replay --bundle /tmp/captured/bundle.json --format json
```

Replay uses the recorded runtime unless `--runtime node|python` overrides it.
`--runtime auto` keeps the recorded setting. Historical GitHub-only captures
are partial fixtures for boundary tests. The public command rejects them before
provider, repository, or sandbox work starts.

Read the complete [setup and security guide](https://github.com/juan294/sutura#install-sutura).
