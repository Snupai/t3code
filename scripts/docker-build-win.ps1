$ErrorActionPreference = "Stop"

$bunBin = Join-Path $env:USERPROFILE ".bun\bin"
if (Test-Path $bunBin) {
  $env:PATH = "$env:PATH;$bunBin"
}

Set-Location "C:\app"

Write-Host "[docker-build-win] bun version:"
bun --version

Write-Host "[docker-build-win] verifying required package resolution..."
node --input-type=module -e "await import('@effect/platform-node/NodeRuntime'); console.log('ok')"

Write-Host "[docker-build-win] building Windows desktop artifact..."
bun run dist:desktop:win

$releaseDir = "C:\app\release"
$artifactDir = "C:\artifacts"

if (-not (Test-Path $releaseDir)) {
  throw "Expected release directory at $releaseDir but it was not created."
}

New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
Copy-Item -Recurse -Force "$releaseDir\*" "$artifactDir\"

Write-Host "[docker-build-win] copied artifacts to $artifactDir"
