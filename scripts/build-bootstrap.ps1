$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw 'The Windows .NET Framework C# compiler is required.' }
$destination = Join-Path $PSScriptRoot '../build/bootstrap'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$icon = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../packages/branding/connected-w.ico'))
$package = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '../package.json') | ConvertFrom-Json
$version = [string]$package.version
if ($version -notmatch '\A[0-9]+\.[0-9]+\.[0-9]+\z') { throw 'The installer requires a numeric major.minor.patch package version.' }
$output = [IO.Path]::GetFullPath((Join-Path $destination ($version + '.exe')))
$source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'installer/Bootstrap.cs'))
& $compiler /nologo /target:winexe /optimize+ /codepage:65001 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.Net.Http.dll "/win32icon:$icon" "/out:$output" $source
if ($LASTEXITCODE -ne 0) { throw 'Bootstrap compilation failed.' }
