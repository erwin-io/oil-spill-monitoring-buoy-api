# Oil Spill Monitoring Buoy — Repeatable Telemetry Lab (PowerShell 5.1+).
#
# First run reads your existing API .env automatically. Alternatively, keep a
# gitignored scripts/telemetry-lab.config.json inside this repository.
# Existing legacy $HOME\secure\oilspill\telemetry-lab.config.json is accepted.
# Service account JSON remains at $HOME\secure\oilspill\firebase-admin.json
# by default and is NEVER copied into Git.
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
  [switch]$NoPusher,
  [switch]$CheckConfig
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$apiRoot = Split-Path -Parent $PSScriptRoot
$privateDirectory = Join-Path $HOME 'secure\oilspill'
$legacyConfigPath = Join-Path $privateDirectory 'telemetry-lab.config.json'
$repoConfigPath = Join-Path $PSScriptRoot 'telemetry-lab.config.json'
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
# Configuration precedence: live PowerShell env > repo-local ignored JSON
# > API .env.local > API .env > legacy home JSON. No key values are printed.
function Read-LocalJson([string]$path) {
  if (Test-Path -LiteralPath $path -PathType Leaf) {
    return (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json)
  }
  return $null
}
function Read-DotEnv([string]$path,[hashtable]$output) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return }
  foreach ($line in (Get-Content -LiteralPath $path)) {
    if ($line -notmatch '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)
  $plan = $fixture.scenarios.$Scenario
  if ($null -eq $plan) { throw "Scenario not defined in telemetry-lab.scenarios.json: $Scenario" }
  if (@($plan.steps).Count -lt 1) { throw "Scenario has no telemetry steps." }
  $alerts = @($plan.expectedAlerts)
  $shouldPush = ($alerts.Count -gt 0) -and -not $NoPush
  $shouldPusher = -not $NoPusher

  if ($shouldPusher -or $CheckConfig) {
    $fields = @(
      @{name='PUSHER_APP_ID'; field='appId'},
      @{name='PUSHER_KEY'; field='key'},
      @{name='PUSHER_SECRET'; field='secret'},
      @{name='PUSHER_CLUSTER'; field='cluster'}
    )
    $sources = @()
    $missing = @()
    foreach ($setting in $fields) {
      $found = Get-ConfigValue $setting.name 'pusher' $setting.field
      if ($null -eq $found) {
        $missing += $setting.name
      } else {
        $sources += $found.source
        Set-TestEnv $setting.name ([string]$found.value)
      }
    }
    if ($missing.Count -gt 0) {
      if (-not (Test-Path -LiteralPath $repoConfigPath -PathType Leaf)) {
        Copy-Item -LiteralPath $templatePath -Destination $repoConfigPath
      }
      throw ("Missing Pusher settings: {0}. Add them to your existing API .env or edit gitignored {1}. No secrets were sent." -f
        ($missing -join ', '),$repoConfigPath)
    }
    Write-Host ("Pusher configuration auto-detected from: {0}" -f (($sources | Select-Object -Unique) -join ', ')) -ForegroundColor Green
  }
  if ($CheckConfig) {
    Write-Host 'CONFIG CHECK PASS: credentials were resolved without printing them or contacting Pusher/FCM.' -ForegroundColor Green
    return
  }

  if ($shouldPush) {
    $configuredProject = Get-ConfigValue 'THESIS_FCM_PROJECT_ID' 'fcm' 'projectId'
    $projectId = if ($null -ne $configuredProject) { [string]$configuredProject.value } else { 'oil-spill-monitoring-buoy' }
    if ($projectId -ne 'oil-spill-monitoring-buoy') {
      throw 'Safety check: test phone must use oil-spill-monitoring-buoy.'
    }
    $credentialSetting = Get-ConfigValue 'THESIS_FCM_CREDENTIALS_FILE' 'fcm' 'serviceAccountJson'
    if ($null -eq $credentialSetting -or $credentialSetting.value -eq 'AUTO') {
      $credentialSetting = Get-ConfigValue 'GOOGLE_APPLICATION_CREDENTIALS' 'fcm' 'serviceAccountJson'
    }
    $credentialPath = if ($null -ne $credentialSetting -and $credentialSetting.value -ne 'AUTO') {
      [Environment]::ExpandEnvironmentVariables([string]$credentialSetting.value)
    } else {
      Join-Path $privateDirectory 'firebase-admin.json'
    }
    if (-not [IO.Path]::IsPathRooted($credentialPath)) {
      $credentialPath = Join-Path $apiRoot $credentialPath
    }
    if (-not (Test-Path -LiteralPath $credentialPath -PathType Leaf)) {
      throw ('Firebase Admin JSON not found: '+$credentialPath+'. Put it in $HOME\secure\oilspill\firebase-admin.json or configure THESIS_FCM_CREDENTIALS_FILE in .env.')
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
    if ($key -eq 'THESIS_FCM_TEST_TOKEN') {
      # Never leave a phone registration token in the current terminal after a run.
      [Environment]::SetEnvironmentVariable($key,$null,'Process')
    }
    else {
      [Environment]::SetEnvironmentVariable($key,$previous[$key],'Process')
    }
  }
}
) { continue }
    $key = $Matches[1]
    $value = $Matches[2].Trim()
    if ($value.Length -ge 2 -and (($value[0] -eq '"' -and $value[$value.Length-1] -eq '"') -or
      ($value[0] -eq "'" -and $value[$value.Length-1] -eq "'"))) {
      $value = $value.Substring(1,$value.Length-2)
    } else {
      $value = ($value -replace '\s+#.*
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
    if ($key -eq 'THESIS_FCM_TEST_TOKEN') {
      # Never leave a phone registration token in the current terminal after a run.
      [Environment]::SetEnvironmentVariable($key,$null,'Process')
    }
    else {
      [Environment]::SetEnvironmentVariable($key,$previous[$key],'Process')
    }
  }
}
, '').Trim()
    }
    $output[$key] = $value
  }
}
$dotenv = @{}
Read-DotEnv (Join-Path $apiRoot '.env') $dotenv
Read-DotEnv (Join-Path $apiRoot '.env.local') $dotenv
$repoConfig = Read-LocalJson $repoConfigPath
$legacyConfig = Read-LocalJson $legacyConfigPath
function Get-ConfigValue([string]$environmentKey,[string]$section,[string]$field) {
  $candidates = @(
    @{value=[Environment]::GetEnvironmentVariable($environmentKey,'Process'); source='PowerShell environment'}
  )
  if ($null -ne $repoConfig) {
    $sectionValue = $repoConfig.PSObject.Properties[$section]
    if ($null -ne $sectionValue) {
      $fieldValue = $sectionValue.Value.PSObject.Properties[$field]
      if ($null -ne $fieldValue) {
        $candidates += @{value=[string]$fieldValue.Value; source='repo-local config'}
      }
    }
  }
  if ($dotenv.ContainsKey($environmentKey)) {
    $candidates += @{value=[string]$dotenv[$environmentKey]; source='API .env'}
  }
  if ($null -ne $legacyConfig) {
    $sectionValue = $legacyConfig.PSObject.Properties[$section]
    if ($null -ne $sectionValue) {
      $fieldValue = $sectionValue.Value.PSObject.Properties[$field]
      if ($null -ne $fieldValue) {
        $candidates += @{value=[string]$fieldValue.Value; source='existing home config'}
      }
    }
  }
  foreach ($candidate in $candidates) {
    $value = [string]$candidate.value
    if ($field -eq 'serviceAccountJson' -and $value -eq 'AUTO') { continue }
    if (-not (Is-Placeholder $value)) {
      return $candidate
    }
  }
  return $null
}
$secureToken = $null
$ptr = [IntPtr]::Zero
try {
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
    if ($key -eq 'THESIS_FCM_TEST_TOKEN') {
      # Never leave a phone registration token in the current terminal after a run.
      [Environment]::SetEnvironmentVariable($key,$null,'Process')
    }
    else {
      [Environment]::SetEnvironmentVariable($key,$previous[$key],'Process')
    }
  }
}
