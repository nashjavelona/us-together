# Current professional QA supplement — v4.1.2

**221/221 cases passed across 16 files in each timezone** (`TZ=Asia/Manila` and `TZ=America/Los_Angeles`). Current fixes and limitations: [PROFESSIONAL-QA-V4.1.2.md](PROFESSIONAL-QA-V4.1.2.md). The report below records earlier v4.1.0 results for historical context only.

---

# v4.1.0 — For You ♡ release verification (2026-10-19)

**211/211 automated test cases passed across 15 files**, using `npm test` in the static GitHub export. The 26 tests covering the new feature and connected UI separately passed under both `Asia/Manila` and `America/Los_Angeles`.

The new tests validate message and letter persistence, compatibility with the existing author-owned D1 notes schema, other-member write rejection, manual read status, reaction toggles, note limits, HTML escaping, concurrent note changes, cloud syncing, local profile-specific drafts, and service-worker precache version 7. No schema migration or backend API change is necessary for the new frontend feature. Existing tests for pairing, timers, task flows, and backup/restore continue to pass.

**Limitation:** The Playwright/Chromium real-browser navigation attempt was blocked with `net::ERR_BLOCKED_BY_ADMINISTRATOR` for both local and file origins. The UI tests simulate DOM events and do not certify live phone rendering or actual production-device synchronization. Neither GitHub nor the production backend was modified in this release. The active server rate limits remain unchanged.

**Compatibility:** Both partners should update the frontend, since older clients may display the encoded message/receipt records in the old love-note collection. Messages are not end-to-end encrypted. The recipient chooses when to mark a message read; there are no push alerts.


---

# v4.0.2 full audit - 2026-10-18

**201/201 previously passed across 14 files** in each of the default, Asia/Manila, and America/Los_Angeles timezone runs. This extends the earlier v4 and v4.0.1 reports below. Confirmed pairing/recovery, rejected-save, device-flow, and service-worker fixes are detailed in [AUDIT-AND-FIX-V4.0.2.md](AUDIT-AND-FIX-V4.0.2.md).

**Deployment distinction:** The GitHub Pages frontend and optional server source changes in this package have not been published in this audit. Live API and browser/device validation remain required after updating. The browser smoke attempt was blocked by workspace navigation policy.

---

# Us, Together — v4 shared-space verification

Review date: 2026-10-18. The previous local-only release report is preserved unchanged in [docs/AUDIT-V3.md](docs/AUDIT-V3.md).

## Current result

**All 185 automated cases passed across 14 files**, with no failures, cancellations, skips, or todo cases, using Node v24.19.0 and `npm test` on the final implementation. This includes the final backend duration-boundary regressions and frontend clock-argument changes.

The application now has a Sites D1 backend, per-device member identities, invitation/recovery flows, a durable sync queue, revision checks, and server timer accounting. Local-only use remains available.

This is a source, build-artifact, and automated-handler review. **No real browser or two physical devices were used.** UI tests use a small DOM/FormData/event stub. API and bridge tests call the real handlers against a local in-memory SQLite adapter implementing the D1 methods used by this application. Service-worker tests use a Node VM with controlled cache/fetch fixtures. These automated fixtures do not establish browser rendering, native forms, service-worker installation, or mobile offline reliability. The separate production protocol checks below exercised the actual deployed D1 API.

The final production build succeeded after the implementation freeze. Every public asset and each packaged migration file matched its source. The flattened GitHub export independently passed the same 185-case suite and its optional Worker bundled with Wrangler in dry-run mode. Production protocol checks also passed on the deployed API at 2026-10-18 09:13 UTC, using only a new isolated synthetic couple space. No existing user task data was accessed.

## Automated coverage

