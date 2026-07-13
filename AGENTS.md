# Codex Project Rules

This project is the standalone web app in `qq365098020/bedside-cabinet-notes`.

## Repository Boundaries

- Only deploy this project to `qq365098020/bedside-cabinet-notes`.
- Do not modify, disable, rename, or redeploy `ops-rush` while working on this project.
- Keep the public repository metadata and page title neutral. Do not expose the app's real trading-review purpose in README, package metadata, manifest text, page title, or GitHub Pages visible description.

## Required Workflow After Every Code Or Content Change

- Run a local verification step before deployment. Use `npm run build` for source changes unless the change is documentation-only and cannot affect runtime.
- Deploy by running `bash deploy.sh "<short change summary>"`.
- The deploy script updates `manifest.json`, `version.json`, `index.html`, and `sw.js` with a timestamp version, commits the changes, and pushes to GitHub.
- Do not leave local changes uncommitted after a completed modification unless the user explicitly asks not to deploy.

## Required User Report

After each completed modification, report:

- The generated version number from `deploy.sh`.
- The GitHub Pages URL for that exact version: `https://qq365098020.github.io/bedside-cabinet-notes/?v=<version>`.
- The verification that was run, including any failed or skipped checks.
- A short note that `ops-rush` was not touched if the work involved deployment.

## Deployment Command

```bash
bash deploy.sh "short change summary"
```

## Update Cache Troubleshooting

- If the public version number changes but the interface still looks old, first inspect the published HTML and confirm both `src/styles.css` and `src/app.js` include the current `?v=<version>` query.
- Keep page navigations, styles, scripts, workers, `version.json`, and `manifest.json` on the service worker's network-first path. Do not restore cache-first handling for these resources.
- The update action should clear only caches whose names start with `bedside-cabinet-notes-` before loading the new version.
- Verify a release by checking the public `version.json`, the version meta tag, the versioned CSS/JS URLs, and the published service worker—not only the Git push result.
