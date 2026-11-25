# 版本号一键提升 / 一致性校验（Sticky Kee 发版唯一入口）
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\bump-version.ps1              # 只读校验：打印四处版本，不一致则退出码 1
#   powershell -ExecutionPolicy Bypass -File scripts\bump-version.ps1 1.5.4        # 提升到 1.5.4：versionCode 自动 +1，四处一次改完
#   powershell -ExecutionPolicy Bypass -File scripts\bump-version.ps1 +0.0.1       # 迭代：在当前版本基础上增量 +0.0.1（patch 自增）
#
# 为什么必须有这个脚本：版本号分散在 4 个文件，历史上多次漏改——
#   漏 app_version.txt       -> Docker 里 sidecar 缺失，/app/info fallback 后端版本，客户端收不到更新提示
#   漏 health_prefs.go       -> 同上的 fallback 值本身也是旧的，双重漏改时服务端永远报旧版本
#   versionCode 不递增       -> 覆盖安装行为异常 / 应用商店式更新识别失败
# 本脚本保证四处原子一致；改完务必执行 scripts\build-apk.ps1 出包。

param(
    [Parameter(Position = 0)]
    [string]$Version
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

# 无 BOM UTF-8 写入（PS5 的 Set-Content -Encoding UTF8 会带 BOM，Go 源文件/JSON 均应避免）
function Write-Utf8NoBom([string]$Path, [string]$Text) {
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

# ---- 四处版本定义：顺序即发版核对顺序，勿增删漏项 ----
# pattern 统一三组捕获：1=字段前缀 2=旧版本号 3=结尾后缀（引号）
$targets = @(
    @{ Name = '前端 package.json'; Path = Join-Path $root 'app\package.json'
       Pattern = '(?m)^(\s*"version"\s*:\s*")([^"]+)(")'; Group = 'version' }
    @{ Name = 'APK build.gradle';  Path = Join-Path $root 'apk\android\app\build.gradle'
       Pattern = '(?m)^(\s*versionName\s+")([^"]+)(")'; Group = 'version' }
    @{ Name = '后端 Version 常量'; Path = Join-Path $root 'server\internal\api\handler\health_prefs.go'
       Pattern = '(?m)^(const Version = ")([^"]+)(")'; Group = 'version' }
    @{ Name = 'APK 版本 sidecar';  Path = Join-Path $root 'release\app_version.txt'
       Pattern = $null; Group = 'sidecar' }
)
$gradleCodePattern = '(?m)^(\s*versionCode\s+)(\d+)'

# ---- 读取四处当前值 ----
function Get-Current([hashtable]$T) {
    if ($T.Group -eq 'sidecar') {
        return ([System.IO.File]::ReadAllText($T.Path)).Trim()
    }
    $txt = [System.IO.File]::ReadAllText($T.Path)
    $m = [regex]::Match($txt, $T.Pattern)
    if (-not $m.Success) { throw "无法在 $($T.Path) 中匹配版本字段" }
    return $m.Groups[2].Value  # 捕获组 2 = 旧版本号
}

$current = @{}
foreach ($t in $targets) { $current[$t.Name] = Get-Current $t }
$gradleTxt = [System.IO.File]::ReadAllText((Join-Path $root 'apk\android\app\build.gradle'))
$codeMatch = [regex]::Match($gradleTxt, $gradleCodePattern)
if (-not $codeMatch.Success) { throw '无法在 build.gradle 中匹配 versionCode' }
$currentCode = [int]$codeMatch.Groups[2].Value

Write-Host '当前版本：'
foreach ($t in $targets) { Write-Host ("  {0,-18} {1}" -f $t.Name, $current[$t.Name]) }
Write-Host ("  {0,-18} {1}" -f 'versionCode', $currentCode)

# ---- 只读校验模式 ----
if (-not $Version) {
    $names = @($current.Values | Select-Object -Unique)
    $codeOk = $currentCode -gt 0
    if ($names.Count -eq 1 -and $codeOk) {
        Write-Host "`n[OK] 四处版本号一致：$($names[0])；versionCode=$currentCode" -ForegroundColor Green
        exit 0
    }
    Write-Host "`n[FAIL] 版本号不一致或 versionCode 异常，发版前必须先提升：" -ForegroundColor Red
    Write-Host "       powershell -ExecutionPolicy Bypass -File scripts\bump-version.ps1 <新版本>" -ForegroundColor Yellow
    exit 1
}

# ---- 提升模式：校验入参语义版本 ----
if ($Version -notmatch '^\d+\.\d+\.\d+$' -and $Version -notmatch '^\+\d+\.\d+\.\d+$') {
    throw "版本号格式必须为 x.y.z（如 1.5.4）或 +x.y.z（增量，如 +0.0.1），收到：$Version"
}
$names = @($current.Values | Select-Object -Unique)
if ($names.Count -ne 1) {
    throw "当前四处版本本身不一致（$($names -join ' / ')），请先手工修正或核对后再提升"
}
$old = $names[0]
# 增量语法：+x.y.z = 当前版本逐段相加（+0.0.1 即 patch 自增一次）
if ($Version.StartsWith('+')) {
    $o = $old.Split('.') | ForEach-Object { [int]$_ }
    $d = $Version.TrimStart('+').Split('.') | ForEach-Object { [int]$_ }
    $Version = "$($o[0] + $d[0]).$($o[1] + $d[1]).$($o[2] + $d[2])"
    Write-Host "增量 +$($d[0]).$($d[1]).$($d[2]) → 目标版本 $Version"
}
# 逐段数值比较，禁止降级 / 同号
function Compare-Ver([string]$A, [string]$B) {
    $pa = $A.Split('.') | ForEach-Object { [int]$_ }
    $pb = $B.Split('.') | ForEach-Object { [int]$_ }
    for ($i = 0; $i -lt 3; $i++) { if ($pb[$i] -ne $pa[$i]) { return ($pb[$i] - $pa[$i]) } }
    return 0
}
$cmp = Compare-Ver $old $Version
if ($cmp -eq 0) { throw "$Version 与当前版本相同，无需提升" }
if ($cmp -lt 0)  { throw "不能从 $old 降级到 $Version" }
$newCode = $currentCode + 1

# ---- 逐文件改写 ----
foreach ($t in $targets) {
    if ($t.Group -eq 'sidecar') {
        Write-Utf8NoBom $t.Path $Version
    } else {
        $txt = [System.IO.File]::ReadAllText($t.Path)
        # 捕获组：1=字段前缀 2=旧版本号 3=结尾后缀，仅替换中间段
        $txt = [regex]::Replace($txt, $t.Pattern, { param($m) $m.Groups[1].Value + $Version + $m.Groups[3].Value }, 1)
        Write-Utf8NoBom $t.Path $txt
    }
}
# versionCode +1（只在 build.gradle，与上面 versionName 同文件，重新读改写后的文本）
$gp = Join-Path $root 'apk\android\app\build.gradle'
$txt = [System.IO.File]::ReadAllText($gp)
$txt = [regex]::Replace($txt, $gradleCodePattern, { param($m) $m.Groups[1].Value + $newCode }, 1)
Write-Utf8NoBom $gp $txt

# ---- 改后回读交叉校验 ----
$after = @{}
foreach ($t in $targets) { $after[$t.Name] = Get-Current $t }
$bad = @($after.Values | Select-Object -Unique)
if ($bad.Count -ne 1 -or $bad[0] -ne $Version) {
    throw "提升后回读校验失败：$($after.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" } | Out-String)"
}

Write-Host "`n[OK] 版本已提升：$old -> $Version；versionCode $currentCode -> $newCode" -ForegroundColor Green
Write-Host '下一步：powershell -ExecutionPolicy Bypass -File scripts\build-apk.ps1' -ForegroundColor Cyan
