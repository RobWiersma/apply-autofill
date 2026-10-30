# Apply Autofill

Firefox extension that fills job application forms (LinkedIn Easy Apply, Greenhouse, Lever, Workday and other job sites) from info you save once. It never clicks Next or Submit. Your info is stored only in your browser, never in this code.

## Install

Open the latest signed `.xpi` from `dist/` in Firefox and click **Add**. It stays installed and updates itself.

## Publishing a new version

One-time setup: create an API key at https://addons.mozilla.org/developers/addon/api/key/ and save it as user environment variables:

```powershell
setx WEB_EXT_API_KEY "user:12345:678"
setx WEB_EXT_API_SECRET "your-secret"
```

Then for each release:

```powershell
.\publish.ps1
```

This bumps the version, has Mozilla sign it privately (unlisted), updates `updates.json` and pushes to GitHub. Firefox checks `updates.json` about once a day; to update right away, go to Add-ons, click the gear, then **Check for Updates**.
