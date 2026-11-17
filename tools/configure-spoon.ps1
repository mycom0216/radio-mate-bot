param([string]$ClientId='', [string]$RepositoryRoot='')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$root=if($RepositoryRoot){[IO.Path]::GetFullPath($RepositoryRoot)}else{[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))}
$envFile=Join-Path $root 'deploy\broadcast.env'
[Windows.Forms.Application]::EnableVisualStyles()
$form=New-Object Windows.Forms.Form
$form.Text='라디오메이트 · 방송 연동 설정';$form.Size=New-Object Drawing.Size(650,470);$form.StartPosition='CenterScreen';$form.FormBorderStyle='FixedDialog';$form.MaximizeBox=$false
function LabelAt($text,$x,$y,$width,$height){$c=New-Object Windows.Forms.Label;$c.Text=$text;$c.Location=New-Object Drawing.Point($x,$y);$c.Size=New-Object Drawing.Size($width,$height);$form.Controls.Add($c)}
LabelAt "이 창은 이 PC에서만 동작합니다. Client Secret을 채팅에 보내지 마세요.`r`n입력한 인증정보는 로컬 서버 파일에만 저장하며 GitHub에는 올리지 않습니다." 24 20 590 52
LabelAt 'Client ID' 24 88 580 22
$idInput=New-Object Windows.Forms.TextBox;$idInput.Location=New-Object Drawing.Point(24,113);$idInput.Size=New-Object Drawing.Size(580,26);$idInput.Text=$ClientId;$form.Controls.Add($idInput)
LabelAt 'Client Secret (개발자센터 앱 상세 화면 → 표시)' 24 151 580 22
$secretInput=New-Object Windows.Forms.TextBox;$secretInput.Location=New-Object Drawing.Point(24,177);$secretInput.Size=New-Object Drawing.Size(580,26);$secretInput.UseSystemPasswordChar=$true;$form.Controls.Add($secretInput)
LabelAt "등록된 콜백: http://localhost:4310/oauth/callback`r`n저장 후 DJ 계정 로그인용 시크릿 창이 열립니다. 봇 계정으로 로그인하지 마세요." 24 223 590 48
$status=New-Object Windows.Forms.Label;$status.Location=New-Object Drawing.Point(24,281);$status.Size=New-Object Drawing.Size(580,52);$status.Text='Client ID와 Secret을 입력한 뒤 아래 버튼을 눌러 주세요.';$form.Controls.Add($status)
$save=New-Object Windows.Forms.Button;$save.Text='로컬 서버에 저장하고 DJ 연결 화면 열기';$save.Location=New-Object Drawing.Point(24,342);$save.Size=New-Object Drawing.Size(580,48);$form.Controls.Add($save)
$save.Add_Click({
 try{
  $save.Enabled=$false;$status.Text='로컬 서버 설정을 적용하고 있습니다...';$form.Refresh()
  $id=$idInput.Text.Trim();$secret=$secretInput.Text.Trim();$parsed=[Guid]::Empty
  if(-not [Guid]::TryParse($id,[ref]$parsed)){throw 'Client ID 형식을 확인하세요.'}
  if($secret.Length -lt 8 -or $secret.Length -gt 4096 -or $secret -match '[\r\n\x00]'){throw 'Client Secret을 다시 확인하세요.'}
  $probe=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,4310)
  try{$probe.Start()}catch{throw '4310 포트가 사용 중입니다. 기존 서버를 종료한 뒤 다시 시도하세요.'}finally{$probe.Stop()}
  $key='';if(Test-Path $envFile){$old=[IO.File]::ReadAllLines($envFile)|Where-Object{$_ -match '^TOKEN_KEY='}|Select-Object -First 1;if($old){$key=$old.Substring(10)}}
  if($key -notmatch '^[a-fA-F0-9]{64}$'){$bytes=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create();try{$rng.GetBytes($bytes)}finally{$rng.Dispose()};$key=([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()}
  $safeSecret="'"+$secret+"'"
  if($secret.Contains("'")){if($secret.Contains('"')){throw 'Secret에 따옴표가 포함되어 있습니다. 서버 설정 형식을 별도 확인해야 합니다.'};$safeSecret='"'+$secret+'"'}
  $lines=@('HOST=127.0.0.1','PORT=4310','PUBLIC_URL=http://localhost:4310','NODE_ENV=development','DATA_DIR=./data-broadcast','SPOON_REGION=kr','PUBLIC_DEMO=false',"SPOON_CLIENT_ID=$id","SPOON_CLIENT_SECRET=$safeSecret","TOKEN_KEY=$key")
  [IO.Directory]::CreateDirectory((Split-Path $envFile))|Out-Null
  [IO.File]::WriteAllLines($envFile,$lines,(New-Object Text.UTF8Encoding($false)))
  $acl=[IO.File]::GetAccessControl($envFile);$acl.SetAccessRuleProtection($true,$false)
  $owner=[Security.Principal.WindowsIdentity]::GetCurrent().Name
  $acl.SetAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($owner,'FullControl','Allow')))
  $acl.SetAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('SYSTEM','FullControl','Allow')))
  [IO.File]::SetAccessControl($envFile,$acl)
  $node=(Get-Command node.exe).Source
  $proc=Start-Process -FilePath $node -ArgumentList '--env-file=deploy/broadcast.env','server.mjs' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root 'deploy\broadcast-out.log') -RedirectStandardError (Join-Path $root 'deploy\broadcast-error.log') -PassThru
  [IO.File]::WriteAllText((Join-Path $root 'deploy\broadcast.pid'),[string]$proc.Id)
  $ready=$false
  for($i=0;$i -lt 20;$i++){Start-Sleep -Milliseconds 300;if($proc.HasExited){throw '서버를 시작하지 못했습니다. 로컬 로그를 확인해야 합니다.'};try{$info=Invoke-RestMethod 'http://localhost:4310/api/session' -TimeoutSec 2;if($info.configured){$ready=$true;break}}catch{}}
  if(-not $ready){throw '서버 설정을 확인하지 못했습니다. 로컬 로그를 확인해야 합니다.'}
  $secretInput.Clear();$secret=$null;$lines=$null
  $chrome=Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'
  if(Test-Path $chrome){Start-Process -FilePath $chrome -ArgumentList '--incognito','http://localhost:4310/oauth/start'}else{Start-Process 'http://localhost:4310/oauth/start'}
  $status.Text='서버 설정 완료. 열린 창에서 방송할 DJ 계정으로 로그인·동의하세요.';$form.Text='라디오메이트 · 설정 완료'
 }catch{$status.Text=$_.Exception.Message;$save.Enabled=$true}
})
$form.Add_Shown({$secretInput.Focus()});[Windows.Forms.Application]::Run($form)
