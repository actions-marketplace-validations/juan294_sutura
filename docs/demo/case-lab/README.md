# Case Lab manual inspection, 2026-09-06

Real screenshots taken in Chrome against a local build of the Case Lab
(`node packages/case-lab/dist/bin.js build-site --out <dir> --api-base ""`,
served on `127.0.0.1:8788`). Case: `greenwash-trap`, recorded live result,
outcome refused.

| File | Width | What it shows |
| --- | --- | --- |
| `verdict-first-375x812.jpg` | 375 x 812, inside a fixed-size iframe harness | The verdict headline, reason, evidence line and next action all sit above the consent banner on the first screen. |
| `verdict-first-1440x1000.jpg` | 1440 x 1000, direct | The verdict leads; the mode note, expectation and the failure evidence follow it. |
| `verify-route-and-execution-detail-1440x1000.jpg` | 1440 x 1000, direct | The copyable `sutura verify` command, the Action link, and the closed execution and cost disclosure. |

Chrome will not resize below roughly 500 CSS px, so the narrow capture embeds
the page in a 375 x 812 iframe on a local harness page. The grey surround in
that image is the harness, not the page.

## Defects found and fixed during this inspection

1. The identity block sat in the header and pushed the verdict to 671 px,
   below the 812 px fold. Identity now renders inside the execution
   disclosure, at the end of the page.
2. The mode note and the expectation line sat in the header for the same
   reason. Both qualify the verdict, so both now render after it. The eyebrow
   no longer repeats the scenario sentence, which the verdict evidence line
   already carries; at 375 px that sentence alone was 101 px of header.
3. The 40-character subject hash in the verdict evidence line is one unbroken
   token and ran 38 px past the right edge, giving a 381 px document on a
   375 px viewport. `.verdict-evidence` now sets `overflow-wrap: anywhere`,
   and the document width is exactly 375 px.
4. The consent banner was 259 px tall at 375 px because `.actions .button`
   forces full width below 720 px, stacking Accept and Decline. It now keeps
   its buttons inline and is 175 px tall.
5. The Action setup link carried a `#fragment`. `isPublicHttpsUrl` refuses a
   URL with a fragment, so the page rendered "link withheld: not an https URL"
   instead of a link. It now points at the README file with no fragment.

## Measurements after the fixes

At 375 x 812: verdict spans 205 to 593, consent banner top 637, no overlap,
document width 375, execution disclosure closed.

At 1440 x 1000 with keyboard-only navigation: 13 focusable controls, no
negative `tabindex`, `main` landmark present. The site has no sign-in, so the
captured state is the signed-out state.

`case-lab acceptance --base-url http://127.0.0.1:8788 --offline` passes all 17
checks against this build.
