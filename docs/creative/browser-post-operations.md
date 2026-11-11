# Existing-browser ROOM posting protocol

## Operational pause: platform rules checked 2026-11-11

**Do not activate or execute mechanical ROOM posting/commenting.** ROOM terms Article 11(1)(4) explicitly prohibit mechanical posting/commenting by scripts or other programs. The protocol below is retained as unactivated engineering/test documentation, not permission to run it on ROOM. Moving the same automation to CUA, changing timing, or keeping only a final human click is not a workaround.

Official sources:
- https://room.rakuten.co.jp/info/agreement.html
- https://room.rakuten.co.jp/info/help/guideline/01.html
- https://room.rakuten.co.jp/info/help/guideline/03.html

The general posting guideline prohibits uploading an image without the copyright holder's permission, and expressly gives saved or edited Rakuten product images as an example. This is a rule about re-uploading, not a finding that private downloading alone is forbidden. We have not established a license for the proposed AI editing and re-upload; the normal ROOM product-sharing flow does not establish that broader scope. No blanket official AI-image ban was found, but no blanket permission for AI-generated uploads was established either. An AI image is not a photo taken by the account owner and must not be presented as their original ownership/use photo.

The public rules reviewed do not name automated likes/follows specifically. Their treatment under the broader language is uncertain, so do not activate recurring likes/follows without official clarification. Existing posting/like/follow workflows were stopped; no replacement schedule or new posting state was created by this image integration.

Current permitted preparation scope: prepare candidate product URLs and grounded caption drafts outside ROOM, then let the user personally review and use ROOM's documented normal posting flow. Use the product image automatically supplied by that flow unchanged, or separately verify the rights for any additional image. This preparation proposal is not a claim that ROOM specially endorses AI preparation. Do not proceed with the unactivated live protocol below unless the platform's permission and the user's scope are both established.

Normal user-operated flow: https://room.rakuten.co.jp/info/guide/utilization/02how_room/02.html . Standard product images: https://room.rakuten.co.jp/info/guide/utilization/02how_room/03.html .

## Status and boundaries

This is an implementation and operator protocol, not proof of a live post. CUA is the supported assistant browser runtime; it is not a library that npm can attach to. `src/main.ts` and the local `auto_post` action fail closed with `BROWSER_CUA_WORKER_REQUIRED`, even when a valid bundle or ROOM_COOKIE is present. They never fall back to an AI API, a new Playwright session, random product selection, or SNS cross-posting. A scheduled assistant worker must perform the protocol below using the connected Mac and the GitHub connector. Schedule creation and live operation are separate acceptance steps.

The existing Playwright image adapter is covered by tests and preserves precise UI checks. It is not the default live publisher. `runBrowserBundlePost` requires an explicitly supplied publisher. The GitHub-token state-store adapter is not called by the production entrypoints. The connector protocol below needs no GITHUB_TOKEN or ROOM_COOKIE in the shell or GitHub Secrets.

## Deployment gate

Before live use, verify that old automatic posting entrypoints cannot run in parallel: deploy the fail-closed main/local entrypoint and the reviewed workflow changes, or stop the old posting scheduler with authorization. Do not alter the likes/follows work owned by another worker. Do not activate a schedule merely because unit tests passed.

Read main's `room_post_intent.json`, `posted_items.json` and `browser_room_post_state.json`. The old unresolved intent is strictly read-only. Every legacy intent item, posted item and uncertain item remains excluded. A missing required file or failed read is an error, not an empty state.

The new state file must be initialized once, only if a current authenticated root-tree read proves it is absent: `{"version":1,"active":null,"records":[]}`. Use one connector commit based on the current main tree and CAS-update main with its exact expected head. Never initialize over an existing file. If this update has an uncertain outcome, read the head/tree before any retry. Do not remove or rewrite the old intent. Initialization is not a posting reservation.

## Browser-generated bundle

