# Fleet dogfood metrics

Sutura can rebuild a cumulative dogfood ledger from GitHub Actions evidence.
The collector reads each repository's `sutura.yml` workflow runs and downloads
the bounded HTML case file for every repair attempt. It records green CI runs
where no repair was needed separately from actual repair attempts and from
cancelled or otherwise non-repairable CI conclusions.

Copy `fleet-dogfood-config.example.json` to the gitignored
`.sutura/fleet-dogfood-config.json`. Set the default owner, repository names, exact
Sutura Action commit, and the UTC instant when measurement starts. Repository
entries can use `owner/name` for collaborator projects. They can include private
repositories because the config and detailed output stay gitignored.

Run:

```bash
pnpm run dogfood:fleet-metrics
```

The configured GitHub CLI account must be able to read Actions in every listed
repository. The collector writes four local artifacts:

- `summary.json` and `summary.md` contain cumulative fleet totals.
- `events.jsonl` contains one detailed local record per Sutura monitor run.
- `installations.json` records whether the monitor exists in each repository.
- `snapshots.jsonl` retains one aggregate snapshot per UTC day.

Each run queries the full configured window again. A missed scheduled run does
not lose intermediate Sutura attempts while their GitHub evidence remains
available. `unknown` remains explicit when an attempted run has missing,
expired, or unreadable case-file evidence. Measured cost totals include
inference and sandbox charges reported by the case file; unknown cost is never
treated as zero.

The aggregate summary contains no repository names. Review it before publishing
because it is operational evidence, not a controlled benchmark. A verified
repair count means Sutura produced `fixed`, completed successfully, and opened a
repair pull request. Human review and merge remain separate.
