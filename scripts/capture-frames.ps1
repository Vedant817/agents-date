# Capture the demo storyboard with headless Chrome.
#
# Uses Start-Process rather than node's spawn: on Windows, Chrome's
# --screenshot writes nothing when launched from node, but works from
# Start-Process with redirected stderr.
param(
  [string]$Base = "http://localhost:3114",
  [string]$Out  = "artifacts/frames",
  [int]$Width = 1600,
  [int]$Height = 900
)

$ErrorActionPreference = "Stop"
$chrome = @(
  $env:CHROME_PATH,
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $chrome) { throw "Chrome/Edge not found" }

New-Item -ItemType Directory -Path $Out -Force | Out-Null
Get-ChildItem $Out -Filter *.png -ErrorAction SilentlyContinue | Remove-Item -Force

# Chrome resolves a relative --screenshot path against its own working
# directory, not the caller's, so the path must be absolute or frames are
# silently written nowhere.
$OutAbs = (Resolve-Path $Out).Path

# url, note
$steps = @(
  @{ url = "/demo";                                 note = "cohort" },
  @{ url = "/demo?view=profiles&person=p1";         note = "profile-1" },
  @{ url = "/demo?view=profiles&person=p25";        note = "profile-2" },
  @{ url = "/demo?view=dates";                      note = "dates" },
  @{ url = "/demo?view=rankings&person=p1";        note = "rankings-a" },
  @{ url = "/demo?view=rankings&person=p2";        note = "rankings-b" },
  @{ url = "/method";                               note = "limits" },
  @{ url = "/";                                     note = "start" }
)

$i = 0
$ok = 0
foreach ($s in $steps) {
  $shot = Join-Path $OutAbs ("{0:d2}.png" -f $i)
  $profile = Join-Path $env:TEMP ("ad-cap-{0}-{1}" -f $i, [guid]::NewGuid().ToString("N").Substring(0,8))
  $url = "$Base$($s.url)"
  $errFile = Join-Path $env:TEMP "ad-cap-err.txt"

  # NOTE: do not name this $args -- that is a reserved automatic variable in
  # PowerShell and assigning to it silently breaks the Chrome invocation.
  $chromeArgs = @(
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--hide-scrollbars",
    "--user-data-dir=$profile",
    "--window-size=$Width,$Height",
    "--force-device-scale-factor=1",
    "--virtual-time-budget=16000",
    "--screenshot=$shot",
    $url
  )

  $p = Start-Process -FilePath $chrome -ArgumentList $chromeArgs -RedirectStandardError $errFile -NoNewWindow -PassThru
  $p | Wait-Process -Timeout 120 -ErrorAction SilentlyContinue
  Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue

  if (Test-Path $shot) {
    $size = (Get-Item $shot).Length
    if ($size -gt 10000) {
      Write-Output ("ok {0} {1} ({2:n0} bytes) <- {3}" -f $i, $s.note, $size, $url)
      $ok++
    } else {
      Write-Output ("SMALL {0} {1} ({2} bytes)" -f $i, $s.note, $size)
    }
  } else {
    Write-Output ("FAILED {0} {1} <- {2}" -f $i, $s.note, $url)
  }
  $i++
}

Write-Output "captured $ok/$($steps.Count) frames -> $Out"
if ($ok -lt $steps.Count) { exit 1 }
