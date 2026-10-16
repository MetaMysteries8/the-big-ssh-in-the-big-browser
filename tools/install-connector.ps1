[CmdletBinding()]
param(
  [ValidateSet('Chrome', 'Chromium', 'Edge')]
  [string]$Browser = 'Chrome',
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$nativeName = 'io.bigssh.connector'
$browserKey = switch ($Browser) {
  'Chrome' { 'Google\Chrome' }
  'Chromium' { 'Chromium' }
  'Edge' { 'Microsoft\Edge' }
}
$registryPath = "HKCU:\Software\$browserKey\NativeMessagingHosts\$nativeName"
$manifestDirectory = Join-Path $projectRoot '.bigssh/native-hosts'
$manifestPath = Join-Path $manifestDirectory "$Browser.json"
if ($Uninstall) {
  if (Test-Path -LiteralPath $registryPath) {
    $registered = (Get-Item -LiteralPath $registryPath).GetValue('')
    if ($registered -ne $manifestPath) { throw 'Registration belongs to another installation; refusing to remove it.' }
    Remove-Item -LiteralPath $registryPath
  }
  if (Test-Path -LiteralPath $manifestPath) { Remove-Item -LiteralPath $manifestPath }
  Write-Output "Removed this project's $Browser native-host registration."
  exit
}
$binaryPath = Join-Path $projectRoot 'dist/connector/bigssh-connector.exe'
if (-not (Test-Path -LiteralPath $binaryPath)) { throw 'Build the project with npm run build first.' }
if (Test-Path -LiteralPath $registryPath) {
  $registered = (Get-Item -LiteralPath $registryPath).GetValue('')
  if ($registered -ne $manifestPath) { throw 'A different connector is already registered. Remove it explicitly before installing this build.' }
}
$manifest = [ordered]@{
  name = $nativeName
  description = 'Big SSH local TCP connector'
  path = $binaryPath
  type = 'stdio'
  allowed_origins = @('chrome-extension://knpoojnkejjdmoanfjjhmhfbgjhppepi/')
}
New-Item -ItemType Directory -Path $manifestDirectory -Force | Out-Null
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
New-Item -Path $registryPath -Force | Out-Null
Set-Item -LiteralPath $registryPath -Value $manifestPath
Write-Output "Registered $Browser connector for the current user. No administrator rights or listening service are required."
Write-Output 'Load dist/extension as an unpacked extension. Its development ID is knpoojnkejjdmoanfjjhmhfbgjhppepi.'