| Test file | Cases in final suite | Main evidence |
| --- | ---: | --- |
| `tests/backend.test.js` | 30 | Private pairing/retry safety, invitation races/expiry, token-derived identity, cross-space boundaries, recovery/revocation, exact revisions, idempotency, transition permissions, server accounting, recurrence, bounded snapshots, restore, malformed inputs, CORS, rate limits, subminute continuations and integer shared durations |
| `tests/cloud-sync.test.js` | 17 | Separate device connections, offline reload, durable pending edits, disjoint merge, delayed/lost responses, same-record conflicts, same-origin tab storage, handshake retry, server focus, recovery, clock samples, revoked status, restore retry/conflict |
| `tests/sync-model.test.js` | 10 | Record-ID merge, move/edit and delete/edit conflicts, protected server fields, causal pending-edit order, explicit resolution, envelope/private-field validation |
| `tests/ui-cloud.test.js` | 11 | Actual app/bridge/API handlers: role/view separation, partner guards, four editors during remote updates, stale-draft rejection, offline timer expiry, recurrence boundary, invitation escaping, fixed recovery/pairing endpoint |
| `tests/calendar.test.js` | 14 | Shared IANA day, civil arithmetic, Manila/non-hour offsets, DST gaps/folds, 23/25-hour days, recurrence, planning, personal/shared midnight splits |
| `tests/sw.test.js` | 12 | Root/project scopes, own-cache fallback/cleanup, unrelated cache preservation, asset allowlist, API/authenticated request bypass, no-store, cache-write failure |
| `tests/core.test.js` | 18 | Parsing, deadline/start semantics, planning capacity, appointments, active/paused allocations, shared reservations, recurrence, timestamp accounting |
| `tests/couple.test.js` | 23 | Ownership, requests/original-list return, acceptance dates, migration, validation, undo, check-ins, shared transfers, completion |
| `tests/audit.test.js` | 13 | Earlier regressions: malformed backups, preferred-time gaps, recurrence transfers/deadlines, rest, and 30 seeded scheduling scenarios |
| `tests/together.test.js` | 16 | Both calendars, personal/shared exclusion, breaks, extra-hours choice, duration boundaries, exact accounting |
| `tests/ui-model.test.js` | 11 | Next-action/display agreement, edit validation, preserved focus, rescheduling, paused backup copies, final seconds, checklist progress |
| `tests/ui-flows.test.js` | 1 | Simulated local capture → request → accept → focus/pause/resume → completion/undo → archive/undo → restore/expiry |
| `tests/ui-redesign.test.js` | 8 | Local profiles, five-minute confirmation, shared focus, check-ins, dialog errors, delete/undo, legacy help, stale editing |
| `tests/ui-smoke.test.js` | 1 | Simulated home, task list, wins, settings, task-menu rendering |
| **Final suite total** | **185** | **14 files; all 185 passed** |

The 14 calendar cases were also checked earlier under `TZ=UTC` and `TZ=America/Los_Angeles`. That targeted check does not mean the whole final suite has been rerun under every timezone.

### Reliable full-suite command

```sh
npm test
# Equivalent:
node scripts/test-all.mjs
```

The runner discovers every `tests/*.test.js` file and runs each in a separate Node process. It reads counts and failure details from Node's native TAP report, fails when a child errors or its report is missing/incomplete, prints per-file/aggregate results, and removes its temporary reports. This keeps tests that stub browser globals isolated.

In this managed environment, nested subprocess pipe capture returned empty output and an `EPERM` error in a minimal probe. Ordinary `node --test tests/*.test.js` consequently exposed one result per child file instead of individual case events. Direct execution such as `node tests/ui-cloud.test.js` showed the cases. The new runner uses inherited stdio plus TAP files so its total comes from executed cases. This is an environment reporting limitation, not evidence that the previous command skipped execution.

## Concrete v4 defects prevented or corrected

