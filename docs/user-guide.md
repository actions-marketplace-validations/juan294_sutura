# Sutura user guide

This guide covers Sutura 0.3.0 for repository owners installing the GitHub
Action. Sutura is in public beta, and Nebius ConTree access remains an
access-controlled prerequisite.

## Requirements

Before setup, you need:

- A GitHub repository with at least one existing Actions CI workflow.
- Git and Node.js 22 or later.
- The [GitHub CLI](https://cli.github.com/) authenticated with `gh auth login`.
- Permission to configure repository Actions secrets and variables and to add
  a workflow to the default branch.
- A Nebius Token Factory API key, a Nebius ConTree token and project, and an
  optional Tavily API key.

Read the [data boundary and retention contract](security/data-boundaries.md)
and [private repository threat model](security/private-repositories.md) before
enabling Sutura on confidential source.

## Install one repository

Sutura installation is repository-scoped. A global npm installation is not
required. `npx` downloads the exact CLI version for each command, and the
generated GitHub workflow pins the corresponding Action to an immutable commit.

From a clone of the repository, confirm GitHub access:

```bash
gh auth status
gh repo view --json nameWithOwner --jq .nameWithOwner
```

Export provider credentials only in the current shell:

```bash
export NEBIUS_API_KEY="..."
export CONTREE_TOKEN="..."
export CONTREE_PROJECT="..."
export TAVILY_API_KEY="..."
```

Then generate and inspect the workflow:

```bash
npx sutura@0.3.0 init
sed -n '1,220p' .github/workflows/sutura.yml
npx sutura@0.3.0 doctor
```

If the repository has more than one workflow, select the exact workflow name:

```bash
npx sutura@0.3.0 init --workflow "CI"
```

Use `--no-tavily` when Tavily is unavailable. For a polyglot repository, set
`SUTURA_RUNTIME=node` or `SUTURA_RUNTIME=python` for the `init` command; a
single-runtime repository is detected automatically at run time.

`init` creates `.github/workflows/sutura.yml`. It sends available credential
values to GitHub through standard input, stores provider keys as Actions
secrets, and stores `CONTREE_PROJECT` as a repository variable. It does not
write credential values into repository files.

## Activate the monitor

Review the generated workflow before committing it. In particular, confirm the
monitored workflow name, permissions, runtime, optional Tavily input, and exact
40-character Action commit.

```bash
git add .github/workflows/sutura.yml
git commit -m "ci: add Sutura repair monitor"
git push
```

The monitor becomes active only when the workflow reaches the repository's
default branch. If that branch is protected, open and merge a pull request
through the repository's normal review process.

## Understand the first run

The monitor observes completion of the selected CI workflow. A successful run
needs no repair, so the repair job is skipped. A failed or timed-out pull
request, push, scheduled run, or manual run starts one Sutura attempt.

Sutura publishes:

- An evidence comment on the pull request or exact failing commit.
- One **Sutura repair audit** GitHub Check on the exact failing SHA.
- An HTML case-file artifact linked from the comment and check.
- A repair pull request when a candidate passes verification.

Every attempt ends as `fixed`, `flaky-no-patch`, `refused`, `gave-up`, or
`infra-stop`. Generated customer workflows are advisory by default. Even a
verified repair remains neutral and requires human review; Sutura never merges
it.

## Check and configure an installation

Run `doctor` from the repository whenever setup or credentials change:

```bash
npx sutura@0.3.0 doctor
```

It checks the local workflow, immutable Action pin, required permissions and
inputs, GitHub secrets, and the `CONTREE_PROJECT` variable.

Common configuration:

- Set `runtime` to `node` or `python` in protected `.sutura.json` when automatic
  detection finds equal evidence for both runtimes.
- Keep the generated advisory behavior for normal use. The `require-fixed`
  Action input makes every result other than `fixed` fail the Sutura job.
- Keep branch protection and human review enabled.
- Lower Action budgets when needed. Action inputs cannot raise the core safety
  maxima.

## Upgrade a repository

Each repository pins its own immutable Action commit. Updating a global npm
package, or running a newer CLI elsewhere on the machine, does not update any
installed workflow.

Sutura 0.3.0 does not have an `upgrade` command. Upgrade each repository
deliberately after reading the target release notes.

For an unmodified generated workflow, regenerate it with the target CLI and
review the complete diff before committing:

```bash
npx sutura@0.3.0 init --force
git diff -- .github/workflows/sutura.yml
npx sutura@0.3.0 doctor
```

`init --force` replaces the entire workflow. Do not use it on a customized
workflow. For a customized installation, update only the immutable Action
commit on the workflow's `uses` line and any release-specific inputs you
intentionally adopt. The immutable Action commit for v0.3.0 is
`c94eee2086b31450d975137a0102dda18522d0b8`. Run `doctor`, review the diff, and
commit the update through the repository's normal process.

Repeat this process in every repository that uses Sutura. There is no
machine-wide switch that can safely rewrite independent GitHub workflows.

## Pause or resume repairs

Pause provider and sandbox work without removing the workflow:

```bash
gh variable set SUTURA_DISABLED --body true
```

Remove the variable to resume:

```bash
gh variable delete SUTURA_DISABLED
```

The monitor checks this variable before credentials, providers, or sandboxes
are used.

## Rotate credentials

Replace a secret through the GitHub CLI; it prompts for the new value without
putting it in the command line:

```bash
gh secret set NEBIUS_API_KEY
gh secret set CONTREE_TOKEN
gh secret set TAVILY_API_KEY
gh variable set CONTREE_PROJECT
npx sutura@0.3.0 doctor
```

Omit Tavily when the installation uses `--no-tavily`.

## Remove Sutura

Pause Sutura first if an attempt may still be running. Then remove the workflow
and commit that removal:

```bash
gh variable set SUTURA_DISABLED --body true
git rm .github/workflows/sutura.yml
git commit -m "ci: remove Sutura repair monitor"
git push
```

After the removal reaches the default branch, optionally delete Sutura's
repository secrets and variables:

```bash
gh secret delete NEBIUS_API_KEY
gh secret delete CONTREE_TOKEN
gh secret delete TAVILY_API_KEY
gh variable delete CONTREE_PROJECT
gh variable delete SUTURA_DISABLED
```

Existing comments, checks, workflow artifacts, repair branches, and pull
requests remain part of repository history and follow GitHub retention rules.

## Troubleshooting

### `init` cannot find a workflow

Add or enable the repository's CI workflow first. When multiple workflows are
present, pass their exact top-level `name` with `--workflow`.

### `doctor` reports a missing or unsafe workflow

Run the command from the repository root. Confirm that
`.github/workflows/sutura.yml` is a regular file rather than a symbolic link.

### `doctor` reports a missing secret or variable

Configure the named value with `gh secret set` or `gh variable set`, then run
`doctor` again. `TAVILY_API_KEY` is optional; the other reported credentials
are required.

### The monitor does not run

Confirm that the Sutura workflow is on the default branch, GitHub Actions is
enabled, the monitored workflow name still matches, and `SUTURA_DISABLED` is
not `true`. A successful target run intentionally skips the repair job.

### The monitor runs against an unexpected failure

Open the Sutura run and follow its target-run link. GitHub can display a
`workflow_run` monitor under the default-branch workflow identity even when the
failed target came from another branch. The evidence comment, check, and case
file should identify the exact target run and failing source SHA.

### An upgrade would overwrite custom settings

Do not run `init --force`. Update the immutable `uses` commit manually, preserve
the intentional inputs and conditions, and confirm the result with `doctor`.

Report reproducible defects through the repository's
[GitHub issues](https://github.com/juan294/sutura/issues). Report security
problems privately as described in [SECURITY.md](../SECURITY.md).
