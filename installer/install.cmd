@echo off
chcp 65001 >nul
rem ИванОператор — единый установщик для Windows: распаковывает установщик из zip и запускает его.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$z=Get-ChildItem 'IvanOperator-Setup-*.zip'|Select -First 1; $t=Join-Path $env:TEMP 'iop-setup'; Expand-Archive -Force $z.FullName $t; $e=Get-ChildItem $t -Filter *.exe|Select -First 1; Start-Process $e.FullName -Wait"
