# Build the submission video from captured frames.
#
# Structure: title card -> storyboard (profiles FIRST, then dating, then
# rankings) -> method card -> end card with the links. Each still gets a slow
# Ken Burns move so it reads as a walkthrough, and every frame carries a burned
# caption so the video is understandable without audio.
#
# Runtime is asserted under the 3-minute limit with ffprobe.
param(
  [string]$Frames = "artifacts/frames",
  [string]$Out    = "artifacts/agents-date-demo.mp4",
  [int]$fpsVal = 30
)

$ErrorActionPreference = "Stop"

# Run ffmpeg and surface its stderr instead of swallowing it, so a filter error
# is diagnosable rather than a bare "failed" throw.
#
# ffmpeg prints its version banner and progress on stderr even on success.
# Under -ErrorActionPreference Stop, PowerShell promotes that stderr to a
# terminating NativeCommandError, so the run dies on the banner before ffmpeg
# starts working. Relax the preference for the call and judge success by the
# exit code, which is the only reliable signal here.
function Invoke-FF([string[]]$ffArgs, [string]$label) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $log = & ffmpeg @ffArgs 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  if ($code -ne 0) {
    $tail = ($log | Select-Object -Last 6) -join "`n"
    throw "ffmpeg failed for ${label} (exit ${code}):`n$tail"
  }
}

# Order matches the required narrative: profile pages FIRST, then the agents
# dating, then rankings, then how it works.
$story = @(
  @{ file = "00.png"; seconds = 6;  caption = "26 agents. 19 dates. Every claim cited to a source line." },
  @{ file = "01.png"; seconds = 7;  caption = "Profile FIRST: hobbies, interests, needs - each quote traced to its source line" },
  @{ file = "02.png"; seconds = 6;  caption = "A second person, read only from their own two profiles" },
  @{ file = "03.png"; seconds = 11; caption = "The agents actually date. Real transcripts - every turn grounded in evidence" },
  @{ file = "04.png"; seconds = 8;  caption = "Ranked shortlist, scored on 5 weighted factors with reasons" },
  @{ file = "05.png"; seconds = 7;  caption = "Rankings are DIRECTED - each person gets a different order" },
  @{ file = "06.png"; seconds = 6;  caption = "Measured limits: LinkedIn blocks bots, Instagram needs a token" },
  @{ file = "07.png"; seconds = 5;  caption = "Paste your own two links to run it yourself" }
)

$titleSeconds = 6
$endSeconds = 7
$total = $titleSeconds + ($story | ForEach-Object { $_.seconds } | Measure-Object -Sum).Sum + $endSeconds
if ($total -gt 175) { throw "Storyboard is ${total}s, over the 175s safety budget" }

New-Item -ItemType Directory -Path (Split-Path $Out) -Force | Out-Null
$tmp = Join-Path $env:TEMP ("ad-vid-" + [guid]::NewGuid().ToString("N").Substring(0,8))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

$font = "C\:/Windows/Fonts/segoeuib.ttf"
$fontR = "C\:/Windows/Fonts/segoeui.ttf"
$parts = @()

