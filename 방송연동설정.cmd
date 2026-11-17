@echo off
cd /d "%~dp0"
set "PSModulePath=%SystemRoot%\System32\WindowsPowerShell\v1.0\Modules"
powershell.exe -NoProfile -STA -Command "& ([scriptblock]::Create([IO.File]::ReadAllText((Join-Path (Get-Location) 'tools/configure-spoon.ps1')))) -RepositoryRoot (Get-Location) -ClientId '95ac45de-6fde-4f8d-9874-c76d85083830'"
if errorlevel 1 pause