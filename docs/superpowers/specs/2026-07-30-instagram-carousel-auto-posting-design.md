# Instagram Carousel Auto Posting Design

## Goal

Upgrade Instagram cross-posting from a single product image to a high-quality, influencer-style carousel that can drive saves, profile visits, and Rakuten ROOM clicks.

## Current State

The current Instagram path posts one image URL through `src/ig/ig-post-engine.ts`. The image is the Rakuten product image, and the caption is generated separately. This is stable, but it looks like a product listing rather than an editorial recommendation.

Instagram content publishing requires media to be available by URL. The existing code already depends on that behavior by sending `image_url` to the Graph API.

## Product Experience

For each promoted item, the system generates a 7-page square carousel:

1. Hook: a strong scroll-stopper aimed at a common frustration or desire.
2. Problem: the audience's everyday pain point.
3. Discovery: why this item is worth noticing.
4. Use case: a concrete before/after or life scene.
5. Proof: review count, rating, price, points, coupon, or shop trust.
6. ROOM bridge: tells the viewer the item is collected in Rakuten ROOM.
7. CTA: asks for save/profile check/comment, without sounding like an ad.

The visual style should feel like a curated Japanese affiliate/influencer carousel, not a raw product catalog. Text must be short, readable on mobile, and written in natural Japanese. Each page uses the product image as a supporting visual, with editorial typography and benefit-led copy.

## Technical Design

Create a new carousel generation layer that converts `RakutenItem` plus ROOM caption into structured slide data and SVG slide files. SVG keeps the first version dependency-light and testable in Node. Each slide is 1080x1080 and can reference the Rakuten product image URL.

Add a new Instagram carousel publisher that accepts public slide URLs. It creates child media containers with `is_carousel_item=true`, then creates a parent `CAROUSEL` container with `children`, waits for processing, and publishes it. If carousel generation or public URL configuration is unavailable, the system falls back to the current single-image post.

Public image URL configuration is explicit:

- `IG_CAROUSEL_ENABLED=1` enables carousel attempts.
- `IG_CAROUSEL_PUBLIC_BASE_URL` points to a public HTTPS directory serving generated files.
- `IG_CAROUSEL_OUTPUT_DIR` controls where SVG files are written locally, defaulting to `public/generated/instagram`.

This first version does not require Canva in the automated path. Canva can still be used later as a human-editable template layer once the winning slide structure is validated.

## Data Flow

1. `main.ts` selects and posts the item to ROOM as it does now.
2. `crossPostToSns` passes the successful item to the persona Instagram engine.
3. `postToInstagramWithPersona` builds the final caption.
4. If carousel is enabled, it generates slide copy and SVG files.
5. It maps generated files to public URLs using `IG_CAROUSEL_PUBLIC_BASE_URL`.
6. It publishes a carousel through Instagram Graph API.
7. If any step fails, it logs the reason and uses the existing single-image post.

## Boundaries

The first implementation focuses on one carousel per cross-post, matching the current one-item SNS behavior. It does not automate Canva editing, image hosting, or Instagram analytics ingestion. Those can be added after confirming that carousel content improves engagement.

## Testing

Add unit tests for:

- slide copy generation shape and limits,
- SVG escaping and 7-page output,
- public URL mapping,
- Graph API carousel request ordering,
- fallback behavior when carousel configuration is missing.

Run `npm test` and `npm run build` before completion.
