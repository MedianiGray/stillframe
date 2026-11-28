# 把前端构建产物整包同步进 Android 的 WebView assets。
#
# 为什么要有这个脚本：assets 目录是 gitignore 的，本机留着的副本会随着前端迭代慢慢过期。
# 直接 gradlew assembleDebug 打出来的 APK 里可能还是几周前的页面（少了新面板、OCR 语言包、
# 快捷浮窗），排查起来像是「手机端功能莫名缺失」。每次构建前跑一遍，就不会错位。
#
# 用法：
#   powershell -NoProfile -File tools/sync-android-assets.ps1
#   powershell -NoProfile -File tools/sync-android-assets.ps1 -Dist dist -Target android\app\src\main\assets\www

param(
  [string]$Dist = '',
  [string]$Target = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $Dist) { $Dist = Join-Path $root 'dist' }
if (-not $Target) { $Target = Join-Path $root 'android\app\src\main\assets\www' }

if (-not (Test-Path $Dist)) {
  throw "还没有构建产物：$Dist 不存在。先在仓库根目录跑 npm run build。"
}

# dist 里必须有入口页，否则多半是构建断了，别把空目录铺进去
foreach ($f in @('index.html', 'pin.html')) {
  if (-not (Test-Path (Join-Path $Dist $f))) { throw "构建产物缺少 $f，先重跑 npm run build。" }
}

New-Item -ItemType Directory -Force -Path $Target | Out-Null
# 先清空：旧版本的 assets/main-xxxx.js 留着会白占体积，还可能被旧 index.html 引用
Get-ChildItem $Target -Force | Remove-Item -Recurse -Force
Copy-Item (Join-Path $Dist '*') $Target -Recurse -Force

$src = (Get-ChildItem $Dist -Recurse -File | Measure-Object).Count
$dst = (Get-ChildItem $Target -Recurse -File | Measure-Object).Count
$size = [math]::Round(((Get-ChildItem $Target -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
if ($src -ne $dst) { throw "同步不完整：dist $src 个文件，assets $dst 个文件。" }
"已同步 $dst 个文件（$size MB）到 $Target"
