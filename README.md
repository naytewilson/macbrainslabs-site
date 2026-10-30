# MacBrains Labs — research site

Static, dependency-free public website for independent Apple Silicon and Apple Neural Engine research.

**URL:** https://macbrainslabs.org

## Evidence and claims

This is an editorial research front-end, not an official Apple-affiliated or government-affiliated laboratory. Research summaries come from separate ANE-RE internal measurements and receipts. This site does not contain private source code, model weights, personal contact address, credentials, or internal machine paths.

- **Qwen2.5 1.5B / 28L LUT4:** MLComputePlan inference assignment 2,090 ANE / 79 CPU (3.6% CPU argmax tail), according to `docs/FINDINGS.md`.
- **Qwen batch sweep:** 45.4 / 68.1 / 102.1 / 125.8 aggregate tok/s at B=1/2/4/8, per D028.
- **LFM S2:** 743/743 ANE-assigned compute operations on a specific sealed production graph, separate from a divergent 46-output diagnostic graph; source receipt `LFM_S2_NATIVE_PARITY_2026-07-18.md`.
- **Quantized quality:** 16.8033 perplexity on WikiText-2 for named Qwen LUT4 experiment, D263.

Terms like "ANE placement" refer to Core ML MLComputePlan assignment, *not* direct chip tracing.

## Structure

- `index.html`: home and overview
- `research/`: source-bound results
- `methods/`: experimental methodology
- `notes/`: field-note index and detailed technical notes
- `evidence/qwen-placement/`: evidence bundle E/001 (placement tools, recorded output, provenance)
- `contact/`: public research correspondence
- `styles.css`: all styling, light and dark via `prefers-color-scheme`, system fonts only (no client-side JavaScript)
- `favicon.svg`: vector mark

## Hosting

GitHub Pages branch `main` from root, custom domain `macbrainslabs.org`.
DNS A records for GitHub Pages must be configured at the registrar **without** replacing MX, SPF, DKIM, DMARC or other mail settings. The custom domain has been live with enforced HTTPS since October 29, 2026. Verify DNS, TLS and every link after future deployments.

No tracking scripts, cookies, analytics or external assets.

## Regression checks

`node scripts/check-site.mjs` validates every root-relative internal link, sitemap URL, metadata canonical, published page, required asset, the contact address on every page, that the home placement figure draws exactly as many cells as its stated operation counts, and that the evidence bundle's tool files and counts match its `provenance.json`. Run `node scripts/check-site.mjs --live` after GitHub Pages deployment to verify the public custom-domain copy. GitHub Actions runs the local test at every PR and on the main branch.
