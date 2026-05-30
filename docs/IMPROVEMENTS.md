# Improvements Backlog

Issues identified on 2026-05-29 via code audit. Each item has a file reference, diagnosis, and concrete fix so implementation can start immediately.

---

## Priority order

| # | Title | Effort | Impact |
|---|-------|--------|--------|
| 1 | [Redis preview cache](#1-redis-preview-cache) | Small | Eliminates repeated IG hits across replicas |
| 2 | [Parallel S3 uploads in worker](#2-parallel-s3-uploads-in-worker) | Small | Cuts import time 3–5× for large profiles |
| 3 | [Return thumbnail URLs instead of base64](#3-return-thumbnail-urls-instead-of-base64) | Medium | Preview response ~10× smaller, faster paint |
| 4 | [Parallelise the 3 sequential IG calls in preview](#4-parallelise-the-3-sequential-ig-calls-in-preview) | Medium | Cuts cold preview latency 2–3× |
| 5 | [Include signed assets in succeeded status response](#5-include-signed-assets-in-succeeded-status-response) | Trivial | Removes one full round-trip after import |
| 6 | [Admin scrape-health endpoint](#6-admin-scrape-health-endpoint) | Small | Visibility before users report issues |
| 7 | [Consolidate IG_HEADERS into shared-instagram](#7-consolidate-ig_headers-into-shared-instagram) | Trivial | Single source of truth, prevents drift |

---

## 1. Redis preview cache

**Status:** Not started  
**Files:** `apps/api/src/instagram/instagram-preview.service.ts:268-270`, `:607-616`

### Problem

The preview cache is an in-process `Map`:

```ts
// line 268
private readonly previewCache = new Map<
  string,
  { expiresAt: number; payload: CachedPreviewPayload }
>();
```

With 2+ API replicas (standard on Railway), each process has its own cache and independently hits Instagram for the same username within the same 5-minute TTL window. Cache misses multiply by the number of replicas.

The eviction policy (line 612) is also broken — it deletes by insertion order (`keys().next().value`), not by last access. A heavily-used profile can be evicted while stale entries stay.

### Fix

Replace the `Map` with Redis. Cache key: `preview:v1:{username}:{fetchCount}:{timelineOrder}`. TTL: 300s (same as now).

```ts
// write
await redis.set(cacheKey, JSON.stringify(payload), 'EX', 300);

// read
const raw = await redis.get(cacheKey);
if (raw) return JSON.parse(raw) as CachedPreviewPayload;
```

Redis is already a hard dependency (BullMQ), so no new infra is needed. The `appendPostsToCache` method (line 876) needs an equivalent Redis `GET → merge → SET` pattern.

---

## 2. Parallel S3 uploads in worker

**Status:** Not started  
**File:** `apps/worker/src/storage/upload-scrape-assets.ts:144-173`

### Problem

The upload loop is fully sequential — each image is downloaded from the IG CDN and then uploaded to S3 one at a time:

```ts
for (const p of params.summary.postsSample) {
  // ...
  const { body, contentType } = await fetchBytes(url);  // waits
  await persist(key, body, contentType);                 // waits
}
```

For 12 images at 1–2s each, this adds 12–24s to job time that the user is polling through.

### Fix

Collect all `(url, key)` tuples upfront, then run them concurrently with a cap (5 concurrent is safe):

```ts
import pLimit from 'p-limit';

const limit = pLimit(5);
const tasks = urlsToUpload.map(({ url, key, contentType }) =>
  limit(async () => {
    const { body, ct } = await fetchBytes(url);
    await persist(key, body, ct);
  })
);
await Promise.allSettled(tasks); // allSettled so one failure doesn't abort others
```

`p-limit` is a zero-dependency package. Expected result: 12 images go from ~15s to ~3–4s.

---

## 3. Return thumbnail URLs instead of base64

**Status:** Not started  
**Files:** `apps/api/src/instagram/instagram-preview.service.ts:201-258` (`fetchInstagramImageAsDataUrl`, `inlinePostsPreviewThumbnails`)

### Problem

After fetching IG data, the API downloads each preview thumbnail, converts it to a base64 data URL, and embeds it in the JSON response:

```ts
// line 245
const dataUrl = await fetchInstagramImageAsDataUrl(raw, MAX_POST_THUMB_BYTES);
out[i] = { ...item, thumbnailUrl: dataUrl };
```

With `PREVIEW_THUMB_CONCURRENCY = 4` (line 47), this blocks the API response for 1–4s and inflates the payload:
- 12 thumbnails × ~200KB base64 ≈ **2.4MB JSON response** vs ~2KB of URLs

### Fix

Return the raw CDN URL. The plugin UI (`PostPreviewList`) renders `<img src={thumbnailUrl}>` — it can load CDN URLs directly. The iframe security restriction in Figma only applies to `fetch()` calls, not `<img>` tags.

Remove `inlinePostsPreviewThumbnails` from the preview response path. If the avatar (`profilePicDataUrl`) also needs to move, the plugin can load it as a lazy `<img>` too.

**Note:** IG CDN URLs expire (typically 1–3 hours). They're only needed during the preview interaction, so expiry is not a concern.

---

## 4. Parallelise the 3 sequential IG calls in preview

**Status:** Not started  
**File:** `apps/api/src/instagram/instagram-preview.service.ts:780-820`

### Problem

`fetchInstagramPreviewDirect` chains three Instagram HTTP requests sequentially:

1. `web_profile_info` → gets user node + up to ~12 posts (1–3s)
2. `feed/user/{id}` page 1 → gets up to `PREVIEW_PAGE_SIZE` posts (1–3s)
3. `feed/user/{id}` page 2 → pre-fetches next page (1–3s)

Each has a 20s timeout. Worst case: 60s blocking the user. Typical case: 5–9s.

### Fix

The profile info request must come first to get `instagramUserId`. After that, page 1 and page 2 fetches can run concurrently:

```ts
// After getting instagramUserId from web_profile_info:
const [page1, page2] = await Promise.allSettled([
  this.fetchTimelinePageByFeedMaxId(userId, undefined, PREVIEW_PAGE_SIZE, ctx),
  // page 2 without a cursor — may fail or return duplicates, handled gracefully
  this.fetchTimelinePageByFeedMaxId(userId, roughCursor, PREVIEW_PAGE_SIZE, ctx),
]);
```

The page 2 pre-fetch is speculative anyway (see the existing `try/catch` on line 814) — running it in parallel with page 1 costs nothing if it fails.

---

## 5. Include signed assets in succeeded status response

**Status:** Not started  
**Files:** `apps/figma-plugin/src/code.ts:839-880`, `apps/api/src/jobs/jobs.controller.ts`

### Problem

After the polling loop finds `status === 'succeeded'` (line 839), the plugin makes a second API request to get signed asset URLs:

```ts
// line 870 — extra round-trip
const sr = await fetch(`${base}/v1/jobs/${jobId}?include=signedAssets`, ...);
```

This is an unnecessary round-trip (~200–400ms) that every import pays.

### Fix

When the polling response has `status === 'succeeded'`, include `signedAssets` inline. The `JobsService.toResponse` already supports this via the `extras.signedAssets` parameter. Update the `GET /v1/jobs/:id` handler to auto-include signed assets when status is `succeeded`, removing the need for the `?include=signedAssets` separate call.

---

## 6. Admin scrape-health endpoint

**Status:** Not started  
**Files:** `apps/api/prisma/schema.prisma` (`ScrapeTelemetry` model), `apps/api/src/instagram/instagram-telemetry.service.ts`

### Problem

`ScrapeTelemetry` records `errorKind`, `statusCode`, `latencyMs`, `cacheHit`, `sessionAccount` on every IG request. All the data to answer "is Instagram blocking us?" exists in the DB, but nothing reads it.

When sessions start failing or rate limits spike, users report it before the operator knows.

### Fix

A minimal `GET /admin/scrape-health` endpoint (JWT-gated, admin-only) that returns:

```json
{
  "last1h": {
    "totalRequests": 120,
    "errorRate": 0.08,
    "cacheHitRate": 0.61,
    "p50LatencyMs": 1240,
    "p95LatencyMs": 4800,
    "byErrorKind": { "rate_limited": 5, "auth": 2, "network": 3 }
  },
  "sessionHealth": [
    { "account": "account1", "requests": 40, "errors": 1 },
    { "account": "account2", "requests": 38, "errors": 7 }
  ]
}
```

All of this is a single GROUP BY query on `scrape_telemetry`. No extra storage or infra.

---

## 7. Consolidate IG_HEADERS into shared-instagram

**Status:** Not started  
**Files:**
- `apps/api/src/instagram/instagram-preview.service.ts:29-43`
- `apps/worker/src/instagram/http-instagram-data-source.ts:19-31`

### Problem

`IG_HEADERS` (including `x-ig-app-id`, `User-Agent`, `Accept-Language`) is copy-pasted identically in both the API and the worker. When Instagram rotates their app ID or user-agent detection improves, both files must be updated in sync. They have already drifted slightly (the worker version is missing `IG_IMAGE_HEADERS`).

### Fix

Move `IG_HEADERS`, `IG_IMAGE_HEADERS`, and `buildHeaders(session?)` to `packages/shared-instagram/src/headers.ts` and export them. Both the API preview service and the worker data source import from there.

---

## Out of scope for now (future)

These were identified but require more design before implementing:

- **Team/workspace plans** — DB schema is individual-only; adding a `Workspace` model is a breaking migration.
- **Web account dashboard** — currently no web app; needs a separate frontend.
- **Preview paging as a queue job** — architectural change; current sync approach is acceptable if latency is fixed by items 3 and 4 above.
- **Job result re-use** — cache a succeeded job's assets if the same `{username, selectionParams}` is requested within a TTL. Requires a hash key on `Job` and a small lookup before enqueuing.
