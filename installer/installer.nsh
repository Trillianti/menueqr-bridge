!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!ifndef BUILD_UNINSTALLER
  Var /GLOBAL BridgeAutostartCheckbox
  Var /GLOBAL BridgeAutostartEnabled
  Var /GLOBAL BridgeLaunchTarget

!macro customInit
  Call StopRunningMenuQrBridge
!macroend

Function StopRunningMenuQrBridge
  # Every Electron main/renderer/GPU process uses the exact application image
  # name. Retry a few times so an older Bridge build cannot keep installation
  # files locked while it is still shutting down.
  #
  # Do not recursively terminate the process tree here: during an in-app update
  # the installer can be a descendant of Bridge and could otherwise terminate
  # itself before replacing the application files.
  StrCpy $0 0
  stopBridgeProcesses:
    nsExec::ExecToStack '"$SYSDIR\taskkill.exe" /F /IM "${APP_EXECUTABLE_FILENAME}"'
    Pop $1
    Pop $2
    Sleep 350
    IntOp $0 $0 + 1
    IntCmp $0 5 stopBridgeProcessesDone stopBridgeProcesses stopBridgeProcessesDone
  stopBridgeProcessesDone:
FunctionEnd

!macro customPageAfterChangeDir
  Page custom BridgeAutostartPage BridgeAutostartPageLeave
!macroend

Function BridgeAutostartPage
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 26u "MenüQR Bridge kann beim Anmelden automatisch starten. Diese Einstellung kann später in der App geändert werden."
  Pop $0
  ${NSD_CreateCheckbox} 0 34u 100% 12u "MenüQR Bridge mit Windows starten"
  Pop $BridgeAutostartCheckbox
  ${NSD_SetState} $BridgeAutostartCheckbox ${BST_UNCHECKED}
  nsDialogs::Show
FunctionEnd

Function BridgeAutostartPageLeave
  ${NSD_GetState} $BridgeAutostartCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $BridgeAutostartEnabled "1"
  ${Else}
    StrCpy $BridgeAutostartEnabled "0"
  ${EndIf}
FunctionEnd

!macro customInstall
  StrCpy $BridgeLaunchTarget "$launchLink"
  ${If} $BridgeAutostartEnabled == "1"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "MenüQR Bridge" "$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" --bridge-autostart"
  ${EndIf}
!macroend

Function StartMenuQrBridge
  ${If} $BridgeAutostartEnabled == "1"
    ExecShell "open" "$BridgeLaunchTarget" "--bridge-autostart"
  ${Else}
    ExecShell "open" "$BridgeLaunchTarget"
  ${EndIf}
FunctionEnd

!macro customFinishPage
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartMenuQrBridge"
  !insertmacro MUI_PAGE_FINISH
!macroend
!endif

!macro customUnInstall
  # Electron's autostart adapter owns this per-user Run value.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "MenüQR Bridge"
  MessageBox MB_ICONQUESTION|MB_YESNO "Lokale MenüQR Bridge-Einstellungen, verschlüsselte Gerätezugangsdaten, Diagnoseinformationen und Protokolle für dieses Windows-Benutzerkonto entfernen?" IDNO keepBridgeData
  RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
  RMDir /r "$LOCALAPPDATA\${APP_PRODUCT_FILENAME}"
  keepBridgeData:
!macroend
