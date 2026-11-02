# MacBrains Labs — integrated homepage draft V14

Local-only website draft built 1 November 2026. No hosted Site registered, no deployment and no change to macbrainslabs.org. User-requested creation; user delegated design decisions and requested no opinion checkpoints.

## Run

Buildless HTML/CSS/JavaScript; no installation needed.

```sh
sites-preview start /workspace/scratch/a8d9cd5bac09/macbrains-homepage-v14
```

Use the exact returned preview URL. The managed preview daemon serves `dist/` from `.openai/hosting.json`; do not start a competing HTTP server. `mobile-review.html` is a 390 CSS-pixel iframe simulation, not a physical-device test.

## Checks

From this directory:

```sh
node --check dist/app.js
node tests/controls.test.cjs
python3 tests/verify.py
```

These verify source/runtime mocks, links to local assets/fragments and exact media identity. They do not substitute for actual browser visual review. Root owns CUA review and captures.

## Design

An editorial opening pairs the finished Notch with the research question. The paper folios give each study a finding, a boundary and a source together. A small spine-origin reveal occurs once on ordinary scroll; no pinning, scroll hijacking or hidden text. Methods use native details/summary. Content remains usable without JavaScript.

Video is manual, never auto-looping. It pauses when the document is hidden and holds the actual ending. Reduced-motion users see the settled representative still and can explicitly play. No collection form, invented contact address, testimonials, performance promises or fake destination links.

## Asset provenance

- Locked icon copied byte-for-byte from the existing MacBrains draft `dist/assets/locked-icon.png`.
- User-authorized Drive file `14mNZkZKP2Qf65ooXRi_SCaViXv2Mr3l2` supplied the exact V13 lossless 482-PNG TAR, 172,418,048 bytes, SHA256 `939e4ee13927c24397c7054dadeb5ee2cccbcb6a39b61457714969f74c036f95`.
- Safe extraction used regular files only, no absolute/traversal names.
- Re-encoded with the proven full-range BT709 matrix / sRGB transfer pipeline at 24fps. Result is BYTE-IDENTICAL to the accepted V13 master: SHA256 `6fc253ce2cf495e2ec9f922495da372e4a9ec914146c8546a9dc618c2845f073`, 8,574,149 bytes, 1350×1890, 482 frames.
- Poster images decoded from that master at frames83 and481. No animation/art/native geometry edits.
- CSS black #0d0f0f follows the prior matching media presentation. Browser color verification is recorded separately, not inferred from source RGB.
- No denied Library retrieval was retried. This recovery used the independent user-supplied Drive copy.

## Research provenance

Existing project content was cross-checked against actual HTTP200 copies retrieved 1 November 2026 into `sources/`:

1. https://macbrainslabs.org/evidence/qwen-placement/ — June2,090ANE/79CPU versus later shipped2,147/82, with compiler-plan limitation.
2. https://macbrainslabs.org/notes/lfm-chain/ — individual slice parity versus failed16-layer chain/token logits.
3. https://macbrainslabs.org/notes/decode-regimes/ — batch/dispatch investigation.
4. https://macbrainslabs.org/methods/ — native build/method description.

Source links lead to the existing published records, not invented local reports. The design draft does not claim those historical findings are new November measurements.

## Scope

Existing design/scroll studies remain untouched. This is a reconstructed integrated draft based on the available earlier source and recovered finished V13 media; it does not claim to restore missing editable Blender or later scroll-study source.
