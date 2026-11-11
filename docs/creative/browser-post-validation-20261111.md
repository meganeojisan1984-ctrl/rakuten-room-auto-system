# Browser showcase integration validation (2026-11-11)

- Base: PR #29 `e998038`, followed by its positive account guard and sanitized diagnostics (`bc9b6ef` equivalent local commits).
- Isolated Mac worktree: no production checkout or legacy intent overwrite.
- Prompt generation: literal `/showcase`, product-specific lighting/background/composition and fidelity/claim constraints.
- Bundle validation: selected item + observed numeric collect URL + exact prompt/caption/image SHA-256, review assertions, bounded files, no symlinks, PNG/JPEG structure checks, immutable in-memory upload bytes.
- Existing-browser protocol: pure reserve/begin/finish/verify plans for GitHub connector CAS. One immutable main snapshot per stage; legacy intent read-only; uncertain exclusions preserved; `unknown` persisted before external action; atomic completion updates state and posted list. A verify output never grants browser execution permission.
- Main/local scheduled posting is fail-closed; no Cookie/AI API/random-product/SNS fallback. CUA existing-session operations require a supported assistant worker and the documented single-attempt protocol.
- Shared positive account identity guard is reused rather than `/my`. Exact form caption and collect destination are rechecked immediately before submit. Main-post product and uploaded-image evidence are scoped.

## Checks

`npm run build`: PASS.

`npm test`: 345 total, 342 passed, 3 failed. The failures match the pre-existing Mac baseline: two tests require the absent Playwright Chromium headless shell (image normalization and ROOM like markup); one StreamDeck test expects filesystem case behavior differing on this Mac. No new test failure remains. Linux CI for the final published head is still required.

Focused checks cover reserve ordering, CAS conflict/readback failure, stale/future/malformed snapshot rejection, all legacy exclusions, unknown restart blocking, duplicate bundle/image reuse, exact product/caption/photo/permalink evidence, preservation of old posted fields, common account identity, single upload controls, immutable image bytes, bundle packaging, and fail-closed entrypoints even when dummy cookies/tokens are set.

A mocked serialized browser callback was executed in an isolated VM to detect transpilation closure errors. Read-only Mac UI inspection confirmed the collect form lacks a canonical product anchor, and scoped permalink selectors differ from a conventional article element. These checks are not a real upload/publish test.

## Not yet verified

- Production deployment and old scheduler/workflow exclusion gate.
- A real new `/showcase` image generated in ChatGPT Web and reviewed/downloaded into a bound bundle.
- Current ROOM Mac login and any pending upload approval.
- One live connector reserve/begin → CUA upload/submit → main-post observation → atomic finish/readback.
- Recurring supported assistant automation and SNS publishing.

No live post, upload, production state update, workflow activation or API image generation was performed by this validation.
