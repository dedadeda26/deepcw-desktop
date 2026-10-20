<#
Builds the NSIS installer and the portable executable, signed with the
code-signing certificate from DEEPCW_CERT_FILE / DEEPCW_CERT_PASSWORD.

  $env:DEEPCW_CERT_FILE = "D:\DeepCW_desktop\app\build\signing.pfx"
  $env:DEEPCW_CERT_PASSWORD = "deepcw-local"
  npm run dist:signed
#>

param(
  [string]$CertFile = $env:DEEPCW_CERT_FILE,
  [string]$CertPassword = $env:DEEPCW_CERT_PASSWORD
)

$ErrorActionPreference = "Stop"
$appDir = Join-Path $PSScriptRoot "..\app"

if (-not $CertFile -or -not (Test-Path $CertFile)) {
  throw "Code-signing certificate not found. Set DEEPCW_CERT_FILE (and DEEPCW_CERT_PASSWORD) or run tools\make-signing-cert.ps1 first."
}

Push-Location $appDir
try {
  Write-Host "Building web assets..."
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }

  Write-Host "Packaging (signed)..."
  npx electron-builder --win nsis --x64 `
    "-c.win.signtoolOptions.certificateFile=$CertFile" `
    "-c.win.signtoolOptions.certificatePassword=$CertPassword"
  if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }
}
finally {
  Pop-Location
}
