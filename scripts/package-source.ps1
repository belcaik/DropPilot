param([string]$Destination = '')
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path $PSScriptRoot -Parent
if (-not $Destination) { $Destination = Join-Path (Split-Path $projectDirectory -Parent) 'DropPilot-source.zip' }
$Destination = [System.IO.Path]::GetFullPath($Destination)
Add-Type -AssemblyName System.IO.Compression
$stream = [System.IO.File]::Open($Destination, [System.IO.FileMode]::Create)
$archive = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    $files = @()
    foreach ($directory in @('src', 'test', 'e2e', 'scripts', '.github')) {
        $path = Join-Path $projectDirectory $directory
        if (Test-Path -LiteralPath $path) { $files += Get-ChildItem -LiteralPath $path -File -Recurse -Force }
    }
    foreach ($filename in @('package.json', 'package-lock.json', 'README.md', '.gitignore')) {
        $files += Get-Item -LiteralPath (Join-Path $projectDirectory $filename)
    }
    foreach ($file in $files) {
        if ($file.Name -match '\.(session|log)$' -or $file.Name -match '\.session\.json$') { continue }
        $relative = [System.IO.Path]::GetRelativePath($projectDirectory, $file.FullName).Replace('\', '/')
        $entry = $archive.CreateEntry('DropPilot/' + $relative, [System.IO.Compression.CompressionLevel]::Optimal)
        $source = [System.IO.File]::OpenRead($file.FullName)
        $target = $entry.Open()
        try { $source.CopyTo($target) } finally { $source.Dispose(); $target.Dispose() }
    }
} finally { $archive.Dispose(); $stream.Dispose() }
Get-Item -LiteralPath $Destination | Select-Object FullName, Length
