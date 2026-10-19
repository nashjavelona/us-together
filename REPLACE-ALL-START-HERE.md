# Us, Together 4.1.2 — REPLACE ALL FILES (GitHub Pages)

**This ZIP contains the full GitHub Pages project, not just a patch.** The website's `index.html`, scripts, styles, icons, database/backend source files, schema, and tests are included. Its contents must sit directly at the **root** of your existing repository, `nashjavelona/us-together`.

## The safest replacement

1. Download/extract this ZIP. Open the extracted contents and verify `index.html`, `app.js`, `cloud-sync.js`, `for-you.js`, `style.css`, `.nojekyll`, and the folders `server/`, `db/`, `drizzle/`, and `tests/` are present.
2. Open **https://github.dev/nashjavelona/us-together** on your computer. This is GitHub's web editor, not a command prompt.
3. In the left Explorer pane, replace the existing tracked **files/folders** with the extracted ZIP's contents at the repository root. Because you want a clean replacement, remove any obsolete files *before* committing, including the old nested `Us-Together-Source.zip`. Don't delete the repository, its branch, or the GitHub Pages Settings.
4. In the web editor Source Control panel, inspect the changes. They should show updated files, new `for-you.js`, and deletions for obsolete files. **Make one Commit & Push** to `main`, with message `Replace Us Together with v4.1.2 audited project`. Do not commit a delete-only intermediate version.
5. Open **https://github.com/nashjavelona/us-together/actions** and wait for the green Pages deployment check. GitHub Pages must be set to `main` and `/ (root)`.
6. Open **https://nashjavelona.github.io/us-together/** and perform a hard reload (Windows Chrome: Ctrl+Shift+R). To verify you received the new HTML, view page source and find `4.1.2-professional-qa`. If it is absent after a successful deployment, an old page may still be cached.
7. On **Connect us**, if an older connection is blocked, use **Resolve earlier attempt -> Check & resolve**. If that cannot reach the server, an explicitly warned **Advanced: forget unfinished attempt** option can clear only the unconnected browser request, but it may lose access to a newly created space if the server succeeded and you lack its recovery file. **Join** is only for the partner; **Reconnect my device** is for your own phone/laptop. Avoid repeated pairing submissions if the server rate limit is active.

## VERY IMPORTANT: data and security

- Replacing files on GitHub **does not delete or reset** the separately hosted shared database. It **also does not automatically clear** an old pending connection saved in that browser. Use the in-app recovery controls after updating.
- The included `cloud-config.js` points to the existing hosted API. GitHub Pages serves static files only; it does **not** run `server/worker.js` or deploy a new database. Server-side patches in this repository will NOT affect the live API unless deployed separately.
- Do NOT commit any recovery JSON, invitation/recovery key, `.env` file, task backup, or device credential. This archive intentionally does not include such credentials.
- If you have live unsynced changes you want to keep, export a task backup *before* refreshing or resetting browser storage. Do not clear browser site data unless you are prepared to lose that browser's unsynced copy.
- This is a complete code replacement, but it cannot bypass an active **server rate limit**. Wait for that limit to expire if necessary.

## Files in this archive

`index.html`, all frontend JavaScript and CSS, icons, manifest, service worker, .nojekyll, backend source (`server/`, `db/`, `drizzle/`), test runner and tests (`scripts/`, `tests/`), project metadata, and technical documentation.

Check **README.md** for app overview, **BACKEND.md** for backend-specific configuration, and **QA_REPORT.md** for previous automated test coverage.

## QA verification

See `PROFESSIONAL-QA-V4.1.2.md`. There are 221 automated tests passing in each of the Philippine and Los Angeles timezone runs. Real-device and production API checks remain to be completed.
