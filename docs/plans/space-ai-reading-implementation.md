# SPACE AI 1.0.1 Implementation Plan

**Goal:** Implement the approved reading UX specification without replacing the user's installed 1.0.0.

**Architecture:** Apply two fail-closed source transforms to the pinned browsa archive. Reading and attachment modules have separate ownership; the existing fixed identity, provider configuration and store bridge remain compatible.

**Tech Stack:** ES modules, Chrome MV3, existing pdf.js, Vitest and Playwright.

- [x] Implement `extensions/space-browsa/reading-patch.mjs`: protect drafts and attachments; extract the current page before summarizing; keyboard selection, editable exclusion and viewport-safe placement. Verify dedicated reading tests.
- [x] Implement `extensions/space-browsa/attachments-patch.mjs` and attachment modules: bounded TXT/MD/PDF parsing, state cards and removal; explicit send and context isolation. Verify size, cancellation and send-payload tests.
- [x] Update `scripts/build-browsa.mjs` to apply both transforms before packaging, record patch hashes in provenance, and ship 1.0.1 with the existing identity. Verify clean build and original provider tests.
- [x] Add real browser integration coverage for current-page summary, retained draft, keyboard selection, attachments/removal and mock API payloads. Run `npm run check`, `npm test`, browser regressions and `npm audit --audit-level=moderate`.
- [x] Review implementation against approved spec and code quality, fix failures, document verified limits and copy the final ZIP/unpacked directory to Downloads without overwriting 1.0.0.
