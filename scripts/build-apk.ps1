# APK 一键构建（Sticky Kee 发版标准链路，已固化本项目全部踩坑参数）
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\build-apk.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\build-apk.ps1 -SkipWeb   # 前端未改，跳过 npm build
#
# 链路（与手动操作完全等价，每步失败即停）：
#   1. app 前端 vite build              -> app\dist
#   2. robocopy /MIR 镜像               -> apk\www（Capacitor webDir，APK 内置完整前端）
#   3. robocopy /MIR 镜像               -> apk\android\app\src\main\assets\public（gradle 实际打包目录）
#   4. gradlew assembleRelease          -> app-release.apk（仓库统一 keystore 签名，可直接覆盖安装）
#   5. 分发固定名 APK 到两个交付位置：
#        apk\android\release\stickykee-app.apk   （工程交付副本）
#        release\stickykee-app.apk               （Docker 构建唯一输入，/app/download 下发源）
#
# 前置：已执行 bump-version.ps1 <新版本>（四处版本号一致）；本脚本不负责改版本号。

param(
    [switch]$SkipWeb
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$JAVA_HOME_FIXED = 'C:\Users\Administrator\.local\share\android-build\jdk-17.0.2'

function Fail([string]$Msg) { Write-Host "`n[FAIL] $Msg" -ForegroundColor Red; exit 1 }

# ---- 前置校验：JDK 17 ----
if (-not (Test-Path (Join-Path $JAVA_HOME_FIXED 'bin\java.exe'))) {
    Fail "JDK 17 不存在：$JAVA_HOME_FIXED（gradlew 必需）"
}
$env:JAVA_HOME = $JAVA_HOME_FIXED
$env:Path = "$JAVA_HOME_FIXED\bin;$env:Path"

# ---- 前置校验：版本四处一致（防止漏 bump 就出包）----
Write-Host '== 版本一致性校验 ==' -ForegroundColor Cyan
& (Join-Path $root 'scripts\bump-version.ps1')
if ($LASTEXITCODE -ne 0) { Fail '版本号不一致：先执行 scripts\bump-version.ps1 <新版本>' }

# ---- 1. 前端构建 ----
if (-not $SkipWeb) {
    Write-Host "`n== [1/5] 前端 vite build ==" -ForegroundColor Cyan
    Push-Location (Join-Path $root 'app')
    try {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { Fail 'npm run build 失败' }
        if (-not (Test-Path (Join-Path $root 'app\dist\index.html'))) { Fail 'app\dist\index.html 缺失，构建异常' }
    } finally { Pop-Location }
} else {
    Write-Host "`n== [1/5] 前端构建（-SkipWeb 跳过）==" -ForegroundColor DarkGray
}

# ---- 2/3. 两步镜像（robocopy 退出码 <8 均为成功：1=有复制 2=有清理 3=两者都有）----
function Mirror([string]$Src, [string]$Dst) {
    if (-not (Test-Path $Src)) { Fail "镜像源不存在：$Src" }
    robocopy $Src $Dst /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { Fail "robocopy 失败（code $LASTEXITCODE）：$Src -> $Dst" }
    Write-Host ("  镜像成功（code {0}）：{1} -> {2}" -f $LASTEXITCODE, $Src, $Dst)
    $global:LASTEXITCODE = 0
}
Write-Host "`n== [2/5] 镜像 dist -> apk\www ==" -ForegroundColor Cyan
Mirror (Join-Path $root 'app\dist') (Join-Path $root 'apk\www')
Write-Host "`n== [3/5] 镜像 www -> android assets\public ==" -ForegroundColor Cyan
Mirror (Join-Path $root 'apk\www') (Join-Path $root 'apk\android\app\src\main\assets\public')

# ---- 4. Gradle assembleRelease ----
Write-Host "`n== [4/5] gradlew assembleRelease ==" -ForegroundColor Cyan
Push-Location (Join-Path $root 'apk\android')
try {
    & .\gradlew.bat assembleRelease --console=plain
    if ($LASTEXITCODE -ne 0) { Fail 'gradlew assembleRelease 失败' }
} finally { Pop-Location }

$built = Join-Path $root 'apk\android\app\build\outputs\apk\release\app-release.apk'
if (-not (Test-Path $built)) { Fail "构建产物不存在：$built" }

# ---- 5. 分发到两个固定交付路径 ----
Write-Host "`n== [5/5] 分发 APK ==" -ForegroundColor Cyan
$dst1 = Join-Path $root 'apk\android\release\stickykee-app.apk'
$dst2 = Join-Path $root 'release\stickykee-app.apk'
New-Item -ItemType Directory -Force (Split-Path $dst1) | Out-Null
New-Item -ItemType Directory -Force (Split-Path $dst2) | Out-Null
Copy-Item $built $dst1 -Force
Copy-Item $built $dst2 -Force

# ---- 结果汇总 ----
$ver = ([System.IO.File]::ReadAllText((Join-Path $root 'release\app_version.txt'))).Trim()
$f = Get-Item $dst2
Write-Host "`n[OK] APK 构建完成" -ForegroundColor Green
Write-Host ("  版本：{0}" -f $ver)
Write-Host ("  产物：{0}" -f $dst2)
Write-Host ("  大小：{0:N2} MB" -f ($f.Length / 1MB))
Write-Host ("  时间：{0:yyyy-MM-dd HH:mm:ss}" -f $f.LastWriteTime)
Write-Host "`n部署提醒：提交推送后在服务器执行 bash /vol2/homecanvas/runner.sh（git pull + docker build）" -ForegroundColor Yellow
