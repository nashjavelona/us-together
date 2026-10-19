# Update your existing GitHub Pages site — Us, Together v4.1.0

This folder contains exactly **seven website files** to add/replace at the **top level** of your repository:

- `app.js`
- `cloud-sync.js` (includes previous pairing/recovery fixes)
- `cloud-ui.js` (includes previous pairing/recovery fixes)
- `for-you.js` (**new**)
- `index.html`
- `style.css`
- `sw.js` (new offline-cache version with `for-you.js`)

Open `https://github.com/nashjavelona/us-together`, on `main`, then add/replace these files in the repository root and commit. Leave the rest of the repo intact. If the GitHub Upload Files page refuses files that already exist, open `https://github.dev/nashjavelona/us-together`, replace them in its file explorer, then use Source Control → Commit → Push. Do not accidentally put them inside a second directory.

Wait for GitHub Pages deployment and refresh the site. The new navigation tab is **For You ♡**. Both partners should update their browser views; old clients can show message metadata as raw text in the existing notes wall.

**No backend migration or new API keys are needed.** Do not delete the current D1 database or clear your browser data. The database continues to store tasks and new notes. No changes are being deployed to your GitHub account automatically from this ZIP.

**Private:** Do not commit your recovery `.json`, partner invite, task backup or raw token values.
