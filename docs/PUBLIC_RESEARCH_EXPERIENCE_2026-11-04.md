# MacBrains Labs: Public research experience, verified release v2

**Scope:** The public `macbrainslabs.org` GitHub Pages website. Existing ANVIL and private research pipeline authority is not changed. Source-of-truth for experimental claims remains the published research summaries, field notes and verified archive feed.

## Visitor paths

- `/start/`: one-minute editorial introduction to four independent questions: build artifact, reported placement, numerical fidelity and measured performance. Each section links to existing public research. Does not imply a physical ANE trace, peer review or a speed guarantee.
- `/research/explore/`: accessible searchable catalog of **13 source-linked entries at launch**: 3 measured observations, 3 compiler-planner observations, 5 field notes and 2 verified archived releases. It derives rows from `research/index.html`, `notes/index.html` and the currently verified `publications/publications.json`. No new experiment or claim is created. The optional client-side filter uses existing DOM, URLSearchParams and no network requests. All results remain visible and linked without JavaScript.
- Navigation links are deliberately placed within the existing home hero, research record and homepage's publication section. The original six-link main navigation is preserved to avoid crowding.

## Identity continuity

The homepage's approved centered black, white and orange MB artwork now appears in the header and footer of every inner page, the error page, and the two publication/diagnostic generator templates. Editorial type, tables, math and technical depth are retained.

All 17 inner public routes have individualized 1200×630 PNG and editable SVG previews derived from each page's real OpenGraph title, with evidence-type labels and the original MB mark. `scripts/build-social-cards.mjs --check` proves image bytes and metadata, using development-only Sharp 0.35.5. New pages or publications get unique cards during scheduled verified publication refresh.

## Mobile media verification

The approved Notch animation is unchanged at 1350×1890. Under 700px CSS width, H.264 mobile encodes at 720×1008 retain the 24fps frame counts, full-range BT.709 primaries and sRGB transfer. FFmpeg 8.0.1 compared the mobile encodes frame-for-frame with the downscaled originals.

| Sequence | Original | Mobile | Smaller | All-frame SSIM | Mean PSNR |
|---|---:|---:|---:|---:|---:|
| Notch intro | 8,574,149 B | 1,849,783 B | 78.4% | 0.996804 | 43.673779 dB |
| Sway loop | 1,311,937 B | 139,194 B | 89.4% | 0.997872 | 46.121682 dB |
| iOS image fallback | 9,940,957 B | 2,072,820 B | 79.1% | 0.997417 | 44.635460 dB |

Actual dimensions, frame counts, original/mobile SHA256 digests, durations, metrics and color metadata are recorded in `assets/notch-mobile-manifest.json`, regenerated/tested by `scripts/check-mobile-media.mjs`. The static video source chooses mobile media at max-width 700px; `home.js` selects matching loop/fallback on the same breakpoint. Reduced-motion visitors must fetch **zero MP4 bytes** and see the still. Normal-motion visitors retain automatic in-view playback.

## Production and regression gates

- `node scripts/check-site.mjs`: static correctness, current local assets, responsive media receipt, unique share card link and manifest checks, published source and archive guards.
- `node scripts/build-public-experience.mjs --check`: generated public explorer and primer match the recorded source files.
- `node scripts/build-social-cards.mjs --check`: every route's OG/Twitter card matches its image and source title; Sharp only on build/CI, never client runtime.
- `node scripts/check-mobile-media.mjs --check`: verifies video SHA256, transfer reductions and frozen comparison receipts.
- `node scripts/visual-qa.mjs`: 17 pixel baselines for desktop, tablet, phone and filtered results, axe-core WCAG tagged rules, real keyboard navigation, reduced-motion and mobile/desktop Notch selection. `--update` only after human/maintainer visually approves new expected baselines.
- `node scripts/test-live-site-verifier.mjs`: local HTTP smoke test **and corrupted-social-image negative control**.
- `node scripts/verify-live-site.mjs --attempts=24 --delay-ms=12000`: checks the actual `https://macbrainslabs.org` deployment, exact published asset SHA256 values, URLs from the sitemap, OG image per public page, compiled manifest, evidence catalog and mobile MP4s. It does not confuse a successful GitHub code check with deployment acceptance; it tolerates Pages propagation and reports superseded SHA explicitly.

GitHub Actions `site-check.yml` and `visual-qa.yml` gate PRs. On `main`, `live-site-verify.yml` rechecks the deployed site after each push and twice daily. `publications.yml` regenerates the explorer and cards from the same last-known-good publication release instead of silently leaving stale supplemental pages. If the verified upstream archive cannot be rebuilt, that workflow fails closed and leaves the prior public release intact.

**Limitations:** This is not a physical iPhone or Android test, independent laboratory reproduction of research, a security penetration test, actual social crawler cache purge, or a Web Vitals field study. Axe's incomplete color-contrast checks for layered pseudo-elements are distinguished from zero reported axe violations; the 15 source-reviewed text color pairs are checked separately.

## Screenshot evidence

- `tests/visual/baselines/05-research-mobile-390.png`: approved MB header on the existing research.
- `tests/visual/baselines/13-explorer-mobile-390.png` and `14-explorer-desktop-1440.png`: evidence explorer responsive header and source count.
- `tests/visual/baselines/15-start-mobile-390.png` and `16-start-desktop-1440.png`: one-minute guide on both sizes.
- `tests/visual/baselines/17-explorer-filtered-390.png`: working LFM note filter with linked public field notes.
- `assets/social/notes-lfm-chain.png`: sample page-specific research sharing card.

The full HTML content, screenshot baselines, video encodes, source-bytes verification and static JavaScript belong to this website source release; they do **not** require ANVIL, a dynamic backend, a new private service, or runtime analytics.