| Risk or defect | Implemented behavior and evidence |
| --- | --- |
| Viewing the partner's side could change acting identity | Connected mode derives `active` from the device connection. Profile/mobile controls change only the view. Handler tests cover both member roles. |
| Every envelope reset the mobile side | The connection callback initializes the side only when space/device/member identity changes. A poll or save preserves the selected view. |
| Editors retained detached objects after remote state replacement | Task, appointment, routine, and note submits re-resolve records. Unrelated changes survive; changes to the edited record reject its stale draft. |
| A late acknowledgment could erase newer edits | Only the immutable pending operations captured by that request are acknowledged. Newer operations remain durable and rebase. Lost responses retry the same operation identity. |
| Concurrent edits could silently replace partner changes | The server requires an exact revision and validates the before/after transition against the authenticated member. The bridge merges disjoint records and retains conflicting versions for an explicit choice. |
| A zero-row revision update could create phantom history | Dependent batch writes require the successful update's unique write identifier. Concurrent mutation tests check revisions and snapshots. |
| Recreating a deleted partner task with zero claimed time could adopt its accounting | New IDs are history-checked regardless of claimed `spent`. Restored ownership/time require verified server history; IDs tied to retained sessions without verified ownership are rejected. |
| Client timers could invent or double-count focused time | Connected focus uses dedicated online server commands. Ordinary state edits cannot dictate timer/session accounting. The server caps earned time and settles concurrent expiry once. Offline browser ticks leave the cached timer unsettled. |
| The API could allocate five minutes when the UI offered a one-minute continuation | Positive remaining estimates below one minute now yield a one-minute personal/shared continuation; completed estimates retain the separate five-minute continuation behavior. Shared duration input requires integer minutes. Three final backend regressions cover these boundaries. |
| Cached state could rewind the displayed clock | Received clock samples remain attached to cached state. Optimistic callbacks and offline startup reuse the offset instead of treating old `serverNow` as fresh. |
| Local editing could conceal revocation | Revoked status remains through editing, flush, and reload; pending local data remains durable. |
| Different phones could disagree about the shared day | Connected calendar operations use the workspace IANA zone. The server resolves a zone per request; browser calendar configuration resets for local mode. |
| A broad GET cache could retain API responses | Only enumerated same-origin app assets are intercepted. API paths and Authorization-bearing requests bypass the service worker; response `no-store` is respected. Offline fallback reads only the current scoped cache. |
| Invite/recovery input could select an attacker API | The endpoint is fixed in `cloud-config.js`. Parsing extracts only the needed fields, escapes invitation text, removes its URL fragment, and ignores supplied endpoint/device-token fields. |

## Build and deployment artifact review

| Item inspected | Result at the review checkpoint |
| --- | --- |
| Source and built hosting metadata | Both identify the existing project and D1 binding `DB`; no R2 binding is requested. |
| `dist/.openai/drizzle/` | Includes SQL migration and metadata. All three files matched their source copies byte-for-byte. |
| `dist/server/wrangler.json` | Worker entry is `index.js`; D1 binding is `DB`; asset directory is `../client`. Its generated local placeholder database ID does not establish live provisioning. |
| `build/sites-worker.ts` and compiled entry | `/api` and `/api/*` enter the custom API handler before the framework. GET/HEAD `/` and `/index.html` have an explicit app-shell response. Other routes fall through to the framework. |
| Static assets vs API | No public `api` directory exists. The Worker enforces device authorization inside the app; these routes do not require conventional ChatGPT sign-in. |
| `public/` vs `dist/client/` | Every public asset matches the final production build. The two stale files found during the first checkpoint were resolved by rebuilding after source freeze. |
| App content policy | HTML meta policy permits own scripts, the fixed Sites API, and Google Fonts. Fonts have CSS fallbacks. Runtime JavaScript needs no external CDN. |
| Service worker | Precache URLs resolve from its registration scope and include the frontend modules. Cache names include the full scope URL. Generic v1–v6 caches are removed only when shell entries identify this scope. Unrelated caches are preserved. |
| GitHub Pages paths | Assets, imports, manifest start/scope, icons, worker registration, and source ZIP link are relative. Flatten `public/` contents into the Pages branch root for origin-root or `/us-together/` project hosting. |
| GitHub API assumption | The static frontend keeps using the Sites API; Pages does not run `server/` or D1. Allowed origins include the Site and `https://nashjavelona.github.io`. Another Pages owner/custom domain requires an explicit backend origin change. |
| Final archives/export | ZIP integrity checked; frontend/server import paths adjusted for Pages; all 185 cases also pass from the flattened export. Complete source download includes the framework build and migration. |

