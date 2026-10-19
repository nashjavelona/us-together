# Us, Together v4.1 — For You ♡

## What's new

- **For You ♡ inbox** beside Our space, All tasks, and Little wins; unread counter and a postcard preview on the home page.
- **Little messages**: two-way text conversation with author, sent time, manual read status and hearts, hugs, or sparkles as reactions.
- **Sealed letters**: a stationery-style writer with prompts, envelope previews, explicit opening, and a warm letter reader. An unopened letter's contents aren't shown in the inbox preview.
- **Mark all read**, read receipts and reaction toggles, author-only removal, capped message history with Load earlier.
- **Profile-specific drafts**: switching profiles on a shared browser doesn't carry an unfinished draft into the other person's composer.
- **Better small-screen styling**, with generous tap targets, responsive chat cards and envelopes.
- All previous personal/shared tasks, timers, routines, appointments, notes, local backups, connection recovery and cloud synchronization remain intact.

## How it syncs (and why no database migration is needed)

The live backend already stores up to 1,000 author-owned note records. Instead of introducing a new server field that the existing API would reject, For You uses **versioned encoded note text** for a message or letter. A read receipt or reaction is a separate note authored by the recipient. The server retains its existing author-only editing rule, exact revision handling, snapshots and device authorization. All four record shapes contain only the existing `id`, `from`, `text` and `date` fields; no database schema change is required.

Both partners should update their frontends together. A device running an older frontend can show new message/receipt records as unfamiliar strings inside the old love-note wall. The updated frontend separates them automatically. Existing love notes retain their original shape and remain displayed under **Love, left here**. Downloaded task backups include the messages and metadata automatically.

## Limits and transparency

- Messages and letters are **up to 440 characters**, with line breaks.
- The original API's **1,000-note limit** includes normal love notes, messages, letters, read markers and reactions. Export a backup and clean up older records if it fills; author-only removal may leave invisible receipt records owned by the other person.
- **Manual read controls**: viewing a message does not automatically mark it read; you can mark an individual message or mark all received messages and letters. Opening a sealed letter marks it read.
- **No closed-app push notifications, SMS, email, attachments, or end-to-end encryption**. Synchronization depends on the existing backend and on having the website open, online, and connected to the same couple space. Each space member can read the shared conversation. Keep recovery credentials private.
- A successful local save or queued sync is **not** proof that the other device has opened the message. The connection indicator reports sync status.

## Recommended GitHub update

1. On the existing website, **Settings → Export task backup**, then securely keep that JSON file on your own device. Never upload it to GitHub.
2. Download `Us-Together-For-You-Patch-v4.1.0.zip` and extract it.
3. In the **root** of `nashjavelona/us-together` on branch `main`, replace the seven files listed inside `UPDATE-FIRST.md`. The patch is cumulative and includes the earlier v4.0.2 pairing fixes; you do not need to apply v4.0.1/v4.0.2 first.
4. Commit the changes and wait until **Actions → pages build and deployment** succeeds.
5. Open `https://nashjavelona.github.io/us-together/`, refresh fully (Ctrl+Shift+R on desktop), and look for the **For You ♡** tab. Both devices should load this version before exchanging messages.
6. Send a test message from the black side to the pink side. Open on the other device, mark it read, add a reaction, and verify the original device shows the update. Then test a letter.

**Do not** recreate your database, disconnect devices, delete browser site data, or import a task backup merely to install this frontend. The previously connected accounts and storage stay where they are. Keep all recovery JSON, invitation links, device capabilities and private task backups **out of the public repository**.

## Testing

The Node test suite exercises the new data model and simulated UI events, together with the real D1 handler through an isolated SQLite fixture. Run `npm test` in the extracted complete project. Browser automation and live-phone rendering could not be verified in this execution environment, so the two-device checklist is still required.
