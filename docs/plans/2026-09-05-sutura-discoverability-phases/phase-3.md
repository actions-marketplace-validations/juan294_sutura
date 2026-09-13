# Phase 3: Register the site with Google, Bing, Clarity, and Vercel Analytics

Depends on: 3A none; 3B on 2 and 3A.

Executed by the agent through Juan's logged-in Chrome session (Claude in Chrome tools) and the `vercel` and `gh` CLIs. Authorized by Juan on 2026-09-05: "You can do everything yourself." Every account is `juan294@gmail.com`; the existing Search Console, Bing, and Clarity entries for `spokenletter.com` stay untouched and Sutura gets new entries beside them. Each console step is read back after submission and recorded in the playbook; no step is reported done without the console showing it.

## Goal

The production site is verified in Google Search Console and Bing Webmaster Tools, the sitemap is submitted and accepted, GA4 and Clarity receive data, Vercel Web Analytics is on, and every identifier and date is recorded in a playbook.

## Files

- `packages/case-lab/site.json` (filled in 3A)
- `docs/release/discoverability-playbook.md` (new: property IDs, verification method, dates, account owner)

## 3A: create properties and collect identifiers (runs before the Phase 2 deploy)

1. **Google Analytics 4** (`analytics.google.com`): create property "Sutura Case Lab", time zone Europe/Madrid, currency USD, web data stream for `https://sutura-case-lab.vercel.app`, enhanced measurement on, Google Signals off. Record the `G-` measurement ID.
2. **Microsoft Clarity** (`clarity.microsoft.com`): add new project "Sutura Case Lab", site `sutura-case-lab.vercel.app`, category Technology. Do not link to GA4. Record the project ID from the URL and the Settings → Overview tracking code.
3. **Google Search Console** (`search.google.com/search-console`): Add property → URL prefix `https://sutura-case-lab.vercel.app/`. Choose the HTML tag method; copy the `content` value and leave the dialog pending (verification completes in 3B).
4. **Bing Webmaster Tools** (`bing.com/webmasters`): Add a site → manual `https://sutura-case-lab.vercel.app/` → meta tag method; copy the `msvalidate.01` value. Leave pending.
5. **Vercel Web Analytics**: enable in the `sutura-case-lab` project (Analytics tab). Confirm with `vercel project inspect sutura-case-lab` that Git is still disconnected.
6. Write the five values into `packages/case-lab/site.json` and the playbook. Commit with `chore(case-lab): add site identifiers` on the Phase 2 task branch.

## 3B: deploy, verify, submit (runs after Phase 2 is merged)

7. Deploy from a local build only:
   ```bash
   cd packages/case-lab && vercel pull --yes --environment=production && vercel build --prod && vercel deploy --prebuilt --prod
   ```
   Confirm the live head contains both verification tags with `curl -sS https://sutura-case-lab.vercel.app/ | grep -E "google-site-verification|msvalidate.01"`.
8. Search Console: complete verification; Sitemaps → submit `sitemap.xml`; URL Inspection → Request indexing for `/` and the five replay URLs (six requests; the daily quota is about ten).
9. Bing: complete verification; Sitemaps → submit; URL submission for the same six URLs. Skip IndexNow: the URL set is stable and changes only at releases.
10. Data check: open the site in a private window, accept the banner, confirm GA4 Realtime shows the visit, Clarity shows a live session, and Vercel Analytics shows the page view.
11. Record every ID, method, status, and date in the playbook.

If Juan buys a custom domain (Open question 1): add it to the Vercel project, set `siteUrl` to it, redeploy prebuilt, add a Domain property in Search Console via DNS TXT, then repeat 8 to 10 for the new origin. Keep the `vercel.app` property; Vercel redirects the old host.

## Verification

- The live-check commands in the main plan's Verification section all pass.
- Search Console shows "Ownership verified" and the sitemap status "Success" with 7 discovered URLs.
- Bing shows the site verified and the sitemap processed.
- GA4 Realtime shows at least one event; Clarity shows at least one session.

## Success criteria

- [x] Google and Bing properties verified; sitemap accepted in both (2026-09-05). Google request-indexing is deferred to 2026-09-06 by quota.
- [x] GA4, Clarity, and Vercel Analytics receive data (2026-09-05).
- [x] `docs/release/discoverability-playbook.md` records every identifier and date.