## Release checks and remaining device checks

| Check | Status |
| --- | --- |
| Final 185-case frozen-source suite | Passed 185/185 on the final implementation |
| Fresh production build after source freeze | Passed; public assets and migrations matched their source copies |
| Final source/archive equality and extraction | ZIP integrity passed; 185/185 cases passed from the Pages export |
| Hosted `/api/health` after migration/provisioning | Passed on live D1; API responses were no-store |
| Hosted create → invite → join → read/update | Passed with two distinct member identities, stored task/note updates, exact replay, stale revisions and a simultaneous write race |
| Hosted recovery and own-device revocation | Passed; a recovered member device revoked its old device and the old token then received HTTP 401 |
| Two real phones, simultaneous editing, reconnect | Not run; no browser/device automation available |
| Real layout, touch, keyboard, screen reader, native forms | Not run |
| Real install/update/offline cache migration/browser restart | Not run |

## Production protocol verification

The live check ran against https://momentum-my-second-brain.void-mag-inv-5623.chatgpt.site on 2026-10-18 at 09:13 UTC. The application implementation at source commit `5e27ea3d8a43471bc90cb4c7896d6f66f20ca62b` passed all of the following:

- Updated dashboard shell, D1 health, API no-store headers and the configured GitHub origin’s preflight.
- Anonymous state access returned 401; an unapproved browser origin returned 403.
- A new private space, single-use invitation, and second member with a distinct identity.
- Task and note writes visible to the other member, stale-revision rejection, and identical-operation replay without a second write.
- Concurrent same-revision writes produced one accepted update and one conflict.
- Server-controlled shared focus start/pause and a replay that did not duplicate accounting.
- Snapshot listing, preview and restore through the deployed database.
- Member recovery onto another device and revocation of the old device; its token was denied afterward.

Only generated test data was used. These were HTTP/API checks, not a browser or two real phones. The application code was not changed after these checks; the final publication refreshes the verification documentation and downloadable source archive.

## Practical boundaries

Both members can read the couple workspace. Personal ownership restricts editing, not visibility. Device and recovery capabilities grant the corresponding member's access. Browser credentials remain accessible to JavaScript on their origin and to someone controlling that browser. Ordinary task backups exclude credentials; the separate recovery file intentionally carries member access.

Task edits can remain queued locally while offline. Connected focus commands require a live service response and are not queued for later playback. Simulated polling/retry tests do not replace mobile background/resume testing.

Automatic history retains the latest 50 snapshots as changes are saved. Restore explicitly replaces the shared state for both members and preserves device connections. This is application recovery, not independent infrastructure disaster recovery or end-to-end encryption.

Local-only mode remains browser-local and follows the local calendar. Connecting and creating a space explicitly brings its tasks into shared storage. Joining an existing space preserves a separate local safety backup instead of mixing the workspaces.

The app does not send push notifications or messages to a partner. Sound requires an open browser and browser audio permission. Overnight workday settings are not implemented. Prior visual/accessibility source checks remain historical evidence in the v3 report; complete browser accessibility and responsive-layout validation are outstanding.


## v4.0.1 follow-up: interrupted pairing / recovery

Confirmed and fixed a pending handshake blocking later recovery when the device name changes or a rejected invitation stays persisted. New frontend allows an idempotent retry, probes a previously registered device, discards only conclusively rejected attempts, and exposes a safe resolution control. Original workflows and six additional regression checks passed: **191/191 automated cases**. Checks run in the local Node.js test fixture, not a real mobile browser or production database. Backend and schema unchanged.