try {
  # --- title card ----------------------------------------------------------
  $t = Join-Path $tmp "seg-title.mp4"
  $vfTitle = @(
    "color=c=0x07070b:s=1600x900:d=$($titleSeconds):r=$($fpsVal)",
    "drawtext=fontfile='$font':text='Agents Date':fontcolor=white:fontsize=82:x=(w-text_w)/2:y=h/2-140",
    "drawtext=fontfile='$fontR':text='Every profile has an agent. The agents date on their behalf.':fontcolor=0xff4d6d:fontsize=34:x=(w-text_w)/2:y=h/2-20",
    "drawtext=fontfile='$fontR':text='Two public profiles in. Needs, hobbies and interests - every claim cited.':fontcolor=0x9a9ab0:fontsize=27:x=(w-text_w)/2:y=h/2+36",
    "format=yuv420p"
  ) -join ","
  Invoke-FF @("-y","-f","lavfi","-i",$vfTitle,"-t","$titleSeconds","-c:v","libx264","-preset","medium","-crf","21","-r","$fpsVal",$t) "title"
  if ($LASTEXITCODE -ne 0) { throw "title card failed" }
  $parts += $t

  # --- storyboard ----------------------------------------------------------
  $i = 0
  foreach ($s in $story) {
    $src = Join-Path $Frames $s.file
    if (-not (Test-Path $src)) { throw "Missing frame $($s.file)" }
    $seg = Join-Path $tmp ("seg{0:d2}.mp4" -f $i)

    # Scale beyond the output so zoompan has pixels to crop without losing the
    # header, then ease in. Keep the pan expression simple and centred: nested
    # quotes plus PowerShell array-arg passing is fragile.
    $dur = $s.seconds * $fpsVal
    # Literal pixel coordinates, not h-relative: drawbox with y=h-104 silently
    # failed to paint after zoompan. The bar colour must also be clearly darker
    # than the site's card background (#13131c) or it looks transparent.
    $vf = "scale=1900:1070:flags=lanczos,zoompan=z='min(zoom+0.00028,1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${dur}:s=1600x900:fps=${fpsVal},drawbox=x=0:y=796:w=1600:h=104:color=0x030307:t=fill,drawtext=fontfile='${fontR}':text='$($s.caption)':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=826:shadowcolor=black@0.8:shadowx=2:shadowy=2,format=yuv420p"
    Invoke-FF @("-y","-loop","1","-framerate","$fpsVal","-i",$src,"-t","$($s.seconds)","-vf",$vf,"-c:v","libx264","-preset","medium","-crf","21","-r","$fpsVal",$seg) $s.file
    $parts += $seg
    Write-Output ("built segment {0} ({1}s) {2}" -f $i, $s.seconds, $s.file)
    $i++
  }

  # --- end card ------------------------------------------------------------
  $e = Join-Path $tmp "seg-end.mp4"
  $vfEnd = @(
    "color=c=0x07070b:s=1600x900:d=$($endSeconds):r=$($fpsVal)",
    "drawtext=fontfile='$font':text='Try it yourself':fontcolor=white:fontsize=58:x=(w-text_w)/2:y=h/2-190",
    "drawtext=fontfile='$fontR':text='Live site  -  agents-date.onrender.com':fontcolor=0x7c5cff:fontsize=32:x=(w-text_w)/2:y=h/2-90",
    "drawtext=fontfile='$fontR':text='Prebuilt demo  -  agents-date.onrender.com/demo':fontcolor=0x7c5cff:fontsize=32:x=(w-text_w)/2:y=h/2-30",
    "drawtext=fontfile='$fontR':text='Code  -  github.com/Vedant817/agents-date':fontcolor=0x7c5cff:fontsize=32:x=(w-text_w)/2:y=h/2+30",
    "drawtext=fontfile='$fontR':text='AI-simulated conversations from public profiles. Not statements by the people shown.':fontcolor=0x6a6a80:fontsize=23:x=(w-text_w)/2:y=h/2+150",
    "format=yuv420p"
  ) -join ","
  Invoke-FF @("-y","-f","lavfi","-i",$vfEnd,"-t","$endSeconds","-c:v","libx264","-preset","medium","-crf","21","-r","$fpsVal",$e) "end"
  if ($LASTEXITCODE -ne 0) { throw "end card failed" }
  $parts += $e

  # --- concat --------------------------------------------------------------
  $listFile = Join-Path $tmp "list.txt"
  ($parts | ForEach-Object { "file '$_'" }) -join "`n" | Set-Content -Path $listFile -Encoding ascii
  Invoke-FF @("-y","-f","concat","-safe","0","-i",$listFile,"-c","copy",$Out) "concat"

  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { $dur = & ffprobe -v error -show_entries format=duration -of csv=p=0 $Out } finally { $ErrorActionPreference = $previous }
  Write-Output ("DONE {0} duration={1}s" -f $Out, [math]::Round([double]$dur, 1))
  if ([double]$dur -gt 180) { throw "Video is $([math]::Round([double]$dur,1))s, over the 3-minute limit" }
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
