$ErrorActionPreference = "Stop"

$legacyVersion = "0.1.10"
$legacyInstaller = Join-Path $env:RUNNER_TEMP "MenueQR-Bridge-$legacyVersion-Setup.exe"
$legacyUrl = "https://github.com/Trillianti/menueqr-bridge/releases/download/bridge-v$legacyVersion/MenueQR-Bridge-$legacyVersion-Setup.exe"
$currentInstaller = Get-ChildItem -Path "release" -Filter "MenueQR-Bridge-*-Setup.exe" -File
if ($currentInstaller.Count -ne 1) {
  throw "Expected exactly one current Bridge installer."
}
$expectedVersion = (Get-Content "package.json" -Raw | ConvertFrom-Json).version
$productName = "MenüQR Bridge"
$actualInstallDirectory = $null
$applicationData = Join-Path $env:APPDATA $productName
$localApplicationData = Join-Path $env:LOCALAPPDATA $productName
$sentinel = Join-Path $applicationData "runtime\upgrade-preservation-sentinel.txt"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\fa999f8c-0eb7-5ae9-82c1-d723c3d6e5fa"
$runSentinel = '"C:\MenuQrUpgradeSentinel.exe" --preserve-me'

function Invoke-BridgeInstaller([string] $Path, [string[]] $Arguments) {
  $process = Start-Process -FilePath $Path -ArgumentList $Arguments -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Bridge installer failed with exit code $($process.ExitCode)."
  }
}

try {
  Invoke-WebRequest -Uri $legacyUrl -OutFile $legacyInstaller
  Invoke-BridgeInstaller $legacyInstaller @("/S", "/currentuser")

  New-Item -Path (Split-Path $sentinel) -ItemType Directory -Force | Out-Null
  Set-Content -Path $sentinel -Value "preserve-this-data" -NoNewline
  New-Item -Path $runKey -Force | Out-Null
  New-ItemProperty -Path $runKey -Name $productName -Value $runSentinel -PropertyType String -Force | Out-Null

  Invoke-BridgeInstaller $currentInstaller.FullName @("/S", "--updated", "/currentuser")

  if ((Get-Content $sentinel -Raw) -ne "preserve-this-data") {
    throw "Bridge userData sentinel was not preserved during update."
  }
  $preservedRunValue = (Get-ItemProperty -Path $runKey -Name $productName).$productName
  if ($preservedRunValue -ne $runSentinel) {
    throw "Bridge autostart value was not preserved during update."
  }
  $installedRegistration = Get-ItemProperty -Path $uninstallKey
  $installedVersion = $installedRegistration.DisplayVersion
  if ($installedVersion -ne $expectedVersion) {
    throw "Expected installed version $expectedVersion, received $installedVersion."
  }
  $actualInstallDirectory = $installedRegistration.InstallLocation
  if (
    -not $actualInstallDirectory -or
    -not (Test-Path (Join-Path $actualInstallDirectory "resources\app.asar"))
  ) {
    throw "Updated Bridge application files are missing from InstallLocation."
  }
  Write-Output "Verified Bridge $legacyVersion -> $expectedVersion update with preserved userData and autostart."
}
finally {
  & "$env:SystemRoot\System32\taskkill.exe" /F /IM "$productName.exe" 2>$null | Out-Null
  if (-not $actualInstallDirectory -and (Test-Path $uninstallKey)) {
    $actualInstallDirectory = (Get-ItemProperty -Path $uninstallKey).InstallLocation
  }
  if ($actualInstallDirectory) {
    Remove-Item -Path $actualInstallDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -Path $applicationData -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -Path $localApplicationData -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -Path $uninstallKey -Recurse -Force -ErrorAction SilentlyContinue
  Remove-ItemProperty -Path $runKey -Name $productName -Force -ErrorAction SilentlyContinue
  Remove-Item -Path $legacyInstaller -Force -ErrorAction SilentlyContinue
}
