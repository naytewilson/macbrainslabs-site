# Public advisory evidence — 31 October 2026

This publication-specific artifact accompanies the two [project-owner advisories](https://macbrainslabs.org/security/). It is a curated extraction of existing recorded observations, not raw logs, a fresh execution, independent replication, or a complete public reproducer.

## Inspecting the data

- `results.json` contains exact tested revision IDs, six sentinel comparisons, three derivative-record comparisons, regression totals and explicit limits.
- Sentinel hashes and derivative metadata were extracted from the retained original logs after checking their byte lengths and SHA-256 values against the private validation packet manifest.
- Suite totals are transcribed from those checked logs. The parent gate suite's seven failures include six adversarial assertions and one historical-data expectation.
- `SHA256SUMS` checks the integrity of these public files. A matching hash confirms bytes, not that an experiment ran or its conclusion is correct.

Download both files and the checksum list into one directory, then run `shasum -a 256 -c SHA256SUMS`. The site repository also runs `node scripts/check-site.mjs`.

## Source availability and attribution

The underlying research automation source is private. The public ANE measurement-summary repository is a separate project and is not identified as affected by these defects. No private source, ledger, raw fixture evidence string, host name, personal address or local filesystem path is included here. Revision and retained-log hashes are provenance references; they do not make the private program publicly reproducible. Technical evidence inquiries can be sent to research@macbrainslabs.org.

Nayte Wilson directed the work with AI assistance. Both repairs belong to one June 2026 hardening effort. The documented repair record is dated 24 June; this is not an asserted first-discovery date. The validation packet was prepared on 31 October 2026 UTC; that preparation date does not timestamp every individual test. These pages were first published on 31 October 2026 UTC.

These are project-owner reports. No CVE, independent disclosure acceptance, certification, outside adoption or program approval is claimed.
