; ИванОператор — NSIS x64 (как у Antiraskladka, но для Electron-дерева)
Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"

Name "ИванОператор"
OutFile "..\dist\IvanOperator-Setup-1.2.2.exe"
InstallDir "$LOCALAPPDATA\Programs\IvanOperator"
InstallDirRegKey HKCU "Software\IvanOperator" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
VIProductVersion "1.2.2.0"
VIAddVersionKey /LANG=1049 "ProductName" "ИванОператор"
VIAddVersionKey /LANG=1049 "FileVersion" "1.2.2"
VIAddVersionKey /LANG=1049 "FileDescription" "Установщик ИванОператор"
VIAddVersionKey /LANG=1049 "LegalCopyright" "Воронцов Иван Игоревич"
VIAddVersionKey /LANG=1049 "ProductVersion" "1.2.2"

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\IvanOperator.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Запустить ИванОператор"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Russian"
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  nsExec::Exec 'taskkill /F /IM IvanOperator.exe'
  Sleep 800
  SetOutPath "$INSTDIR"
  ; всё дерево electron win-unpacked
  File /r "..\dist\win-unpacked\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\IvanOperator" "InstallDir" "$INSTDIR"
  CreateDirectory "$SMPROGRAMS\ИванОператор"
  CreateShortcut "$SMPROGRAMS\ИванОператор\ИванОператор.lnk" "$INSTDIR\IvanOperator.exe"
  CreateShortcut "$SMPROGRAMS\ИванОператор\Удалить.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\ИванОператор.lnk" "$INSTDIR\IvanOperator.exe"
  !define UK "Software\Microsoft\Windows\CurrentVersion\Uninstall\IvanOperator"
  WriteRegStr HKCU "${UK}" "DisplayName" "ИванОператор"
  WriteRegStr HKCU "${UK}" "DisplayVersion" "1.2.2"
  WriteRegStr HKCU "${UK}" "Publisher" "Воронцов Иван Игоревич"
  WriteRegStr HKCU "${UK}" "DisplayIcon" "$INSTDIR\IvanOperator.exe"
  WriteRegStr HKCU "${UK}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UK}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UK}" "EstimatedSize" "$0"
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM IvanOperator.exe'
  Sleep 800
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\IvanOperator"
  DeleteRegKey HKCU "Software\IvanOperator"
  Delete "$DESKTOP\ИванОператор.lnk"
  RMDir /r "$SMPROGRAMS\ИванОператор"
  RMDir /r "$INSTDIR"
SectionEnd
