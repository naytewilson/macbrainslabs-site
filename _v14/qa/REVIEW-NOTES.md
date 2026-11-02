# V14 local website review

## Source/runtime checks
- Exact recovered V13 video SHA matches the delivered/accepted animation; no art, frame or motion changes.
- Local asset and fragment targets, unique IDs, media tags/frame count pass.
- Manual play/pause/Replay, hidden-tab pause, reduced-motion still/manual override and decode-failure behavior pass runtime mocks.
- No automatic playback, forced looping, scrolling interception or external scripts.
- All research sources used for factual copy returned HTTP200 and were saved with hashes.

## Actual root-owned browser review (in progress until final captures)
- Desktop hero, research folios and methods inspected. Research anchor and disclosure02 exercised.
- Locked icon cream surround found and corrected using only non-destructive CSS clipping; actual root review confirms clean header. Original raster and MB/slash unchanged.
- At320 CSS, root found word concatenation where responsive linebreaks were hidden, and a horizontally clipped folio nav. Both corrected: explicit whitespace and compact three-row mobile nav. Regression checks added.
- Root measured no body overflow in the320 iframe (305/305 CSS content width after its scrollbar).
- Final refreshed phone and actual video checks remain separately recorded by root; source mocks do not claim physical-device or browser reduced-motion emulation.

No live deployment or user design approval is implied.

## Final closure
- Root refreshed320/390 CSS wrappers: content widths305/375 respectively equal scroll widths; no horizontal body overflow.
- Root actual keyboard test: Tab exposes Skip; Enter focuses H1#hero-title; next Tab reaches Open research, bypassing navigation.
- Independent reviewer verified the3 accessibility corrections and reran syntax, controls and verify.py checks. See INDEPENDENT-REVIEW.md and its13 hash pins.
- Root actual desktop video reached its held ending, followed by13 native scroll steps. The saved1000-screenshot walkthrough starts with Notch already playing; it does not claim complete-start animation coverage.
- Walkthrough encode preserves every observed timestamp exactly at1ms resolution, with1.5s final hold,1001 encoded frames and29.394s duration. JPEGfull-range601→709/sRGB conversion; representative decoded cream folio inspected and remains cream, not clipped white.
- Full self-contained website includes the exact20.083333s V13 master, independently of this shortened browser walkthrough.
- Source/runtime and actual browser scopes are distinct; no physical-device test, live deployment or user design acceptance is claimed.
