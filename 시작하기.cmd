@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Spoon Studio 시작: http://localhost:4310
echo 서버가 준비되면 브라우저에서 위 주소를 여세요.
node --env-file-if-exists=.env server.mjs
pause
