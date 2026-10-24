# Oil Spill Monitoring Buoy — Repeatable Telemetry Lab (PowerShell 5.1+).
#
# One-time: this script creates a private config at:
#   $HOME\secure\oilspill\telemetry-lab.config.json
# Edit Pusher Channels APP_ID/KEY/SECRET/CLUSTER in that file once.
# Firebase Admin JSON defaults to $HOME\secure\oilspill\firebase-admin.json
# (or change fcm.serviceAccountJson in the private config).
#
# Each run:
#   .\scripts\telemetry-lab.ps1                  # complete scenario
#   .\scripts\telemetry-lab.ps1 -Scenario normal
#   .\scripts\telemetry-lab.ps1 -Scenario petroleum
#   .\scripts\telemetry-lab.ps1 -Scenario low_battery
#   .\scripts\telemetry-lab.ps1 -Scenario all -NoPush
#
# Only FCM token is requested in PowerShell for alert scenarios.
# All synthetic data go to disposable local Auth/Firestore emulators.
# Optional Pusher/FCM network sends target real providers, never cloud Firestore.

[CmdletBinding()]
param(
  [ValidateSet('all','normal','interference','inconclusive','below_threshold','petroleum','low_battery','sensor_fault','maintenance')]
  [string]$Scenario = 'all',
  [switch]$NoPush,
  [switch]$NoPusher
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$apiRoot = Split-Path -Parent $PSScriptRoot
$privateDirectory = Join-Path $HOME 'secure\oilspill'
$privateConfigPath = Join-Path $privateDirectory 'telemetry-lab.config.json'
$templatePath = Join-Path $PSScriptRoot 'telemetry-lab.config.example.json'
$scenarioFile = Join-Path $PSScriptRoot 'telemetry-lab.scenarios.json'
$variablesToSet = @(
  'PUSHER_APP_ID','PUSHER_KEY','PUSHER_SECRET','PUSHER_CLUSTER',
  'THESIS_FCM_PROJECT_ID','THESIS_FCM_CREDENTIALS_FILE','THESIS_FCM_TEST_TOKEN',
  'TELEMETRY_LAB_SCENARIO','THESIS_PROVIDER_CONFIRM'
)
$previous = @{}
foreach ($key in $variablesToSet) {
  $previous[$key] = [Environment]::GetEnvironmentVariable($key,'Process')
}
function Set-TestEnv([string]$name,[string]$value) {
  [Environment]::SetEnvironmentVariable($name,$value,'Process')
}
function Is-Placeholder([string]$value) {
  return [string]::IsNullOrWhiteSpace($value) -or $value.StartsWith('REPLACE_WITH_')
}
$secureToken = $null
$ptr = [IntPtr]::Zero
try {
  if (-not (Test-Path -LiteralPath $privateDirectory)) {
    New-Item -ItemType Directory -Force -Path $privateDirectory | Out-Null
  }
  if (-not (Test-Path -LiteralPath $privateConfigPath)) {
    Copy-Item -LiteralPath $templatePath -Destination $privateConfigPath
    Write-Host ''
    Write-Host 'ONE-TIME SETUP: A private config file has been created outside Git.' -ForegroundColor Yellow
    Write-Host ('Open and edit: ' + $privateConfigPath)
    Write-Host 'Set the four Pusher Channels values. Keep the secret private.'
    Write-Host 'The service-account JSON defaults to $HOME\secure\oilspill\firebase-admin.json.'
    Write-Host 'After saving the JSON file, run this same script again.'
    return
  }
  $config = Get-Content -LiteralPath $privateConfigPath -Raw | ConvertFrom-Json
  $fixture = Get-Content -LiteralPath $scenarioFile -Raw | ConvertFrom-Json
  $plan = $fixture.scenarios.$Scenario
  if ($null -eq $plan) { throw "Scenario not defined in telemetry-lab.scenarios.json: $Scenario" }
  if (@($plan.steps).Count -lt 1) { throw "Scenario has no telemetry steps." }
  $alerts = @($plan.expectedAlerts)
  $shouldPush = ($alerts.Count -gt 0) -and -not $NoPush
  $shouldPusher = -not $NoPusher

  if ($shouldPusher) {
    foreach ($field in @('appId','key','secret','cluster')) {
      if (Is-Placeholder([string]$config.pusher.$field)) {
        throw ("Private config is missing pusher.{0}; edit {1} once." -f $field,$privateConfigPath)
      }
    }
    Set-TestEnv 'PUSHER_APP_ID' ([string]$config.pusher.appId)
    Set-TestEnv 'PUSHER_KEY' ([string]$config.pusher.key)
    Set-TestEnv 'PUSHER_SECRET' ([string]$config.pusher.secret)
    Set-TestEnv 'PUSHER_CLUSTER' ([string]$config.pusher.cluster)
  }

  if ($shouldPush) {
    $projectId = [string]$config.fcm.projectId
    if ($projectId -ne 'oil-spill-monitoring-buoy') {
      throw 'Safety check: test phone must use oil-spill-monitoring-buoy.'
    }
    $credentialPath = [string]$config.fcm.serviceAccountJson
    if (-not $credentialPath -or $credentialPath -eq 'AUTO') {
      $credentialPath = Join-Path $privateDirectory 'firebase-admin.json'
    }
    if (-not (Test-Path -LiteralPath $credentialPath -PathType Leaf)) {
      throw ('Firebase Admin credential file not found: '+$credentialPath+' — update fcm.serviceAccountJson in private config.')
    }
    Set-TestEnv 'THESIS_FCM_PROJECT_ID' $projectId
    Set-TestEnv 'THESIS_FCM_CREDENTIALS_FILE' $credentialPath

    Write-Host ''
    Write-Host ("Scenario '{0}' produces {1} test notification(s) based on server alerts." -f $Scenario,$alerts.Count) -ForegroundColor Yellow
    Write-Host 'These messages will be marked SIMULATION ONLY and sent ONLY to the token you enter.' -ForegroundColor Yellow
    $secureToken = Read-Host 'Paste your OWN phone FCM registration token and press Enter' -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr).Trim()
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    $ptr = [IntPtr]::Zero
    $secureToken.Dispose()
    $secureToken = $null
    if ($token.Length -lt 20) { throw 'FCM token is missing or too short. Nothing was sent.' }
    Set-TestEnv 'THESIS_FCM_TEST_TOKEN' $token
    $token = $null
  } else {
    Write-Host 'No FCM token needed: selected scenario has no alert or -NoPush is active.' -ForegroundColor Cyan
  }

  Set-TestEnv 'TELEMETRY_LAB_SCENARIO' $Scenario
  if ($shouldPusher -or $shouldPush) {
    Set-TestEnv 'THESIS_PROVIDER_CONFIRM' 'SEND_TEST_PROVIDER_EVENTS'
  }

  $options = @('run','sim:pipeline','--')
  if ($shouldPusher) { $options += '--with-pusher' }
  if ($shouldPush) { $options += '--with-fcm' }

  Write-Host ''
  Write-Host '===== BLUEGUARD BUOY TELEMETRY LAB =====' -ForegroundColor Cyan
  Write-Host ('Scenario: '+$Scenario+' — '+[string]$plan.description)
  Write-Host ('Telemetry stages: '+@($plan.steps).Count)
  Write-Host ('Expected API alert types: '+($alerts -join ', '))
  Write-Host ('Pusher provider: '+$(if($shouldPusher){'ON'}else{'OFF'}))
  Write-Host ('Real FCM sends: '+$(if($shouldPush){'ON'}else{'OFF'}))
  Write-Host 'Firestore writes: LOCAL EMULATORS ONLY' -ForegroundColor Green

  Push-Location $apiRoot
  try {
    & npm @options
    $code = $LASTEXITCODE
    if ($code -ne 0) {
      throw ("Telemetry simulator failed (exit code {0}). See .test-output\telemetry-lab-report.json." -f $code)
    }
    $report = Join-Path $apiRoot '.test-output\telemetry-lab-report.json'
    if (-not (Test-Path -LiteralPath $report)) { throw 'Telemetry report not written.' }
    $summary = Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
    if ($summary.result -ne 'PASS') { throw 'Telemetry report did not indicate PASS.' }
    Write-Host ''
    Write-Host '===== ACCEPTANCE REPORT =====' -ForegroundColor Green
    Write-Host ('Scenario: '+$summary.scenario)
    Write-Host ('Alerts generated: '+(@($summary.alertTypes) -join ', '))
    Write-Host ('Pusher events: '+(@($summary.pusherEvents) -join ', '))
    Write-Host ('FCM provider accepted count: '+$summary.fcmSendCount)
    Write-Host 'Android notification receipt and tap: owner observation required'
    Write-Host ('JSON report: '+$report)
  }
  finally { Pop-Location }
}
finally {
  # Never persist FCM tokens or Pusher secrets to a report or a profile.
  if ($ptr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
  if ($null -ne $secureToken) { $secureToken.Dispose() }
  foreach ($key in $variablesToSet) {
    [Environment]::SetEnvironmentVariable($key,$previous[$key],'Process')
  }
}
