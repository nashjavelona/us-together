# Us, Together v4.1.2 — Professional QA and Remediation Report

## Overall result

**221 of 221 automated test cases passed across 16 test files** with `TZ=Asia/Manila` and `TZ=America/Los_Angeles`. JavaScript source checks, deployment asset checks and the ZIP file integrity test also passed. This is **not** equivalent to a completed interactive real-browser, accessibility, or two-real-device acceptance test; the Chromium session was blocked in the test environment. The deployed production backend and the live GitHub Pages origin were not modified or independently verified during this audit.

This GitHub package is a complete static Pages replacement with backend source, tests and migrations included for development. **GitHub Pages does not deploy the backend**; existing Cloudflare API behavior and its rate limits remain separate.

## Confirmed defects corrected

| ID | Severity | Reproduced problem | Corrected behavior | Evidence |
| --- | --- | --- | --- | --- |
| QA-01 | Medium | Settings linked to `./Us-Together-Source.zip`, a file absent from the GitHub replacement. The download button would 404. | Replaced with an explicit GitHub repository source download link (opens in a new tab). | `tests/professional-regression.test.js` |
| QA-02 | Medium | Deleting a partner message left recipient-owned read/reaction metadata records orphaned. Repeated cycles accumulated invisible notes and could exhaust the 1,000-note collection capacity. | Reclaim only metadata authored by the current person, deduplicate valid receipts and reactions, and clean on inbox entry or next send; no attempts to modify partner-owned server records. | `tests/for-you.test.js` and backend permission fixture |
| QA-03 | Medium | An unsent message draft disappeared on refresh, potentially losing text, and drafts could be mixed after profile switches. | Store drafts locally, scoped by shared space and member role; preserve across refresh and keep profiles separate. Draft storage is best-effort if storage is full. | `tests/professional-regression.test.js` and `tests/ui-cloud.test.js` |
| QA-04 | Medium | If an interrupted first-time pairing request could not be verified because the server was offline, the safe resolution workflow intentionally refused to clear it—leaving no escape for a permanently stuck unconnected browser. | Added an **optional advanced manual reset behind an explicit warning**. It removes only this browser's unfinished request; it does not clear tasks, connected credentials or outbox. It does not bypass backend rate limits, and the warning explains access-loss risk if the server did create a space. | `tests/cloud-sync.test.js` and `tests/ui-cloud.test.js` |
| QA-05 | Low | An old offline service worker may keep displaying previous version assets after uploading new files. | Incremented scope-specific cache to `v9`; source includes a visible `4.1.2-professional-qa` build marker for verification. | `tests/sw.test.js` |

## Tested workflows

- Task capture, scheduling, deadlines, routines, editing, completion, deletion and undo.
- Charcoal/pink ownership, partner assignment requests, permission enforcement and shared actions.
- Local and shared focus timers; calendar, timezone and cross-device state merging.
- Invitation vs. same-person recovery, interrupted pairing, duplicate request reconciliation, rate-limit error handling, explicit reset safety, device authorization/revocation and saved queues.
- For You messages, letters, read receipts, reactions, HTML escaping, old love-note compatibility, deletion, orphan cleanup, capacity behavior and draft persistence.
- Backup/restore, snapshots, concurrent updates, conflict review, server-side API authorization in in-memory D1/SQLite fixtures, and service-worker cache isolation.
- Stress case: 180 rounds of message/send/read/react/delete, confirming no hidden receipt accumulation.

## Important remaining limits

1. **Real phone/browser verification is pending.** The automated frontend interactions use a DOM/event test fixture. Chromium navigation was blocked in this environment, so CSS rendering, responsive touch input, PWA install behavior, and two physical devices have not been signed off.
2. **Production server was not changed.** An active server-side pairing limit still requires waiting for the rate-limit window to expire. The backend source code in GitHub does not automatically deploy to Cloudflare.
3. **Previously saved browser state survives a GitHub replacement.** An unfinished connection may require the safe Check & resolve action. The advanced forget action is intentionally not automatic; using it without a recovery file can lose access to an earlier-created space.
4. **Existing exposed recovery credentials should be treated as compromised.** Do not upload recovery JSON, API tokens or personal task backups to GitHub. Backups and new pairing credentials must be managed separately.
5. **No push notifications or end-to-end encryption.** Messages sync through the shared backend while app connectivity is available.

## Release verification

- Frontend identity/build: `index.html` meta `us-together-build=4.1.2-professional-qa`.
- Service worker cache: `us-together:<scope>:v9`.
- Static site entry: `index.html` at ZIP/repository root, `.nojekyll` at root.
- Tests: `npm test` run in both timezones. Test environment used Node 22's built-in SQLite experimental support; package declares Node 24+ for normal development tooling.
- Do not upload an outer folder or ZIP as your site entry. Upload all ZIP contents to the root of `nashjavelona/us-together` in a **single commit**, then verify Pages deployment and load the new build marker.
