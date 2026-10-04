param([int]$InstallerProcessId, [string]$InstallDirectory, [string]$BackupDirectory)
$ErrorActionPreference = 'Stop'
$backupRoot = [IO.Path]::GetFullPath($BackupDirectory)
$installRoot = [IO.Path]::GetFullPath($InstallDirectory)
$statePath = Join-Path $backupRoot 'state'
$filesRoot = Join-Path $backupRoot 'files'
# This directory is created and populated by the installer, outside the installation.
# A missing ownership marker must never result in recursive cleanup of an arbitrary path.
if (!(Test-Path -LiteralPath (Join-Path $backupRoot 'owned-backup')) -or $backupRoot -eq $installRoot) { exit 2 }
try {
    $registryPaths = [IO.File]::ReadAllLines((Join-Path $backupRoot 'registry'), [Text.Encoding]::Unicode)
    $registrySnapshot = @($registryPaths | ForEach-Object {
        $keyPath = $_
        if (Test-Path -LiteralPath $keyPath) {
            $key = Get-Item -LiteralPath $keyPath
            foreach ($name in $key.GetValueNames()) {
                [pscustomobject]@{ Path = $keyPath; Name = $name; Value = $key.GetValue($name); Kind = [string]$key.GetValueKind($name) }
            }
        }
    })
    $registrySnapshot | Export-Clixml -LiteralPath (Join-Path $backupRoot 'registry-backup.xml')
    $installer = Get-Process -Id $InstallerProcessId -ErrorAction SilentlyContinue
    [IO.File]::WriteAllText((Join-Path $backupRoot 'ready'), 'ready')
    if ($installer) { $installer.WaitForExit() }
    $state = if (Test-Path -LiteralPath $statePath) { [IO.File]::ReadAllText($statePath) } else { '' }
    if ($state -ne 'committed' -and $state -ne 'restored') {
        New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
        Get-ChildItem -LiteralPath $filesRoot -Force | ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination $installRoot -Recurse -Force
        }
        [IO.File]::WriteAllText((Join-Path $backupRoot 'state'), 'restored')
    }
    if ($state -ne 'committed') {
        foreach ($entry in $registrySnapshot) {
            if (!(Test-Path -LiteralPath $entry.Path)) { New-Item -Path $entry.Path -Force | Out-Null }
            New-ItemProperty -LiteralPath $entry.Path -Name $entry.Name -Value $entry.Value -PropertyType $entry.Kind -Force | Out-Null
        }
    }
    # The ownership marker and resolved backup root above identify the only removable tree.
    Remove-Item -LiteralPath $backupRoot -Recurse -Force
} catch {
    [IO.File]::WriteAllText((Join-Path $backupRoot 'recovery-error.txt'), $_.Exception.Message)
    exit 2
}
