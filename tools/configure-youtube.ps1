param([string]$RepositoryRoot='')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$root=if($RepositoryRoot){$RepositoryRoot}else{[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))}
$form=New-Object Windows.Forms.Form
$form.Text='라디오메이트 · YouTube 검색 설정';$form.Size=New-Object Drawing.Size(600,310);$form.StartPosition='CenterScreen'
$label=New-Object Windows.Forms.Label;$label.Text='Google에서 만든 YouTube 전용 키를 이 창에만 붙여넣으세요.';$label.Location=New-Object Drawing.Point(20,20);$label.Size=New-Object Drawing.Size(550,35);$form.Controls.Add($label)
$box=New-Object Windows.Forms.TextBox;$box.UseSystemPasswordChar=$true;$box.Location=New-Object Drawing.Point(20,65);$box.Size=New-Object Drawing.Size(540,26);$form.Controls.Add($box)
$status=New-Object Windows.Forms.Label;$status.Text='키는 로컬 서버 설정에 저장되며 채팅이나 GitHub에는 올라가지 않습니다.';$status.Location=New-Object Drawing.Point(20,110);$status.Size=New-Object Drawing.Size(540,60);$form.Controls.Add($status)
$save=New-Object Windows.Forms.Button;$save.Text='검색 키 확인 · 저장 · 서버 적용';$save.Location=New-Object Drawing.Point(20,185);$save.Size=New-Object Drawing.Size(540,45);$form.Controls.Add($save)
$save.Add_Click({try{
 $save.Enabled=$false;$status.Text='Google 검색과 키 권한을 확인하고 있습니다...';$form.Refresh();$key=$box.Text.Trim()
 if($key -notmatch '^AIza[A-Za-z0-9_-]{35}$'){throw 'Google API 키 형식을 확인하세요.'}
 try{$result=Invoke-RestMethod 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=MC%EB%AA%BD%20%EA%B7%B8%EB%9E%98%EB%8F%84%20%EB%82%A8%EC%9E%90%EB%8B%88%EA%B9%8C&maxResults=1&videoEmbeddable=true' -Headers @{'X-Goog-Api-Key'=$key} -TimeoutSec 15}catch{throw '검색 키 확인 실패. API 활성화·제한·할당량을 확인한 후 다시 시도하세요.'}
 if(-not $result.items[0].id.videoId){throw '검색 결과를 확인하지 못했습니다.'}
 $file=Join-Path $root 'deploy\temporary.env';if(-not(Test-Path $file)){throw '공용 서버 설정 파일을 찾지 못했습니다.'}
 $lines=@([IO.File]::ReadAllLines($file)|Where-Object{$_ -notmatch '^YOUTUBE_API_KEY='})+('YOUTUBE_API_KEY='+$key)
 [IO.File]::WriteAllLines($file,$lines,(New-Object Text.UTF8Encoding($false)))
 $pidFile=Join-Path $root 'deploy\public.pid';$serverId=[int]([IO.File]::ReadAllText($pidFile));$process=Get-CimInstance Win32_Process -Filter "ProcessId=$serverId"
 if($process.CommandLine -notmatch 'env-file=deploy/temporary.env server.mjs'){throw '관리 중인 서버와 일치하지 않습니다.'}
 Stop-Process -Id $serverId;Start-Sleep -Milliseconds 800
 $proc=Start-Process 'C:\Program Files\nodejs\node.exe' -ArgumentList '--env-file=deploy/temporary.env','server.mjs' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root 'deploy\public-out.log') -RedirectStandardError (Join-Path $root 'deploy\public-error.log') -PassThru
 [IO.File]::WriteAllText($pidFile,[string]$proc.Id)
 [IO.File]::WriteAllText((Join-Path $root 'deploy\youtube-setup-result.json'),'{"ok":true,"searchTest":true}')
 $box.Clear();$key=$null;$lines=$null;$status.Text='검색 확인과 서버 적용을 완료했습니다. 관리 화면을 새로고침하세요.'
}catch{$status.Text=$_.Exception.Message;$save.Enabled=$true}})
$form.Add_Shown({$box.Focus()});[Windows.Forms.Application]::Run($form)