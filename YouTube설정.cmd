@echo off
cd /d "%~dp0"
set "PSModulePath=%SystemRoot%\System32\WindowsPowerShell\v1.0\Modules"
powershell.exe -NoProfile -STA -Command "& ([scriptblock]::Create([IO.File]::ReadAllText((Join-Path (Get-Location) 'tools/configure-youtube.ps1')))) -RepositoryRoot (Get-Location)"
if errorlevel 1 pause