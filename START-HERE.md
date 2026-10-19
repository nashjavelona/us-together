# Complete GitHub replacement v4.1.2

If you are replacing **all** your existing GitHub files, follow **[REPLACE-ALL-START-HERE.md](REPLACE-ALL-START-HERE.md)** first. The older 7-file patch instructions below are for partial updates only.

---

# Before you upload: v4.1.0

For an **existing GitHub Pages** installation, use the cumulative seven-file patch and follow [`UPDATE-FIRST.md`](UPDATE-FIRST.md). A new inbox named **For You ♡** is included. No new database or pairing is required; keep your recovery files private. The general installation guidance follows.

---

# Put Us, Together on GitHub

**Current update:** Already installed? See the cumulative 7-file v4.1.0 patch in `UPDATE-FIRST.md`. It includes the previous pairing fixes, so you do not need separate v4.0.1 or v4.0.2 patches.

The v4 package supports a private shared database. GitHub Pages hosts the website files; the existing Site continues to run the API and database. The current dashboard is https://momentum-my-second-brain.void-mag-inv-5623.chatgpt.site.

## 1. Keep your access and tasks

If already connected, open **Our connection → Save my recovery file** on your own device. Also use **Settings → Export task backup**. Keep both files outside the upload folder. Your recovery file is private and must never be committed to GitHub. Your partner keeps their own recovery file.

If still using local-only mode, export a task backup. You can connect on the current website first, or restore that task backup on the new website and then create your shared space there.

## 2. Create a separate repository

Open https://github.com/new and create a repository named `us-together` in your GitHub account. Use a separate repository from your existing portfolio. For a public GitHub Free Pages site, use a public repository. Adding an initial README is fine; the package supplies the project README.

This package is configured for your `nashjavelona` GitHub Pages origin. If publishing through a different account or custom domain, the backend’s exact origin allowlist must be updated as described in `BACKEND.md`.

## 3. Upload the extracted contents

Extract `Us-Together-GitHub.zip`. Open the extracted folder until you see `index.html`, `app.js`, and `style.css` together. In the new repository, choose **Add file → Upload files** and upload these contents, including the folders, so `index.html` is at the repository’s top level.

The outer ZIP is the delivery package; uploading only that ZIP will not publish the dashboard. Extract it, then upload the root website files. The obsolete bundled managed-Site source archive was intentionally omitted from v4.1. Include `.nojekyll` and `.gitignore` if your file picker shows them.

Commit the upload to the new repository’s default branch. Suggested message: `Add Us, Together with private couple sync`.

## 4. Turn on Pages

Open **Settings → Pages** and choose:

| Setting | Value |
| --- | --- |
| Source | Deploy from a branch |
| Branch | `main`, or the actual default branch you used |
| Folder | `/ (root)` |

Save, wait for the Pages deployment, and use **Visit site**. For account `nashjavelona` and repository `us-together`, the expected address is https://nashjavelona.github.io/us-together/. This is the intended address after you publish; the package does not itself create that GitHub repository or deployment.

## 5. Reconnect to the same couple space

On the GitHub website choose **Connect us → Reconnect my device**. Select your own recovery file and name this new browser connection. Your shared tasks, notes and history load from the same database. Your partner can repeat this with their own recovery file.

Do not create another shared space just because the website address changed. A task backup restores content; a recovery file reconnects your existing member identity. Browser storage from the old website is not automatically available at the new address.

If you have never connected and only have local task data, choose **Settings → Restore task backup**, restore the JSON, then **Connect us → Create our shared space** and invite your partner.

## What the repository contains

- Static frontend files ready for Pages, including the updated scoped service worker.
- The actual API source, schema and SQL migration, plus an optional standalone Worker configuration.
- All automated tests and a test runner; run `npm test` with Node.js 24 or later.
- The full current static frontend, API source, schema, tests, and migration files. The older managed-Site source archive was not included because its frontend is outdated.
- `README.md`, `BACKEND.md`, and `QA_REPORT.md` explaining operation, ownership and verification.

The standalone backend is optional. Publishing on Pages does not run `server/worker.js`, create a new database, or migrate the current database. Leave the configured API address as supplied to keep using the existing backend.

## If something does not open

- **README appears instead of the dashboard:** put `index.html` at the root of the selected publishing folder.
- **404:** check the branch/folder setting and the Pages deployment in the repository’s Actions tab.
- **Blank after double-clicking the HTML file:** use an HTTP server or the published website; JavaScript modules need a web origin.
- **Old-looking page:** refresh the published page. Export tasks and save your recovery file before clearing site data.
- **Local files work but pairing on localhost fails:** the production API intentionally allows only its configured frontend origins. Follow the local backend instructions in `BACKEND.md`, or use the published dashboard.
- **Connected but changes need a choice:** open the connection’s conflict review. Export this device’s copy before resolving if you want to retain both versions.

## Official references

- GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
- Configure a publishing source: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- Upload files: https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository


**Current release:** v4.1.2. See `PROFESSIONAL-QA-V4.1.2.md` for verified fixes, test scope, and real-device limitations.
