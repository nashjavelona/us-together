# v4.1 compatibility note

The **For You ♡** feature is implemented entirely in the existing `notes` collection, using versioned text markers and author-owned read/reaction notes. No additional schema, route, credentials or backend deployment are needed for this frontend feature. See [`FOR-YOU-V4.1.md`](FOR-YOU-V4.1.md).

---

# Us, Together: backend handoff

The current shared-space API runs with the Site-managed Worker and D1 binding. GitHub Pages serves the static frontend and calls that API. The optional standalone Worker below lets a developer operate the same API in a Cloudflare account they control; it does not change the live deployment.

## Source and ownership

- [`server/api.js`](server/api.js) exports `async handleApi(request, env) → Response`. It needs `env.DB`, a Cloudflare D1 binding. Production time comes from `Date.now()`; the fixture alone supplies `env.NOW`.
- [`server/state.js`](server/state.js), [`transitions.js`](server/transitions.js), [`focus.js`](server/focus.js), and [`time.js`](server/time.js) implement validation, authorization, accounting, and per-request IANA calendar calculations.
- [`db/schema.ts`](db/schema.ts) describes the schema; [`drizzle/`](drizzle/) contains versioned SQL migrations. The API uses prepared D1 statements directly.
- The older optional `build/sites-worker.ts` belonged to a separately delivered managed-Site source archive, which is not part of this current GitHub package. [`server/worker.js`](server/worker.js) is an optional API-only entry, with [`wrangler.backend.example.jsonc`](wrangler.backend.example.jsonc) as its deployment example.
- [`SHARED-SPACE-CONTRACT.md`](SHARED-SPACE-CONTRACT.md) is the detailed frontend/backend contract. Backend changes must preserve the bridge in `cloud-sync.js` and the existing version 2 state shape.

The account operating a standalone Worker owns its D1 database, billing, availability, migration process, provider backups, and access controls. Publishing the static frontend on GitHub does not transfer the managed Site database or existing member connections.

## Identity and pairing

There is no email/password login. A device generates a random 32-byte base64url capability and sends it as `Authorization: Bearer <deviceToken>`. The server hashes it, looks up the device, and derives both the space and acting role from that record. Role 0 is the black side; role 1 is the pink side. Neither `state.active` nor a request's task owner can change the authenticated role.

Each member also has a separate recovery capability. Invitations expire after 24 hours, are consumed atomically once, and only fill the empty partner slot. A new invitation invalidates older unused invitations. Creation/join retries use the same client-generated device capability, so losing a response does not create an extra membership. Recovery proves access to one member and adds a device, with a limit of ten active devices per member. A member can revoke their own devices.

Device tokens, recovery keys, and invitation secrets are stored as SHA-256 hashes with distinct prefixes; recovery hashes also include the space and role. Plaintext capabilities are not stored in database state or task backups. A device token or recovery file grants access, so keep recovery details private and separate from a shared task export. Losing every authorized device and the member's recovery key leaves no self-service way to recover that role. The API has no email reset or recovery-key rotation endpoint.

Both members can read the shared space and its history. Personal editing permissions control who can change records; the database operator can read stored task content. This implementation does not provide end-to-end encryption.

## Database tables

| Table | Purpose |
| --- | --- |
| `couple_spaces` | Current state JSON, revision, IANA zone, atomic write marker, timestamps. |
| `couple_members` | Two possible member slots per space and role-specific recovery hashes. |
| `couple_devices` | Device identity, member ownership, token hash, name, last seen and revocation time. |
| `couple_invites` | Invitation hash, target role, expiration, consumption and revocation records. |
| `couple_operations` | Device-scoped mutation IDs, payload hashes, and accepted revision receipts for replay protection. |
| `couple_snapshots` | Previous state versions, reason, revision, task count and creation time. |
| `couple_rate_limits` | Hashed IP/route hourly counters for public create, join and recovery attempts. |

State writes use an exact-revision compare-and-swap. The state change, prior snapshot and operation receipt run in one D1 batch. Dependent inserts are gated by the successful write marker: an unsuccessful compare-and-swap cannot create a phantom snapshot. Replaying an accepted operation returns the current envelope without applying it again. Reusing its ID for different content is rejected.

## API routes

All successful state envelopes contain `state`, `revision`, `spaceId`, `role`, `zone`, `partnerJoined`, numeric `serverNow`, and `deviceId`. Wire state uses `active: 0` and empty derived `plans`; the frontend injects its authenticated role. Errors contain `error` and `code`. A revision conflict returns HTTP 409 with `code: "conflict"` and the current envelope.

| Method and route | Purpose |
| --- | --- |
| `GET /api/health` | Public database availability check. |
| `POST /api/spaces` | Import an explicit initial state and create the first member/device. |
| `POST /api/join` | Consume an invitation and create the partner membership. |
| `POST /api/recover` | Add a device with the member's recovery details. |
| `GET /api/state` | Read authoritative state; settle expired timers and generate today's due routines for both members. |
| `PUT /api/state` | Authorized ordinary changes with `revision` and `mutationId`. |
| `POST /api/focus` | Start, pause, resume, end, or skip a break through server time. |
| `POST /api/invite` | Issue a fresh invitation for the empty member slot. |
| `GET /api/history` | List the latest retained snapshots. |
| `GET /api/history/:id` | Read a paused snapshot belonging to this space. |
| `POST /api/restore` | Explicitly restore a snapshot or imported state as a new revision. |
| `GET /api/devices` | List the authenticated member's active devices. |
| `DELETE /api/devices/:id` | Revoke an active device owned by that member. |

