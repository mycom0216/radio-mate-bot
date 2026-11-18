import {execFileSync} from 'node:child_process';import {dirname,join,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {readFileSync,writeFileSync} from 'node:fs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),runtime=join(root,'tools','managed-runtime.mjs'),configFile=join(root,'deploy','automation.json'),remove=process.argv.includes('remove');
if(process.platform!=='win32')throw Error('Windows 전용 설치 도구입니다.');
const config=JSON.parse(readFileSync(configFile,'utf8'));config.enabled=!remove;writeFileSync(configFile,JSON.stringify(config,null,2),{mode:0o600});
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const command=`while (Test-Path -LiteralPath ${quote(configFile)}) { & ${quote(process.execPath)} ${quote(runtime)}; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep -Seconds 5 }`;
const argumentsText='-NoProfile -NonInteractive -WindowStyle Hidden -Command "'+command+'"';
const script=String.raw`$ErrorActionPreference='Stop'
$taskName='RadioMate-Automation'
$root=${quote(root)}
$runtime=${quote(runtime)}
$arguments=${quote(argumentsText)}
$powerShell=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$startupFile=Join-Path ([Environment]::GetFolderPath('Startup')) 'RadioMate-Automation.lnk'
if (${remove?'$true':'$false'}) {
 $task=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
 if($task -and (($task.Actions | Select-Object -First 1).Arguments.Contains($runtime))){Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue;Unregister-ScheduledTask -TaskName $taskName -Confirm:$false}
 if(Test-Path -LiteralPath $startupFile){$shell=New-Object -ComObject WScript.Shell;$shortcut=$shell.CreateShortcut($startupFile);if($shortcut.Arguments.Contains($runtime)){Remove-Item -LiteralPath $startupFile}}
 Write-Output 'AUTOMATION_DISABLED'
 exit 0
}
try {
 $existing=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
 if($existing -and -not (($existing.Actions | Select-Object -First 1).Arguments.Contains($runtime))){throw 'Task name belongs to another checkout'}
 $user=[Security.Principal.WindowsIdentity]::GetCurrent().Name
 $action=New-ScheduledTaskAction -Execute $powerShell -Argument $arguments -WorkingDirectory $root
 $trigger=New-ScheduledTaskTrigger -AtLogOn -User $user
 $principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
 $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
 Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
 Start-ScheduledTask -TaskName $taskName
 Write-Output 'SCHEDULED_TASK_ENABLED'
}catch {
 $shell=New-Object -ComObject WScript.Shell
 if(Test-Path -LiteralPath $startupFile){$old=$shell.CreateShortcut($startupFile);if(-not $old.Arguments.Contains($runtime)){throw 'Startup shortcut belongs to another checkout'}}
 $shortcut=$shell.CreateShortcut($startupFile);$shortcut.TargetPath=$powerShell;$shortcut.Arguments=$arguments;$shortcut.WorkingDirectory=$root;$shortcut.WindowStyle=7;$shortcut.Description='RadioMate automatic recovery';$shortcut.Save()
 Start-Process -FilePath $powerShell -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden
 Write-Output 'USER_STARTUP_ENABLED'
}`;
const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:30000});if(!/AUTOMATION_DISABLED|SCHEDULED_TASK_ENABLED|USER_STARTUP_ENABLED/.test(output))throw Error('자동 실행 등록 결과를 확인하지 못했습니다.');console.log(output.trim());
