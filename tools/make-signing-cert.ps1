#requires -Version 5.1
<#
Creates a self-signed code-signing certificate for local testing and exports it
as a PFX that electron-builder can use.

  powershell -ExecutionPolicy Bypass -File tools\make-signing-cert.ps1

Notes
  * A self-signed certificate only removes the "unknown publisher" prompt on
    machines where the certificate is installed in "Trusted Root Certification
    Authorities". For public distribution buy a real code-signing certificate
    (OV/EV) and point DEEPCW_CERT_FILE at that PFX instead.
  * The PFX is written to app\build\signing.pfx.
#>

param(
  [string]$OutFile = (Join-Path $PSScriptRoot "..\app\build\signing.pfx"),
  [string]$Password = "deepcw-local",
  [string]$Subject = "CN=DeepCW Desktop (local self-signed)"
)

$ErrorActionPreference = "Stop"

Write-Host "Creating self-signed code signing certificate..."
$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject $Subject `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -KeyExportPolicy Exportable `
  -KeyAlgorithm RSA `
  -KeyLength 3072 `
  -HashAlgorithm SHA256 `
  -NotAfter (Get-Date).AddYears(5)

$secure = ConvertTo-SecureString -String $Password -Force -AsPlainText
$outDir = Split-Path -Parent $OutFile
if (-not (Test-Path $outDir)) {
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}

Export-PfxCertificate -Cert $cert -FilePath $OutFile -Password $secure | Out-Null

# Trust the certificate locally (admin required) so this machine stops warning.
$cerPath = Join-Path $env:TEMP "deepcw-code-signing.cer"
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null
try {
  Import-Certificate -FilePath $cerPath -CertStoreLocation "Cert:\LocalMachine\Root" | Out-Null
  Write-Host "Certificate added to LocalMachine\Trusted Root."
} catch {
  Write-Warning "Could not add the certificate to the trusted root store: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "PFX written to : $OutFile"
Write-Host "Password       : $Password"
Write-Host "Thumbprint     : $($cert.Thumbprint)"
Write-Host ""
Write-Host "Build a signed installer with:"
Write-Host "  `$env:DEEPCW_CERT_FILE = `"$OutFile`""
Write-Host "  `$env:DEEPCW_CERT_PASSWORD = `"$Password`""
Write-Host "  npm run dist:signed"
