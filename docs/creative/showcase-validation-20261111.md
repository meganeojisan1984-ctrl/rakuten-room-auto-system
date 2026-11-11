# /showcase prompt preparation validation (2026-11-11)

- Base: PR #29 head `e998038af3bbcd42f7f4d917d89f866acfced9a3`.
- Isolated Mac worktree: `/Users/syota/Documents/Codex/rakuten-room-showcase-20261111`.
- Branch: `feat/product-showcase-prompts`. Original repair worktree and PR #29 were not edited.
- Personal Mac skill: `/Users/syota/.codex/skills/create-product-showcase`. Skill schema validation passed. The current cached skills list did not yet list the new file, so automatic discovery in a fresh task is not verified.

## Verified
- Actual supplied reference image was materialized on the Mac and visually inspected.
- New prompt-only path: `npm run --silent image:prompt -- product.json room hero`.
- Nine target/shot combinations preserve the product record and begin with literal `/showcase`.
- Missing product identity or reference-image URL, invalid URLs, unsupported targets/roles, and non-string product data are rejected.
- The prompt distinguishes product reference from style reference; requires real pixel inspection; preserves shape/color/logo/parts/count; prohibits invented effects, claims and usage experience.
- The command uses only local file reads and stdout, with no posting module, API, browser, or state writer imported.
- Focused tests: 5/5 passed, including the real npm image:prompt entrypoint. The npm command uses node --import tsx to avoid the tsx CLI temporary IPC listener that this Mac sandbox rejects.
- Independent skill exercise preserved product identity, avoided unsupported claims, and correctly reported missing actual image pixels rather than claiming generation.
- TypeScript build: passed.
- Full suite: 220 passed / 223 total. The same three failures reproduce against unchanged PR #29: missing Playwright Chromium headless shell (image-normalize and like-markup) and Stream Deck case-sensitive path expectation on this Mac.
- The full suite removed its local tracked room_post_intent.json fixture; the isolated worktree file was restored byte-for-byte from HEAD afterward. No production intent file was changed.

## Not performed
No generated image, browser submission, product-image upload, ROOM/SNS publication, remote push, PR update/merge or deployment. Existing main/scheduler/Actions/API image generation is unchanged; this is an interactive browser-preparation path, not unattended production integration.
