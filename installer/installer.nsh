!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!ifndef BUILD_UNINSTALLER
  Var /GLOBAL BridgeAutostartCheckbox
  Var /GLOBAL BridgeAutostartEnabled
  Var /GLOBAL BridgeLaunchTarget

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
