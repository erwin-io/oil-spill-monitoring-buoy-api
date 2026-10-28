# BlueGuard Buoy: launch all safe API + Mobile automated software tests in one command.
# Windows: .\test-blueguard.cmd
# Optional: .\test-blueguard.cmd -Android [-InstallOnDevice] [-Screenshot]
[CmdletBinding()]
param(
    [switch]$Android,
    [switch]$InstallOnDevice,
    [switch]$Screenshot,
    [switch]$FreshDependencies
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$apiRoot = $PSScriptRoot
$workspace = Split-Path -Parent $apiRoot
$mobileRoot = Join-Path $workspace 'oil-spill-monitoring-buoy-app'
$verifyScript = Join-Path $apiRoot 'scripts\verify-thesis.ps1'
$apiReport = Join-Path $apiRoot '.test-output\api-local-validation.json'
$mobileReport = Join-Path $mobileRoot '.test-output\mobile-local-validation.json'
$summaryDir = Join-Path $apiRoot '.test-output'
$summaryPath = Join-Path $summaryDir 'blueguard-one-command-report.json'
$started = Get-Date
$errorMessage = $null
$apiResult = 'NOT_RUN'
$mobileResult = 'NOT_RUN'
$skipInstall = $false

function Get-ReportStatus {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return 'NOT_RUN' }
    try {
        $report = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
        if ($report.result -eq 'PASS') { return 'PASS' }
        return 'FAIL'
    }
    catch { return 'INVALID_REPORT' }
}

try {
    if ($InstallOnDevice -and -not $Android) {
        throw '-InstallOnDevice requires -Android.'
    }
    if ($Screenshot -and -not $InstallOnDevice) {
        throw '-Screenshot requires -Android -InstallOnDevice.'
    }
    if (-not (Test-Path -LiteralPath $verifyScript)) {
        throw "API testing coordinator is missing: $verifyScript"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $mobileRoot 'package.json'))) {
        throw "Mobile repository must exist beside the API repository: $mobileRoot"
    }
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        throw 'Node.js/npm is not installed or npm.cmd is not on PATH.'
    }
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
        throw 'Node.js is not installed or node.exe is not on PATH.'
    }

    New-Item -Path $summaryDir -ItemType Directory -Force | Out-Null
    # A failing preflight must never show a PASS from an older run.
    foreach ($file in @($apiReport, $mobileReport, $summaryPath)) {
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
    }

    $skipInstall = (-not $FreshDependencies) -and
        (Test-Path -LiteralPath (Join-Path $apiRoot 'node_modules')) -and
        (Test-Path -LiteralPath (Join-Path $mobileRoot 'node_modules'))

    $options = @{
        MobilePath = '..\oil-spill-monitoring-buoy-app'
        SkipInstall = [bool]$skipInstall
        WithAndroid = [bool]$Android
        InstallOnDevice = [bool]$InstallOnDevice
        Screenshot = [bool]$Screenshot
    }

    Write-Host ''
    Write-Host '=================================================' -ForegroundColor Cyan
    Write-Host ' BLUEGUARD BUOY - ONE-COMMAND AUTOMATED TESTING' -ForegroundColor Cyan
    Write-Host '=================================================' -ForegroundColor Cyan
    Write-Host 'API + QR v2 Firebase-emulator pairing + Mobile/Angular'
    Write-Host "Dependencies: $(if ($skipInstall) { 'existing local installs' } else { 'npm ci (locked install)' })"
    Write-Host "Android build: $([bool]$Android) | Install on device: $([bool]$InstallOnDevice)"
    Write-Host 'Production Firebase writes: DISABLED. Real physical LTE pairing: NOT TESTED.'
    Write-Host ''

    & $verifyScript @options
    if (-not $?) { throw 'Automated verification script failed.' }

    $apiResult = Get-ReportStatus -Path $apiReport
    $mobileResult = Get-ReportStatus -Path $mobileReport
    if ($apiResult -ne 'PASS' -or $mobileResult -ne 'PASS') {
        throw "One or more test reports are not PASS (API=$apiResult, Mobile=$mobileResult)."
    }
}
catch {
    $errorMessage = $_.Exception.Message
    $apiResult = Get-ReportStatus -Path $apiReport
    $mobileResult = Get-ReportStatus -Path $mobileReport
    Write-Host ''
    Write-Host "BLUEGUARD TESTING FAILED: $errorMessage" -ForegroundColor Red
}
finally {
    New-Item -Path $summaryDir -ItemType Directory -Force | Out-Null
    $summary = [ordered]@{
        suite = 'BlueGuard one-command software acceptance'
        timestamp = (Get-Date).ToUniversalTime().ToString('o')
        durationSeconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
        result = $(if ($null -eq $errorMessage) { 'PASS' } else { 'FAIL' })
        api = $apiResult
        mobile = $mobileResult
        androidRequested = [bool]$Android
        androidInstallRequested = [bool]$InstallOnDevice
        productionFirebaseWrites = $false
        physicalLtePairingProven = $false
        apiReport = $apiReport
        mobileReport = $mobileReport
        failure = $errorMessage
    }
    $summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
    Write-Host ''
    Write-Host "Combined report: $summaryPath"
    Write-Host "API report:      $apiReport"
    Write-Host "Mobile report:   $mobileReport"
}
if ($null -ne $errorMessage) { exit 1 }
Write-Host 'ALL REQUESTED BLUEGUARD SOFTWARE TESTS PASSED' -ForegroundColor Green
exit 0
