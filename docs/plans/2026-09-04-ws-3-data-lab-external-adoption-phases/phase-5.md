# Phase 5 - External sessions and terminal adoption record (#90, #91, #94, #95, #96, #54)

## Changes

- [ ] Record three unfamiliar repositories from three external participants.
- [ ] Require the complete language denominator to include JavaScript/TypeScript
  and Python.
- [ ] Require one repair, one refusal, and one flake classification through public
  npm plus an immutable Action commit.
- [ ] Record every setup failure, unclear instruction, manual intervention, and
  release-blocking defect; refuse terminal success while any blocking defect is
  unresolved.
- [ ] Include attributable feedback only where the participant approved the exact
  quote and display name.
- [ ] Finalize the canonical three-participant evidence record and result hash.

## Automated success

- `node scripts/adoption-study.mjs finalize ...` accepts exactly three distinct
  participants/repositories and rejects incomplete denominators or open blockers
- every target run, Sutura run, and check-run URL is exact, public, and bound to
  the recorded classification; the package version's public tag equals the candidate
- every install uses an exact package version and Action commit

## Manual success

Three participant sessions after Gate C. Until then all phase issues stay open at
the participant-recruiting gate.
