# MacBrains Labs: website quality audit

**Date:** November 4, 2026. **Scope:** Public static site only. This is not a WCAG compliance certification.

## Visual inspection

Inspected the live site in **Safari 27.2 on Mac Neo**, including the desktop hero, walking Notch, paper research folios, publication listings, footer and the narrowest Safari window (~574 px). An isolated Chromium browser on Dell was used for **true 320/390 px mobile CSS viewports**, tablet 768 px, desktop 1440 px, and dark/light color-scheme checks.

The updated site has twelve visually reviewed, versioned screenshots:

| Step | Screen | Health | Captured screenshot |
| --- | --- | --- | --- |
| 01 | Home, mobile 390 dark | PASS | [01](../tests/visual/baselines/01-home-mobile-390.png) |
| 02 | Home research folio, mobile 390 | PASS | [02](../tests/visual/baselines/02-home-folio-mobile-390.png) |
| 03 | Home, tablet 768 | PASS | [03](../tests/visual/baselines/03-home-tablet-768.png) |
| 04 | Home, desktop 1440 | PASS | [04](../tests/visual/baselines/04-home-desktop-1440.png) |
| 05 | Research, mobile 390 dark | PASS | [05](../tests/visual/baselines/05-research-mobile-390.png) |
| 06 | Methods, mobile 390 dark | PASS | [06](../tests/visual/baselines/06-methods-mobile-390.png) |
| 07 | Notes, mobile 390 dark | PASS | [07](../tests/visual/baselines/07-notes-mobile-390.png) |
| 08 | Home, small mobile 320 | PASS | [08](../tests/visual/baselines/08-home-small-320.png) |
| 09 | Research, mobile 390 light | PASS | [09](../tests/visual/baselines/09-research-light-mobile-390.png) |
| 10 | Research, desktop 1440 dark | PASS | [10](../tests/visual/baselines/10-research-dark-desktop-1440.png) |
| 11 | Methods, desktop 1440 light | PASS | [11](../tests/visual/baselines/11-methods-light-desktop-1440.png) |
| 12 | Research, small mobile 320 | PASS | [12](../tests/visual/baselines/12-research-small-320.png) |

All cases have no horizontal overflow, exactly one H1, a main landmark, skip link, named hyperlinks, alt text on images, and six visible primary navigation links with target geometry ≥24 px. Screenshot comparisons run against tracked baselines on pull requests.

## Confirmed defects and repairs

1. **Home navigation wrapping:** Previously five links on one row and Contact alone below at phone widths. Now a balanced 3×2 grid at widths up to 480 px, with no hamburger menu or extra JavaScript.
2. **Reduced-motion media:** The previous home video had `autoplay preload="auto"`. In a reduced-motion browser it still requested the **8.2 MB intro MP4**, even though CSS displayed the still. Both video elements now have no eager preload; the existing IntersectionObserver starts the intro only when actually visible and normal motion is allowed. The local HTTP server saw **zero MP4 requests** in every reduced-motion test, and a positive control observed MP4 request **and active playback** under normal motion.
3. **Undersized footer links:** Live axe-core WCAG 2.2 testing reported four `target-size` violations for Research record, Methodology, Field notes and Publications. The home footer links now have at least 28 px height. The candidate's axe-core runs (WCAG 2 A/AA, 2.1 AA, 2.2 AA tags) report **zero violations** in all twelve screenshot cases.
4. **Social share preview missing:** Added dedicated **1200×630** branded PNG and descriptive Open Graph / Twitter large-card metadata to all published pages and generators; each article retains its own title and description.
5. **Device icons and manifest:** Added 16, 32, 48, 192 and 512 px PNGs, ICO fallback and `site.webmanifest`, all based on the approved centered MB master. No background service worker or offline-cache surprises.

## Accessibility evidence and limits

A source-backed contrast guard verifies **15 reviewed foreground/background pairs** across homepage, paper research folios, light and dark inner pages. Each meets the **4.5:1 normal-text** contrast threshold. These color pairs are guarded against unreviewed changes.

Keyboard tests prove that first Tab focuses **Skip to content**, Enter navigates to **#main**, and Space toggles a native details disclosure. The Safari accessibility tree showed the named main navigation, headings, research sections and articles.

Axe may classify contrast over pseudo-elements/patterned backgrounds as **incomplete**, which is distinct from a passing contrast judgment; the independent reviewed-color guard addresses known solid-color pairs, not every possible overlay. No physical iPhone/Android browser, screen reader, slow cellular network or actual social crawler unfurl was exercised. This audit does not claim full WCAG conformance or real-user Core Web Vitals.

## Verification

Site runtime remains static and dependency-light. Generated social PNG is approximately **49 kB**. No new runtime framework, tracking, or mandatory PWA service worker. Original Notch animation frames and timing remain unchanged.

```sh
node scripts/check-site.mjs
node scripts/visual-qa.mjs
```

The second command uses **agent-browser 0.41.0** and local Chromium on a development/CI host. It serves the exact candidate files using an ephemeral loopback HTTP server, verifies markup and media behavior, runs axe, exercises keyboard actions, and compares pixels with tracked baseline PNGs. To intentionally approve new visual baselines: `node scripts/visual-qa.mjs --update` and inspect all screenshots before committing.

The `visual-qa.yml` GitHub workflow runs on pull requests and uploads diffs/screenshots on failure. To regenerate icon sizes/social previews after changing the master SVG, `node scripts/generate-visual-assets.cjs` requires **development-only** Sharp; browsers do not download it.