1. Fix the selected item, its canonical Rakuten product URL, actual product images and exact ROOM collect URL observed from that product's ROOM action. The numeric `itemcode` in `/mix/collect` is not the same as the Rakuten `shop:itemCode`; do not derive or guess it. The observed collect form has no canonical product anchor.
2. Generate the prompt with `npm run --silent image:prompt -- product.json room hero`. Its first line is the literal `/showcase` label, not a claimed special ChatGPT command. Use the existing authorized ChatGPT browser. Select the lower available model only if that choice is actually available and compatible with image generation; record the UI label and mode honestly. Never use an AI API instead.
3. Attach the correct product reference through the supported browser workflow, preserving any unresolved approval. Review actual output pixels: shape, color, logo, text, parts, quantity, and no false accessory/effect/experience claims. If fidelity fails, preserve the real product photo and change only its surroundings, or stop.
4. Save a new isolated bundle directory containing `product.json`, `prompt.txt`, `caption.txt`, and a PNG/JPEG. Product JSON must include all RakutenItem fields plus `roomCollectUrl`. Caption must be 1–500 UTF-16 units, LF line endings, and exactly the text reviewed. Do not trim or truncate it later.
5. Create metadata with `id`, `imageFile`, `mimeType`, `provenance:{source:"ChatGPT Web",model,mode,generatedAt}`, and `review:{reviewer,reviewedAt,visualFidelity:true,groundedCopy:true,productDestination:true}` only after those checks were actually performed. Run `npm run room:bundle -- <directory> <metadata.json>`. It hashes and validates existing files, creates a new manifest, and performs no generation or post. Review fields are operator assertions, not independent proof or user authorization.

## Current-head snapshot

Use the GitHub connector for `meganeojisan1984-ctrl/rakuten-room-auto-system`, branch `main`. Retrieve its current head, commit tree and parent SHAs, then all three state files **at that exact immutable head**, not separately at a moving branch. Save this local JSON, without credentials:

```json
{
  "version": 1,
  "source": "GitHub connector",
  "repository": "meganeojisan1984-ctrl/rakuten-room-auto-system",
  "branch": "main",
  "head": "40-character commit SHA",
  "tree": "40-character tree SHA",
  "sourceRef": "same commit SHA as head",
  "parents": ["parent commit SHA"],
  "fetchedAt": "actual current ISO timestamp",
  "files": {
    "room_post_intent.json": {"sha": "blob SHA", "content": "exact UTF-8 file content"},
    "posted_items.json": {"sha": "blob SHA", "content": "exact UTF-8 file content"},
    "browser_room_post_state.json": {"sha": "blob SHA", "content": "exact UTF-8 file content"}
  }
}
```

