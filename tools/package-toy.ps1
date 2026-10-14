$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $projectRoot 'release'
$stageDir = Join-Path $releaseDir 'bilibili-toy'
$archivePath = Join-Path $releaseDir '尾迹-临界航线-B站Toy.zip'

New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

if (Test-Path -LiteralPath $stageDir) {
    $resolvedStage = [System.IO.Path]::GetFullPath($stageDir)
    $resolvedRelease = [System.IO.Path]::GetFullPath($releaseDir)
    if (-not $resolvedStage.StartsWith($resolvedRelease + [System.IO.Path]::DirectorySeparatorChar)) {
        throw '拒绝清理项目发布目录之外的路径。'
    }
    Remove-Item -LiteralPath $stageDir -Recurse -Force
}

New-Item -ItemType Directory -Path $stageDir | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'index.html') -Destination $stageDir
Copy-Item -LiteralPath (Join-Path $projectRoot 'style.css') -Destination $stageDir
Copy-Item -LiteralPath (Join-Path $projectRoot 'game.js') -Destination $stageDir
Copy-Item -LiteralPath (Join-Path $projectRoot 'audio') -Destination $stageDir -Recurse

if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
}

Compress-Archive -Path (Join-Path $stageDir '*') -DestinationPath $archivePath -CompressionLevel Optimal
Write-Host "B 站 Toy 上传包已生成：$archivePath"
