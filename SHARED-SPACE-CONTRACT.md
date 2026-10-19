# Us, Together v4 shared-space contract

Implementation contract. Preserve the existing state/version 2 format and local-only mode. Hosted frontend source is `public/`; the same files are exported to GitHub. Backend uses the supported Sites Vinext starter, Cloudflare D1 binding `DB`, and API prefix `/api/`. No conventional sign-in. No secrets in source or state backups.

## HTTP API (JSON; all responses no-store)

All authenticated requests use `Authorization: Bearer <deviceToken>`; actor/space are derived ONLY from that token. Error JSON is `{error:string,code:string}` and may include `current` on conflict. Successful space envelopes are `{state,revision,spaceId,role,zone,partnerJoined,serverNow,deviceId}`. `state.active` is always 0 on the wire and overridden with the authenticated role in the UI. Plans are `{}` on the wire.

- `GET /api/health`: public operational check, no data/secrets.
- `POST /api/spaces`: `{state,role,zone,deviceToken,recoveryKey,deviceName}`. Client generates 32-byte base64url token and separate recovery key before sending; server hashes them. Creation retry with the same token returns its original space. State import is explicit and validates/pauses timers. Reply envelope. Recovery key belongs only to that member.
- `POST /api/join`: `{invite,deviceToken,recoveryKey,deviceName}`. Single-use high-entropy invite claims only the empty other slot; retry with same device token is idempotent. Reply envelope.
- `POST /api/recover`: `{spaceId,role,recoveryKey,deviceToken,deviceName}`. Proves the role-specific recovery capability and registers an additional device (bounded count). Reply envelope. Does not silently revoke existing devices.
- `GET /api/state`: envelope. Settle expired timers once with server time, safely persisted before returning.
- `PUT /api/state`: `{state,revision,mutationId}`. Exact-revision CAS, member transition authorization, protected server accounting, snapshot and operation deduplication atomically. `409 {code:'conflict',current:<envelope>}` on mismatch. `403` forbidden action. Reply envelope.
- `POST /api/focus`: `{revision,mutationId,action,owner,taskId,minutes,allowOutsideHours,allowEarly}`. Actions `start`, `pause`, `resume`, `end`, `skip-break`; owner 0/1 only for that actor or 2 for shared focus. Require connectivity, do not queue timer commands offline. Server owns timestamps, elapsed time, sessions, breaks, and mutual exclusion. Reply envelope.
- `POST /api/invite`: authenticated; creates a new 24-hour invitation for the empty partner slot, invalidating prior unused invite. Reply `{invite,expiresAt}`. Secret is presented by UI in a fragment link or manual code, never sent as a query parameter.
- `GET /api/history`: authenticated; `{snapshots:[{id,revision,createdAt,reason,taskCount}]}` newest first. Retain at most 50 automatic snapshots per space.
- `GET /api/history/:id`: authenticated within same space; `{snapshot:{id,revision,createdAt,state}}` (paused snapshot).
- `POST /api/restore`: `{revision,mutationId,snapshotId}` OR `{revision,mutationId,state}`. Explicit whole-space replacement. Preserve current snapshot, create NEW revision, pause imported timers, preserve membership/credentials, validate and enforce limits. Reply envelope.
- `GET /api/devices`: authenticated member's own devices only; `{devices:[{id,name,createdAt,lastSeen,current}]}`.
- `DELETE /api/devices/:id`: can revoke only own member devices; `{ok:true}`.

Exact allowed CORS origins: current Site origin `https://momentum-my-second-brain.void-mag-inv-5623.chatgpt.site`, `https://nashjavelona.github.io`, and loopback localhost/127.0.0.1 for local development only (no arbitrary origin reflection). GET/POST/PUT/DELETE/OPTIONS. Never credentialed wildcard CORS. No cookies required by this cross-origin static frontend. Body limits <=1 MiB. Bounded arrays/text and rejection of prototype keys. Public create/join/recover endpoints rate-limited; do not log secrets or state.

## State and authorization

All existing task statuses, routines, appointments, notes, check-ins and settings persist. Task/record IDs remain stable. Shared JSON excludes credentials and device view state.

