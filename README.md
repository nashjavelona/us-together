# Us, Together v4.1.0 — For You ♡

**New in this release:** a partner message inbox, sealed letters, read receipts, reactions and profile-specific drafts. Read [`FOR-YOU-V4.1.md`](FOR-YOU-V4.1.md) for privacy/limits, and [`UPDATE-FIRST.md`](UPDATE-FIRST.md) for the cumulative 7-file GitHub Pages update. The existing API, database and stored tasks do not need migration.

---

# Us, Together — A little more us.

A charcoal-and-pink dashboard for two people: personal and shared tasks, kind assignment requests, a helping-hand board, focus timers, check-ins and love notes.

This folder is ready for **GitHub Pages → main → / (root)**. Follow `START-HERE.md`. The frontend uses the private shared-space API already hosted at https://momentum-my-second-brain.void-mag-inv-5623.chatgpt.site/api.

## Use it together

On the device with your existing tasks, choose **Connect us → Create our shared space**. Choose your side and shared timezone, save your personal recovery file, then create an invitation for your partner. They join on their phone and save their own recovery file. A private invitation is single-use and expires after 24 hours.

Each connected device has a fixed member identity. Viewing the other side does not change who you are. Both people can read the couple space; personal task editing, routines, protected time and focus controls belong to their member. Shared tasks can be edited by either person. Assigning a personal task to your partner creates a request they can accept, reschedule or decline.

Ordinary edits save locally and sync while online. A durable queue retains offline changes and survives a reload. Independent edits merge; conflicts on the same record show both versions for an explicit choice. Timer commands require a reachable server, and the server records elapsed time once.

## Where your data lives

The connected database stores the complete couple state: tasks, checklists, pending requests, help offers, completed and archived tasks, focus sessions, routines, appointments, names, check-ins and notes. Completing or archiving a task keeps it stored. Daily schedule layouts are derived from those records.

GitHub holds application code. Your private task records live in the API’s D1 database and in your own browser cache, not in this repository. Separate membership and device records contain hashed credentials. Connected state is capped at 950,000 JSON bytes and 2,000 total tasks, including archived tasks.

The status banner and footer distinguish saved, syncing, offline, conflicted and revoked connections. There are no external messages or push notifications. Local-only mode remains available when you have not connected.

## Recovery

**Our connection → Automatic backups** provides the last 50 saved snapshots with a preview before restore. A restore affects both members and first saves the current version. These are snapshots within the same database; download periodic task exports for an independent copy.

**Save my recovery file** preserves your own member access. **Export task backup** preserves task content without credentials. Keep recovery files, invitations and personal exports out of GitHub. Use **My connected devices** to revoke an old device. Losing every connected device and your recovery file leaves no email-reset route.

If you move from the original Site to the GitHub address, use **Connect us → Reconnect my device** with your own recovery file. That opens the same database. Creating another space would make a separate database record. If you have only unconnected local tasks, restore their task backup and then connect.

## Development and tests

The frontend requires no package install or build. For local-only exploration:

```sh
python3 -m http.server 8080
```

Open `http://localhost:8080`. The production API intentionally rejects arbitrary localhost origins, so follow `BACKEND.md` to run a local API if you want to test connected mode locally.

Run the full test suite with Node.js 24 or later:

```sh
npm test
```

Tests use the actual API handlers and migrations through a local SQLite adapter, plus controlled storage/network clients and simulated UI events. They do not require a real database account. `QA_REPORT.md` records results and the remaining real-browser checks.

For the optional standalone backend, `npm install` installs pinned tooling, then follow `BACKEND.md`. The supplied Worker configuration contains a placeholder database ID and must be configured before deployment. This Pages repository does not deploy the backend automatically.

## Files

| Path | Purpose |
| --- | --- |
| `index.html`, `style.css`, `app.js` | Responsive dashboard and task interactions |
| `cloud-sync.js`, `sync-model.js`, `cloud-ui.js`, `cloud-config.js` | Pairing, local queue, merge, recovery and API address |
| `core.js`, `calendar.js`, `couple.js`, `together.js`, `ui-model.js` | Task/planning/calendar models |
| `server/`, `db/`, `drizzle/` | Optional API source, schema and checked-in migration |
| `tests/`, `scripts/test-all.mjs` | Isolated automated tests |
| `sw.js`, manifest, icons | App-shell cache and install metadata |
| `FOR-YOU-V4.1.md`, `UPDATE-FIRST.md` | New partner mailbox feature and safe GitHub update instructions |

The static export places frontend modules at the root. The complete source archive places them in `public/`; import paths in this export’s server/tests are adjusted accordingly. Its complete README contains the detailed feature guide.

The configured production origins are the existing Site and `https://nashjavelona.github.io`. A different GitHub account or custom domain needs an explicit backend allowlist update. Moving the API itself also requires updating `cloud-config.js` and the HTML content security policy, then deliberately migrating or importing data. Details are in `BACKEND.md`.

The black-left/pink-right design includes an inbox, letters, reactions, connection cards, backup previews, clear request feedback, large touch targets, focus styles and reduced-motion rules. Real phone layout, screen-reader behavior, installation, audio and browser-offline use still need device testing; simulated tests do not certify them.
