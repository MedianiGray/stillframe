param(
  [string]$Url = "http://127.0.0.1:8080",
  [int]$Rounds = 3,
  [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = "Stop"
$Url = $Url.TrimEnd("/")

Write-Host "预热目标：$Url" -ForegroundColor Cyan

# 1) 等容器健康：冷启动时 nginx 起得快，但镜像首次拉取可能要几十秒。
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
  try {
    $null = Invoke-WebRequest "$Url/healthz" -UseBasicParsing -TimeoutSec 3
    break
  } catch {
    Start-Sleep -Milliseconds 800
  }
}
try {
  $null = Invoke-WebRequest "$Url/healthz" -UseBasicParsing -TimeoutSec 3
} catch {
  Write-Host "健康检查未通过，先 docker compose -f deploy/docker-compose.yml up -d" -ForegroundColor Red
  exit 1
}

# 2) 找出首页真正引用的 JS/CSS，避免瞎猜文件名。
$index = Invoke-WebRequest "$Url/" -UseBasicParsing -TimeoutSec 5
$assets = [regex]::Matches($index.Content, '(?:src|href)="([^"]+)"') |
  ForEach-Object { $_.Groups[1].Value } |
  Where-Object { $_ -match '/assets/' } |
  ForEach-Object { if ($_ -match '^https?://') { $_ } else { "$Url/$($_.TrimStart('./','/'))" } } |
  Select-Object -Unique

$targets = @("$Url/", "$Url/quick.html", "$Url/tessdata/eng.traineddata.gz", "$Url/tessdata/chi_sim.traineddata.gz") + $assets

# 3) 多轮请求：第一轮把静态资源读进页缓存/内核缓存，第二、三轮就是学生实际看到的延迟。
$rows = @()
for ($round = 1; $round -le $Rounds; $round++) {
  foreach ($target in $targets) {
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
      # 语言包只取前 1KB，够触发磁盘读取又不用每次搬几十 MB。
      if ($target -match '/tessdata/') {
        $null = Invoke-WebRequest $target -UseBasicParsing -TimeoutSec 15 -Headers @{ Range = "bytes=0-1023" }
      } else {
        $null = Invoke-WebRequest $target -UseBasicParsing -TimeoutSec 15
      }
      $watch.Stop()
      $rows += [pscustomobject]@{
        Round = $round
        Target = $target.Replace($Url, "")
        Ms = [int]$watch.Elapsed.TotalMilliseconds
        Ok = $true
      }
    } catch {
      $watch.Stop()
      $rows += [pscustomobject]@{
        Round = $round
        Target = $target.Replace($Url, "")
        Ms = [int]$watch.Elapsed.TotalMilliseconds
        Ok = $false
      }
    }
  }
}

$rows | Format-Table -AutoSize | Out-String -Width 200 | Write-Host

$first = ($rows | Where-Object { $_.Round -eq 1 -and $_.Ok } | Measure-Object Ms -Average).Average
$last = ($rows | Where-Object { $_.Round -eq $Rounds -and $_.Ok } | Measure-Object Ms -Average).Average
if ($null -ne $first -and $null -ne $last) {
  Write-Host ("首轮平均 {0:N0} ms → 预热后 {1:N0} ms" -f $first, $last) -ForegroundColor Green
}