- Personal task ordinary edits/complete/delete/checklist are owner-only; shared tasks are editable by either member.
- Creating a task on the other person's list requires a pending request from the authenticated actor. Requests' recipient alone accepts/reschedules; sender/recipient may cancel/decline back to the recorded original list. Request provenance cannot be forged.
- Help offers on the partner's open help-requested task may change helper only to actor/null. Taking over is allowed only when that task asks for help; preserve identity and elapsed time.
- Personal settings/routines/appointments only by that actor. Common names/tagline/initials/shared settings may be edited by either member. Restrict check-ins and note mutations to their author.
- `people[].timer`, `.sessions`, `.restUntil`, task `.spent`, and `togetherTimer`/`togetherSessions` are protected. Ordinary PUT must restore these from server state and server-settle active task status/move/delete changes. A client cannot invent elapsed time. New ordinary tasks start spent=0. Completion timestamps come from server time.
- Plans are derived UI-only. Do not generate the partner's routines client-side in connected mode. Backend may generate both people's due occurrences deterministically on reads in the space's IANA zone, or client generates only their own routine and server validates it against the template. No missed-day backlog fabrication.
- Server timer code must use explicit workspace IANA zone, never Worker-local `Date` assumptions. Store UTC timestamps and split recorded session days in that zone. Existing `validCouple` is necessary but not an authorization boundary.

## Client bridge and merge contract

`public/cloud-sync.js` exports `createCloudSync({getState,onState,onStatus,storage?,fetcher?,apiBase?,onConnection?})`.

Bridge object:

- `connection` getter: null or `{spaceId,role,zone,deviceId,...}`; token must not be exposed in UI text/exports.
- `status` getter: `{kind,message,pending,conflicts?}`; kinds `local`, `connecting`, `syncing`, `saved`, `offline`, `conflict`, `error`, `revoked`.
- `start()` initializes stored connection/outbox and poll; `stop()` cleanup.
- `save(state)` queues a local change synchronously, persists outbox before network, returns success boolean. App retains its current local persistence too.
- `flush()` and `pull()` async; one request/mutation at a time. Never overwrite newer edits with older replies. Poll every ~5 seconds while visible; backoff on network failure. Use same mutationId for ambiguous retries; CAS server validates revision. Same-origin tabs coordinate where navigator.locks exists and respect connection/outbox storage changes.
- `create({state,role,zone,deviceName})`, `join({invite,deviceName})`, `recover({spaceId,role,recoveryKey,deviceName})` async. Client crypto generates/stores in-progress device/recovery secrets before network so response loss can retry safely. Resolve to `{...envelope,recoveryKey?}`. `onState` is called with role injected. Connection secrets live in a separate localStorage key, never ordinary state/backups.
- `focus(args)` flushes ordinary changes, then authenticated POST /focus; no offline timer queue. Refreshes UI from reply.
- `invite()`, `history()`, `snapshot(id)`, `restore({snapshotId}|{state})`, `devices()`, `revoke(id)` wrap APIs and validate results.
- `resolveConflicts('remote'|'local')`: explicit review choice only, never silent same-record overwrite. Preserve local version until choice/export.
- `disconnect()` removes local connection/outbox after caller confirms pending changes; keeps ordinary local task data. Never automatically deletes server data.
- `recoveryDetails()` returns own locally saved recovery key + space/role for an explicit recovery-file download; no partner secret.

`onState(state,envelope)` must keep app DOM drafts/modal content intact where appropriate. Queue stores immutable accepted base and latest desired snapshot. Three-way merge uses stable global task IDs INCLUDING owner, keyed notes/routines/appointments and appropriate settings fields; independent additions/edits merge, same-record changes surface conflicts (delete/edit too). Protected timer/session fields always use remote authority and do not form editable conflicts. `active` and `plans` never sync as device preferences. Store every pending change until accepted/explicitly discarded.

## UI integration (root-owned)

Connected mode locks acting identity to connection.role; mobile tabs only choose visible side. Partner personal tasks show view/help controls, not invalid edit/focus actions. Timers use dedicated API; local tick only projects countdown and requests fresh server state at expiry. Local-only mode keeps current behavior. Share/create/join/recovery/history/device controls appear in Settings and a clear first-use banner. Export task backups never exports credentials. Recovery file is an explicit separate download. Creating/joining retains/downloads existing local backup; joining never silently merges/overwrites unreviewed local tasks. Explicit restore affects both people and pauses timers.

Service worker caches ONLY app assets, never `/api/` or authenticated requests. Purge legacy app caches on first v4 activation without affecting other project scopes.

## Ownership

Backend agent: `server/`, `db/schema.ts`, backend test files. Do not change app.js, schema migrations (root generates after schema ready), manifests or package inputs during install.
Sync agent: `public/cloud-sync.js`, `public/sync-model.js` if useful, dedicated sync tests. Do not modify app.js/CSS/package.
Root: project setup/build/deploy, app.js/HTML/CSS/service worker, UI tests, documentation and GitHub export.
Reviewer: independent adversarial checks and bounded test additions after implementation arrives.
