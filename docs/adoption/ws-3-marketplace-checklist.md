# Sutura GitHub Marketplace publication checklist

Date: 2026-09-04

Status: Prepared; publication requires Juan's explicit authorization.

## Automated preflight

Run from a clean checkout of the integrated candidate:

```bash
node scripts/marketplace-evidence.mjs preflight --candidate "$(git rev-parse origin/develop)"
```

The command verifies the exact checkout identity, public repository, `develop`
default branch, integrated `origin/develop` identity, root/package metadata parity, Sutura name, description,
author, Node 24 bundle, and supported `activity`/`red` branding.

## Human publication gate

- [ ] Confirm the intended release and tag are already approved and immutable.
- [ ] Confirm the repository owner accepted the Marketplace Developer Agreement.
- [ ] Open `action.yml` on GitHub and choose **Draft a release**.
- [ ] Check **Publish this Action to the GitHub Marketplace**.
- [ ] Resolve every metadata warning until GitHub reports that the metadata passes.
- [ ] Listing description links to the Case Lab URL, `https://sutura-case-lab.vercel.app/`.
- [ ] Confirm GitHub reports that the Marketplace name is unique.
- [ ] Select primary category **Utilities**.
- [ ] Retain the already-approved release tag; do not move or create a tag here.
- [ ] Publish using the repository owner's 2FA.
- [ ] Open the public listing signed out.
- [ ] Install from the listing into an external-study repository.
- [ ] Confirm the generated workflow pins `juan294/sutura` to the exact release
  commit, never a mutable branch or floating tag.

After that public run succeeds, record the exact repository and run. This literal
confirmation is covered by Gate D and does not publish or mutate anything:

```bash
node scripts/marketplace-evidence.mjs record-install --candidate "$(git rev-list -n 1 v0.2.1)" --release v0.2.1 --repository <public-repository-url> --run <public-actions-run-url> --output docs/adoption/sutura-marketplace-install-evidence-v1.json --authorization MARKETPLACE-INSTALL-CONFIRMED
```

## Terminal evidence

After the external adoption record is complete:

```bash
node scripts/marketplace-evidence.mjs verify --candidate "$(git rev-list -n 1 v0.2.1)" --release v0.2.1 --listing https://github.com/marketplace/actions/sutura-verified-self-healing-ci --install-evidence docs/adoption/sutura-external-adoption-evidence-v1.json --marketplace-install-evidence docs/adoption/sutura-marketplace-install-evidence-v1.json --output docs/adoption/sutura-marketplace-evidence-v1.json
```

The verifier binds the public listing, remote immutable tag and GitHub release,
complete external evidence, and a public run installed through Marketplace into
one hashed record. It creates the output exclusively
and refuses an incomplete study, candidate drift, a missing listing, or a mutable
release identity.
