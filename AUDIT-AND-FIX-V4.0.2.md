# Us, Together - full connection and sync audit (v4.0.2)

**Status:** Source fixes complete. **201/201 automated checks passed** (14 files), with additional complete passes under both `TZ=Asia/Manila` and `TZ=America/Los_Angeles`. No current user database or connected device was changed by this audit. The production API and live GitHub Pages repository **have not been deployed/modified** by preparing these files.

## Confirmed issues and fixes

| Severity | Finding | Fix | Applies where |
|---|---|---|---|
| High | An unconnected browser could keep automatically retrying an ambiguous pairing POST until the server's hourly pairing limit was reached. | Suppress background polling for pending pairing. Permit explicit retry, one resume at startup and reconnect; probe for an already connected device before repeating a POST. | Frontend `cloud-sync.js` |
| High | A permanently rejected task update (e.g. 403) could stay at the front of a durable queue and be retransmitted forever, preventing newer independent edits from syncing. | Mark definitively rejected state saves as blocked and persistent, display the server reason, offer task-backup export and explicit rejection discard, retain subsequent queued operations. Retry only transient/ambiguous errors. | Frontend `cloud-sync.js`, `cloud-ui.js` |
| Medium | An invalid initial recovery key could make the UI report the browser as **revoked** even though no device had ever connected. | Report unauthorized recovery as a connection error; reserve revoked status for an authenticated device. | Frontend `cloud-sync.js` |
| Medium | The recovery form kept previously pasted credential text after selecting a malformed recovery file. | Clear stale text and file selection upon parse failure; show a descriptive error. | Frontend `cloud-ui.js` |
| Medium | Joining as the second person was easily confused with reconnecting the same person on a second device. | Identify **Join** as partner-only and **Reconnect** as the same-person pathway throughout the UI. | Frontend `cloud-ui.js` |
| Medium | Disconnect wording could suggest local unsent changes would automatically rejoin the shared database later. | Clearly explain that reconnecting does not automatically merge the unsent changes; advise a task backup first. | Frontend `cloud-ui.js` |
| Low | A stale service-worker app shell could keep old connection JavaScript after GitHub deployment. | Bump scope-isolated static cache from v5 to v6, preserving other GitHub Pages projects' caches. | Frontend `sw.js` |
| Server improvement | A valid, already-registered provisional device token could be prevented from replaying the same successful pairing by the hourly IP rate limit. | Allow existing authenticated device-token replay **before** new pairing rate limiting. This does not waive rate limits for first-time attempts. | **Backend `server/api.js` only. Requires a separate backend deployment.** |

This release also includes the cumulative v4.0.1 fixes for pending-handshake identity reuse, safe GET `/state` probing after a lost response, explicit retry/reset controls, and safeguarding local tasks while resolving attempts.

## How to update the already-published GitHub Pages site

**Recommended:** Download `Us-Together-Frontend-Fixes-v4.0.2.zip`, extract it, and upload only these **four files** to the **root** of `https://github.com/nashjavelona/us-together` using **Add file -> Upload files**: `cloud-sync.js`, `cloud-ui.js`, `style.css`, `sw.js`. These are cumulative: **do not upload v4.0.1 first.** Replace same-named files and commit to the `main` branch, then check GitHub **Actions** until Pages is deployed. Hard-refresh `https://nashjavelona.github.io/us-together/` with Ctrl+Shift+R. Do not upload the ZIP itself in place of the four files.

The optional `Us-Together-GitHub-v4.0.2-Audited.zip` is a complete source + static Pages package for a fresh repository/re-upload. It includes the backend patch as **source only**. **Uploading it to GitHub Pages does not update the currently running API or D1 database.** The existing `https://momentum-my-second-brain.void-mag-inv-5623.chatgpt.site/api` remains the shared database URL.

## Safe reconnect after updating

1. On any device already connected, download **both** a task backup and your **personal recovery file**. Store both outside public repositories. The recovery file is not a partner invitation.
2. Open **Connect us** on the second device. If an unfinished attempt appears, choose **Resolve earlier attempt -> Check & resolve** to probe the server; use Retry only for the same pending attempt.
3. To use the **same profile on your laptop and phone**, choose **Reconnect my device**, select your own private recovery JSON, and use a device name. Choose **Join** only when pairing your partner as the other role.
4. Do not repeatedly submit while the server reports **Too many pairing attempts**. Wait for the hourly rate-limit window; clearing browser data won't shorten it.
5. Check the connection banner reports online/saved; make one harmless test task on each device and verify the other device receives it. Deleting the test tasks should then sync.
6. In a conflict, export a task backup before deciding which version to keep. A task backup restores data; a recovery file proves member identity.

## Evidence and limitations

- **201/201 passing tests**, three timezone runs total (default, Asia/Manila, America/Los_Angeles); backend handler, pairing, recovery, syncing, conflict, focus accounting, snapshot operations, UI-simulated flows, service-worker isolation, scheduling and export safety.
- Code syntax verified for `cloud-sync.js`, `cloud-ui.js`, and `server/api.js`.
- Static export and source archive integrity must be checked as part of final packaging.
- Browser automation was attempted with a local HTTP server and Chromium, but the browser's navigation was blocked by this workspace's administrator (`net::ERR_BLOCKED_BY_ADMINISTRATOR`). No actual rendered mobile or desktop test, real two-device run, or production end-to-end check was possible during this audit. Re-test the GitHub address on both devices after publishing.
- **No production server, database migration, or live GitHub commit performed in this audit.** The standalone server improvement needs a separate approved deployment and may be unavailable without access to the Site's managed backend.
- The recovery key previously posted in this chat is sensitive and has not been included in any generated files. The present API does not rotate it; securely export tasks and establish fresh credentials if it could have been accessed by someone else. Do not post credentials in chat/screenshots/repositories.

## Included source files

`public/cloud-sync.js` handles pending pairing, optimistic queue and rejected edits; `public/cloud-ui.js` shows pairing, recovery, failed-save and disconnect controls; `public/sw.js` governs offline app-shell caching; `server/api.js` contains the optional paired-token idempotent replay improvement. Tests were added to `tests/cloud-sync.test.js`, `tests/ui-cloud.test.js`, `tests/backend.test.js` and adjusted in `tests/sw.test.js`.
