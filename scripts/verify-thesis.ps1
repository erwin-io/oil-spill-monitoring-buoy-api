<#
.SYNOPSIS
  Automated thesis validation across the API and Ionic mobile repositories.
.DESCRIPTION
  Default: API isolated emulator acceptance + mobile Node/Angular suite.
  Optional: existing Firebase READ-ONLY API smoke, Android Gradle/ADB install.
  Never writes synthetic oil incidents into the real Firebase database.
.EXAMPLE
  .\scripts\verify-thesis.ps1
.EXAMPLE
  .\scripts\verify-thesis.ps1 -SkipInstall -WithAndroid -InstallOnDevice
#>
[CmdletBinding()]
param(
    [string]$MobilePath = '..\oil-spill-monitoring-buoy-app',
    [switch]$SkipInstall,
    [switch]$ExistingFirebaseReadOnly,
    [switch]$WithAndroid,
    [switch]$InstallOnDevice,
    [switch]$Screenshot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$apiRoot = Split-Path -Parent $PSScriptRoot
$resolvedMobile = Join-Path $apiRoot $MobilePath
if (-not (Test-Path (Join-Path $resolvedMobile 'package.json'))) {
    throw "Mobile repository not found at: $resolvedMobile. Specify -MobilePath 'C:\path\oil-spill-monitoring-buoy-app'."
}
if ($InstallOnDevice -and -not $WithAndroid) {
    throw '-InstallOnDevice requires -WithAndroid.'
}
if ($Screenshot -and -not $InstallOnDevice) {
    throw '-Screenshot requires -WithAndroid -InstallOnDevice.'
}

function Invoke-ProjectStep {
    param([string]$Folder,[string]$Title,[string[]]$Args)
    Push-Location $Folder
    try {
        Write-Host ''
        Write-Host "=== $Title ===" -ForegroundColor Cyan
        & npm.cmd @Args
        if ($LASTEXITCODE -ne 0) {
            throw "$Title failed with exit code $LASTEXITCODE"
        }
        Write-Host "PASS: $Title" -ForegroundColor Green
    } finally {
        Pop-Location
    }
}

$apiArgs = @('run','verify:local')
if ($SkipInstall) { $apiArgs += @('--','--skip-install') }
Invoke-ProjectStep -Folder $apiRoot -Title 'API emulator and HTTP integration acceptance' -Args $apiArgs

if ($ExistingFirebaseReadOnly) {
    $need = @('THESIS_API_BASE_URL','THESIS_FIREBASE_PROJECT_ID','THESIS_FIREBASE_WEB_API_KEY','THESIS_TEST_EMAIL','THESIS_TEST_PASSWORD')
    foreach($name in $need) {
        if (-not [Environment]::GetEnvironmentVariable($name)) {
            throw "Missing $name. Configure the existing-project READ-ONLY smoke variables before retrying."
        }
    }
    Invoke-ProjectStep -Folder $apiRoot -Title 'Existing Firebase read-only smoke' -Args @('run','verify:existing-firebase')
}

$appScript = 'verify:local'
if ($WithAndroid -and $InstallOnDevice) { $appScript = 'verify:android' }
$appArgs = @('run',$appScript)
$appFlags = @()
if ($WithAndroid -and -not $InstallOnDevice) { $appFlags += '--android' }
if ($SkipInstall) { $appFlags += '--skip-install' }
if ($Screenshot) { $appFlags += '--screenshot' }
if ($appFlags.Count -gt 0) { $appArgs += '--'; $appArgs += $appFlags }
Invoke-ProjectStep -Folder $resolvedMobile -Title 'Mobile unit, charts and Android validation' -Args $appArgs

Write-Host ''
Write-Host 'PASS: all requested automated validation steps completed.' -ForegroundColor Green
Write-Host 'API report:    .test-output/api-local-validation.json'
Write-Host 'Mobile report: .test-output/mobile-local-validation.json'
Write-Host 'Manual real-device FCM/Pusher and UI observations remain separate.'
