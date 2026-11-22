param(
    [Parameter(Mandatory)] [string] $BaseJar,
    [Parameter(Mandatory)] [string] $ServerLibraries,
    [Parameter(Mandatory)] [string] $LiteBansJar,
    [Parameter(Mandatory)] [string] $OutputJar,
    [string] $JavaBin = ''
)
$ErrorActionPreference = 'Stop'
$base = (Resolve-Path -LiteralPath $BaseJar).Path
$libraries = (Resolve-Path -LiteralPath $ServerLibraries).Path
$liteBans = (Resolve-Path -LiteralPath $LiteBansJar).Path
$output = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputJar)
if ($output -eq $base) { throw 'Choose a separate path for the patched JAR.' }
$java = if ($JavaBin) { Join-Path $JavaBin 'java.exe' } else { 'java' }
$javac = if ($JavaBin) { Join-Path $JavaBin 'javac.exe' } else { 'javac' }
$javap = if ($JavaBin) { Join-Path $JavaBin 'javap.exe' } else { 'javap' }
$jar = if ($JavaBin) { Join-Path $JavaBin 'jar.exe' } else { 'jar' }

$temp = Join-Path ([IO.Path]::GetTempPath()) ('jevox-fastfreeze-' + [guid]::NewGuid())
$classes = Join-Path $temp 'classes'
$patcher = Join-Path $temp 'patcher'
[void][IO.Directory]::CreateDirectory($classes)
[void][IO.Directory]::CreateDirectory($patcher)
Push-Location -LiteralPath $classes
try {
    & $jar xf $base
    if ($LASTEXITCODE -ne 0) { throw 'Could not extract the original FastFreeze JAR.' }

    $forbidden = Join-Path $classes 'ru/jevox/check'
    if (Test-Path -LiteralPath $forbidden) { throw 'Use the original, unpatched FastFreeze 1.6.0 JAR.' }
    $jars = @(Get-ChildItem -LiteralPath $libraries -Filter '*.jar' -Recurse | ForEach-Object FullName)
    if (-not $jars) { throw 'The server libraries directory contains no JARs.' }
    $separator = [IO.Path]::PathSeparator
    $classpath = (@($classes, $liteBans) + $jars) -join $separator
    $sources = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'src') -Filter '*.java' -Recurse | ForEach-Object FullName)
    $api = & $javap -verbose -classpath $liteBans litebans.api.Events
    if ($LASTEXITCODE -ne 0) { throw 'The LiteBans JAR does not expose its event API.' }
    # Some releases strip the nested-class metadata while retaining the same JVM class name.
    if (-not ($api | Select-String -SimpleMatch 'Listener=class litebans/api/Events$Listener')) {
        $original = $sources | Where-Object { [IO.Path]::GetFileName($_) -eq 'JournalBans.java' }
        $compatible = Join-Path $patcher 'JournalBans.java'
        $body = [IO.File]::ReadAllText($original).Replace('new Events.Listener()', 'new litebans.api.Events$Listener()')
        [IO.File]::WriteAllText($compatible, $body)
        $sources = @($sources | Where-Object { $_ -ne $original }) + $compatible
    }
    & $javac -proc:none --release 21 -encoding UTF-8 -classpath $classpath -d $classes @sources
    if ($LASTEXITCODE -ne 0) { throw 'Could not compile the Journal integration.' }

    & $javac -proc:none --release 21 -encoding UTF-8 -classpath $classpath -d $patcher (Join-Path $PSScriptRoot 'WireFastFreeze.java') (Join-Path $PSScriptRoot 'WireChecks.java')
    if ($LASTEXITCODE -ne 0) { throw 'Could not compile the FastFreeze patcher.' }
    $patchClasspath = $patcher + $separator + $classpath
    & $java -cp $patchClasspath WireFastFreeze (Join-Path $classes 'ru/fastfreeze/FastFreeze.class')
    if ($LASTEXITCODE -ne 0) { throw 'Could not wire the FastFreeze lifecycle.' }
    & $java -cp $patchClasspath WireChecks $classes
    if ($LASTEXITCODE -ne 0) { throw 'Could not wire the check events.' }

    $metadataPath = Join-Path $classes 'plugin.yml'
    $metadata = [IO.File]::ReadAllText($metadataPath) -replace '(?m)^version:[^\r\n]+', 'version: "2.0"'
    if ($metadata -notmatch '(?m)^softdepend:.*LiteBans') {
        if ($metadata -match '(?m)^softdepend:.*\]') {
            $metadata = $metadata -replace '(?m)^(softdepend:[^\r\n]*?)\]', '$1, LiteBans]'
        } else {
            $metadata = $metadata.TrimEnd() + "`nsoftdepend: [LiteBans]`n"
        }
    }
    [IO.File]::WriteAllText($metadataPath, $metadata)
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'journal.yml') -Destination (Join-Path $classes 'journal.yml')

    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($output))
    $manifest = Join-Path $classes 'META-INF/MANIFEST.MF'
    & $jar --create --file $output --manifest $manifest -C $classes .
    if ($LASTEXITCODE -ne 0) { throw 'Could not package FastFreeze.' }
    Get-Item -LiteralPath $output
} finally {
    Pop-Location
    $tempPath = (Resolve-Path -LiteralPath $temp).Path
    if ([IO.Path]::GetFileName($tempPath) -match '^jevox-fastfreeze-[a-f0-9]{32}$' -and
        [IO.Path]::GetDirectoryName($tempPath) -eq [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)) {
        Remove-Item -LiteralPath $tempPath -Recurse -Force
    }
}