Except for health/create/join/recover, routes require the bearer device capability. Exact payloads are in the shared-space contract. Ordinary PUT cannot fabricate focus time: timer, session, rest and earned-time fields remain server-controlled. Moving, deleting or completing an active task settles the original allocation once. Explicit import/restore pauses running timers and preserves membership; restoring history affects both members.

## Retention and limits

The API retains **50 snapshots per space**, including versions taken before ordinary edits, focus changes, restores and automatic settlements/generation. Older snapshots are pruned. Snapshots contain paused timers and are a bounded undo history, so maintain periodic task exports or provider-level backups for longer retention. Restoring creates a new revision instead of rewriting an old revision.

The request limit is **1 MiB**. Serialized saved state is limited to **950,000 UTF-8 bytes**. A space can contain **2,000 total task records**, including completed and archived tasks; archiving does not reduce this count. Export a backup and remove old records when reducing the total. Each member supports 200 routine templates and 1,000 appointments. Notes are limited to 1,000; each personal/shared session list to 12,000 entries. Titles, notes, checklists and generated-date arrays have additional bounds in `server/state.js`.

Normal delete Undo restores earned time only from verified retained server history. An older identity with recorded sessions but no verifiable task snapshot must be restored through an explicit backup instead of being recreated with invented ownership.

## Migrations and a separately owned deployment

The Pages export pins **Wrangler 4.92.0** in `package.json`; install the pinned tooling, then use `npx --no-install wrangler`. The optional standalone configuration has not been deployed or verified against an independent Cloudflare account. It is a handoff example, and the live backend remains Site-managed.

1. Install dependencies with `npm install`. Copy `wrangler.backend.example.jsonc` to `wrangler.backend.jsonc`. Choose a Worker/database name and authenticate Wrangler to the account you own.
2. For a genuinely new database, create D1 once using `npx --no-install wrangler d1 create us-together --config wrangler.backend.jsonc`, then replace the example's all-zero database ID with the returned ID. For an existing database, use its actual ID and migration history.
3. Apply migrations to a local database and run the API locally:

   ```sh
   npx --no-install wrangler d1 migrations apply DB --local --config wrangler.backend.jsonc
   npx --no-install wrangler dev --local --ip 127.0.0.1 --config wrangler.backend.jsonc
   ```

4. After reviewing the migration SQL and backing up an existing remote database, apply outstanding migrations and deploy with the same explicit configuration:

   ```sh
   npx --no-install wrangler d1 migrations apply DB --remote --config wrangler.backend.jsonc
   npx --no-install wrangler deploy --config wrangler.backend.jsonc
   ```

**Never reinitialize an existing database.** Do not delete/recreate its tables, rerun the first migration manually, or point production at an empty D1 database to perform an upgrade. Preserve migration records and apply only unapplied files. Generate future schema changes with `npm run db:generate`, review the SQL, then apply those migrations through the deployment owner. If a database was initialized outside the migration runner, reconcile its migration baseline first; do not try to fix duplicate-table errors by dropping data.

When switching the static frontend to a separately owned backend, change `API_BASE` in `cloud-config.js` and the CSP `connect-src` in `index.html`, then publish the updated frontend assets. Keep `/api` in the base URL. Existing connections and recovery details still refer to their original space/database; a fresh database requires an explicit state import and new pairing unless the operator deliberately migrates the original database and capabilities.

### Origins and secrets

CORS lives in `server/api.js`. Its production allowlist is exactly:

- `https://momentum-my-second-brain.void-mag-inv-5623.chatgpt.site`
- `https://nashjavelona.github.io`

For another frontend host, add that exact origin before deploying. Localhost/127.0.0.1 origins work only with a locally served API or explicit development mode. Keep production mode enabled on a public Worker. The API sends no credentialed wildcard CORS headers, uses no cookies, and returns `Cache-Control: no-store`. The frontend service worker must never cache API or authenticated responses.

No application-wide password or pairing secret belongs in Wrangler config. Capabilities are generated per device/member. Do not commit recovery files, device tokens, database exports, or request bodies to a repository or diagnostic logs.

## Verification

Run `node tests/backend.test.js` with Node 24 for the focused API suite. The fixture applies the actual SQL migrations to `node:sqlite` and presents a D1-shaped prepared-statement/batch adapter. The suite covers simultaneous invite claims, stale/repeated writes, member authorization, recovery/revocation, snapshot isolation/retention, protected timer accounting, DST/midnight behavior, routine generation/Undo, import/restore, request limits and CORS. It verifies backend behavior independently of the browser; live deployment checks belong to the deployment workflow.
