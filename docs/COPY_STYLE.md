# How this site is written

MacBrains Labs is one person's research notebook, so the site is written the way I talk: first person, plain, and short. This page is for anyone (person or agent) editing the copy.

## Voice

- **I, not we.** This is my work. Say so. When AI agents did part of it, say that plainly too.
- **Short sentences.** One idea each. Fragments are fine.
- **Contractions.** I'm, don't, didn't, wasn't, it's.
- **Plain words first, then the exact term.** "the compiler's plan (MLComputePlan)". After that, use the exact term.
- **Questions are fine.** "Where did it run? Was the math right? Is it actually faster?"
- **What happened, what it means, what it doesn't prove.** In that order. "I was wrong about X" is a perfectly good sentence.
- **No hype and no slogans.** No taglines and no "X is not Y" triplets. No "unlock", "seamless", "cutting-edge" or "delve".
- **No em dashes.** Use a full stop or a comma.

## What never changes in a rewrite

- Any number, unit, date, version, DOI, ORCID, hash or ID (N/001, E/001, MBL-2026-001), and any model name, file name or link.
- What a claim covers. A rewrite can make a claim clearer or more careful. It never makes one stronger.
- Every caveat. If the source says something wasn't validated, the new wording says so too.
- Code, raw tool output and measured table values.

## The gate

`node scripts/check-copy.mjs` scans the visible prose of every hand-written page against `scripts/slop-wording.json`. That database holds wording researched as typical of machine-generated text, and every entry cites its sources. Entries marked `block` fail CI. Entries marked `warn` can be the right technical word, so they're only reported (`--warn` shows them).

Two exceptions are skipped on purpose. Code and tool output aren't prose. The archival publication records (`/publications/` and `/research/records/`) are rendered verbatim from verified release metadata, so their wording is fixed upstream.

Before changing copy, also run `node scripts/check-site.mjs`. Some text is bound to structured data: a note's `<h1>` must match its TechArticle `headline`. Page titles feed the share cards, so changing a `<title>` means regenerating them.
