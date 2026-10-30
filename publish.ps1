# Signs a new version with Mozilla (unlisted, private) and publishes it so Firefox auto-updates.
#   .\publish.ps1            bumps the patch version (1.1.0 -> 1.1.1)
#   .\publish.ps1 1.2.0      uses the version you give
# Needs WEB_EXT_API_KEY / WEB_EXT_API_SECRET saved as user environment variables
# (from https://addons.mozilla.org/developers/addon/api/key/).
param([string]$Version)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$id = "apply-autofill@local"
$rawBase = "https://raw.githubusercontent.com/RobWiersma/apply-autofill/main"

# Read the keys from the user's saved environment, so a newly set key works without restarting.
foreach ($name in "WEB_EXT_API_KEY", "WEB_EXT_API_SECRET") {
  $value = [Environment]::GetEnvironmentVariable($name, "User")
  if (-not $value) { throw "$name is not set. Save your Mozilla API key first (see README.md)." }
  Set-Item "env:$name" $value
}

$manifestPath = Join-Path $PSScriptRoot "manifest.json"
$manifest = Get-Content $manifestPath -Raw
$current = [regex]::Match($manifest, '"version":\s*"([^"]+)"').Groups[1].Value
if (-not $Version) {
  $parts = $current.Split(".")
  $parts[-1] = [int]$parts[-1] + 1
  $Version = $parts -join "."
}
Write-Host "Publishing $current -> $Version"
$manifest = [regex]::Replace($manifest, '"version":\s*"[^"]+"', "`"version`": `"$Version`"", 1)
[IO.File]::WriteAllText($manifestPath, $manifest)

npx --yes web-ext@8 sign --channel unlisted --source-dir . --artifacts-dir dist `
  --ignore-files "dist/**" "publish.ps1" "updates.json" "README.md" ".gitignore" ".amo-upload-uuid"
if ($LASTEXITCODE -ne 0) { throw "Signing failed (manifest version is now $Version; fix and re-run with: .\publish.ps1 $Version)" }

$xpi = Get-ChildItem dist -Filter "*$Version*.xpi" | Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $xpi) { throw "Signed .xpi for $Version not found in dist" }

$updates = @{ addons = @{ $id = @{ updates = @(@{ version = $Version; update_link = "$rawBase/dist/$($xpi.Name)" }) } } }
[IO.File]::WriteAllText((Join-Path $PSScriptRoot "updates.json"), ($updates | ConvertTo-Json -Depth 6))

# git writes progress and line-ending notes to stderr; judge it by exit code, not stderr.
$ErrorActionPreference = "Continue"
git add -A
git commit -m "Release $Version"
git push -u origin main
if ($LASTEXITCODE -ne 0) { throw "git push failed; the signed file is in dist. Fix and run: git push -u origin main" }
Write-Host "Done. Firefox picks up $Version within a day, or now via Add-ons > gear > Check for Updates."
