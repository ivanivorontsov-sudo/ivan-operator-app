@echo off
chcp 65001 >nul
rem ИванОператор — единый установщик для Windows: распаковывает установщик из zip и запускает его.
cd /d "%~dp0"
if exist "IvanOperator-Setup-*.zip" (
powershell -NoProfile -ExecutionPolicy Bypass -Command "$z=Get-ChildItem 'IvanOperator-Setup-*.zip'|Select -First 1; $t=Join-Path $env:TEMP 'iop-setup'; Expand-Archive -Force $z.FullName $t; $e=Get-ChildItem $t -Filter *.exe|Select -First 1; Start-Process $e.FullName -Wait"
  goto :eof
)
rem 1.2.6: нет установщика NSIS — ставим переносную версию в %LOCALAPPDATA%\Programs и делаем ярлыки
powershell -NoProfile -ExecutionPolicy Bypass -Command "$z=Get-ChildItem 'IvanOperator-*-win.zip'|Select -First 1; if(-not $z){Write-Host 'Не найден IvanOperator-*-win.zip'; exit 1}; $d=Join-Path $env:LOCALAPPDATA 'Programs\IvanOperator'; Get-Process -Name 'ИванОператор','IvanOperator' -EA SilentlyContinue|Stop-Process -Force; Expand-Archive -Force $z.FullName $d; $e=Get-ChildItem $d -Recurse -Filter *.exe|Where-Object{$_.Name -notmatch 'Uninstall|helper|crashpad'}|Select -First 1; $w=New-Object -ComObject WScript.Shell; foreach($p in @([Environment]::GetFolderPath('Desktop'),(Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))){$l=$w.CreateShortcut((Join-Path $p 'ИванОператор.lnk')); $l.TargetPath=$e.FullName; $l.WorkingDirectory=$e.DirectoryName; $l.Save()}; Start-Process $e.FullName"
