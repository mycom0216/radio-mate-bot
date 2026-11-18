param([switch]$DebugBuild,[string]$ServerUrl)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$androidRoot=Join-Path $projectRoot 'android'
if(-not $env:JAVA_HOME){$java=Get-Command java -ErrorAction Stop;$env:JAVA_HOME=Split-Path (Split-Path $java.Source -Parent) -Parent}
if(-not $env:ANDROID_HOME){$env:ANDROID_HOME=Join-Path $env:LOCALAPPDATA 'Android\Sdk'}
if(-not(Test-Path (Join-Path $env:ANDROID_HOME 'platforms\android-36\android.jar'))){throw 'Android SDK Platform 36을 먼저 설치해주세요.'}
if(-not $DebugBuild -and -not(Test-Path (Join-Path $androidRoot 'signing.properties'))){throw '배포 빌드에는 android/signing.properties와 기존 앱 서명키가 필요합니다. android/README.md를 확인하세요.'}
$tasks=if($DebugBuild){@(':app:assembleDebug',':app:lintDebug')}else{@(':app:assembleRelease',':app:bundleRelease',':app:lintRelease')}
$argsList=@('--no-daemon','--console=plain')+$tasks
if($ServerUrl){$argsList+=('-PserverUrl='+$ServerUrl)}
Push-Location $androidRoot
try{
    & .\gradlew.bat @argsList
    if($LASTEXITCODE -ne 0){throw 'Android 빌드가 실패했습니다.'}
    $destination=Join-Path $projectRoot 'output\android';New-Item $destination -ItemType Directory -Force | Out-Null
    if($DebugBuild){Copy-Item 'app/build/outputs/apk/debug/app-debug.apk' (Join-Path $destination 'RadioMate-preview.apk')}
    else{
        Copy-Item 'app/build/outputs/apk/release/app-release.apk' (Join-Path $destination 'RadioMate-1.0.0.apk')
        Copy-Item 'app/build/outputs/bundle/release/app-release.aab' (Join-Path $destination 'RadioMate-1.0.0.aab')
    }
    Get-ChildItem $destination -File | Get-FileHash -Algorithm SHA256 | Select-Object Path,Hash
}finally{Pop-Location}
