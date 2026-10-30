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
- `notes/`: detailed technical notes
- `contact/`: public research correspondence
- `styles.css`: all styling (no client-side JavaScript)
- `favicon.svg`: vector mark

## Hosting

GitHub Pages branch `main` from root, custom domain `macbrainslabs.org`.
DNS A records for GitHub Pages must be configured at the registrar **without** replacing MX, SPF, DKIM, DMARC or other mail settings. SSL is issued asynchronously by GitHub; only claim a live HTTPS site after a successful public check.

No tracking scripts, cookies, analytics or external assets.