The CLI checks Git blob hashes (including Git's header), required state schema, immutable sourceRef and two-minute freshness, rejecting future timestamps. It cannot prove that operator-supplied JSON came from the connector. Do not fabricate, re-date, or reserialize content before hashing. Retain source tool results. Fetch a fresh complete snapshot for each stage; stale snapshots cannot be reused to rewind posted/uncertain records.

## Reserve, then mark an attempt before mutation

`npm run room:transaction -- reserve <manifest> <snapshot> <expected-profile-url> <new-plan.json>`

Apply exactly the emitted plan using GitHub connector `create_tree` with `base_tree_sha=baseTree` and its `tree_elements`, `create_commit` with the sole parent `expectedHead`, then `update_ref` with `branch_name=main`, `expected_sha=expectedHead`, `force=false`, and the new commit SHA. Do not include extra paths. No browser mutation occurs in this stage.

Read the current head and files back from the connector and run:

`npm run room:transaction -- verify <manifest> <readback-snapshot> <plan.json>`

Any CAS conflict or uncertain write outcome requires read-only reconciliation. Do not retry the operation blindly. After verified reservation, get a fresh full snapshot and run:

`npm run room:transaction -- begin <manifest> <fresh-snapshot> <requestId> <new-begin-plan.json>`

Apply and verify the begin plan in the same way. It persists `active.status="unknown"` and a unique attemptId **before the first upload or submit**. Only the worker that itself successfully performed this exact reserved→unknown CAS, read it back, and has uninterrupted knowledge that it has not yet attempted the external mutation may continue. A saved plan, a verify result, or an existing unknown record is never execution permission. `browserActionPermitted` is always false in CLI output for this reason. A restarted/resumed/second worker must stop at unknown, even if a prior attempt may not have reached the browser. Do not automatically free reservations or unknowns.

## Single CUA attempt in the existing Mac browser

Use the supported CUA API for the selected Mac browser, not a new Playwright context. Observe fresh UI before each action. Confirm the visible unique signed-in `my ROOM` link resolves to the expected explicit `/room_.../items` profile. `/my` is a different public user and is never proof of identity. If logged out, preserve the login tab and let the authorized sign-in flow resolve it.

Before uploading, confirm the selected product page, observed collect URL, visible product name and image, and exact caption. Upload only the bound reviewed image through the observed file input. Follow upload→crop preview→save→management preview→apply→main preview. Require the saved ROOM image URL and decoded visible preview to persist through each stage; stop on ambiguous controls, approval-pending, failure or uncertain completion. Never proxy-approve a pending card.

Immediately before the sole publish click, recheck the current account, numeric collect destination, exact full caption after modal closure, one decoded attached image, and the unique visible enabled create button. Never press a hidden edit button, silently truncate text, or retry a timed-out upload/submit.

After the one publish attempt, require a concrete new `/room_<expected>/170...` permalink. Confirm the selected product link, exact caption and uploaded image in **that permalink's main post**, not recommendations elsewhere. ROOM recompresses images, so local SHA cannot equal remote bytes: preserve the upload-to-preview mapping, match the ROOM image path, and visually verify product fidelity. A toast or public profile page is insufficient. Pending confirmation, timeout, uncertain response, or browser loss leaves unknown permanently in place until a separate read-only reconciliation establishes what happened.

Observed UI selectors and scoped DOM checks are recorded in `src/browser-room-upload.ts`; treat them as observations, not stable guarantees. Reinspect if the UI changes. The generated image is not a real-use photo; do not label it as an original ownership/usage photo.

## Record confirmed success atomically

Save observation evidence tied to this exact attempt:

```json
{
  "source": "Mac CUA observed",
  "observedAt": "actual current ISO timestamp",
  "requestId": "reserved requestId",
  "attemptId": "begin attemptId",
  "manifestHash": "reviewed manifest SHA-256",
  "ownProfileUrl": "https://room.rakuten.co.jp/room_expected/items",
  "roomPostUrl": "observed permalink",
  "productUrl": "observed canonical product URL from main post",
  "collectUrl": "observed bound collect URL",
  "captionSha256": "SHA-256 of the exact observed caption",
  "uploadedImageUrl": "observed saved ROOM image URL",
  "publishedImageUrl": "observed main-post image URL",
  "imageDecoded": true,
  "visualProductMatch": true,
  "captionVerified": true,
  "samePostScopeVerified": true,
  "uploadMappingVerified": true
}
```

These are actual observations, not values copied from expected data to make validation pass. Re-read the live post if the two-minute evidence freshness expires; no repost is needed. Fetch a fresh complete main snapshot, then:

`npm run room:transaction -- finish <manifest> <fresh-snapshot> <evidence.json> <new-finish-plan.json>`

The plan writes both new-state history and posted_items in one CAS commit and keeps every old field/uncertain code. It never writes the legacy intent. Apply/readback/verify exactly as above. Only a verified final state plus observed permalink constitutes completion. If final persistence fails, retain the unknown active slot and do not repost. Read-only observation can later support retrying only the state persistence, not the publication.

## Acceptance still required

- Final code/CI checks on the published branch, deployment/old-entrypoint gate verification.
- Real ChatGPT browser generation with `/showcase` and downloaded/reviewed bound assets.
- Current Mac ROOM identity verification and any pending upload authorization.
- One complete real reserve/begin/CUA/finish/readback sequence.
- A supported recurring assistant schedule with the same runbook and stop-on-unknown rules, verified after creation.

SNS uses the same showcase prompt and asset review requirements, but its publisher is not connected by this change.
