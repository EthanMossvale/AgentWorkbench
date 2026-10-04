; Keep program binaries separate from the persistent AgentWorkbench profile.
; Existing installations and explicit /D selections remain authoritative.
!macro customInit
  ReadRegStr $R1 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  !insertmacro GetDParameter $R0
  ${If} $installMode == "CurrentUser"
  ${AndIf} $R1 == ""
  ${AndIf} $R0 == ""
    StrCpy $INSTDIR "$LocalAppData\AgentWorkbenchApp"
  ${EndIf}
  !ifndef BUILD_UNINSTALLER
    Call awbPrepareInstall
  !endif
!macroend

; Preserve customInit's per-user default and any revisited picker choice.
!macro customInstallMode
  !ifndef BUILD_UNINSTALLER
    ${If} $installMode == "CurrentUser"
      Abort
    ${EndIf}
  !endif
!macroend

; The stock NSIS upgrade removes the old application before extracting the new one.
; Keep a complete copy outside INSTDIR until the new executable is present.
!macro customHeader
!ifndef BUILD_UNINSTALLER
  Var awbBackup
  Var awbCommitted
  Var awbPreviousDirectory
  Var awbPreviousVersion

  Function awbPrepareInstall
    StrCpy $awbBackup ""
    StrCpy $awbCommitted "false"
    ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      StrCpy $awbPreviousDirectory $INSTDIR
      ReadRegStr $awbPreviousVersion SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
      GetTempFileName $awbBackup
      Delete "$awbBackup"
      CreateDirectory "$awbBackup\files"
      ClearErrors
      CopyFiles /SILENT "$INSTDIR\*" "$awbBackup\files"
      ${If} ${Errors}
        SetErrorLevel 2
        MessageBox MB_OK|MB_ICONSTOP "Unable to prepare the update. The existing application has not been removed." /SD IDOK
        StrCpy $awbBackup ""
        Quit
      ${EndIf}
      FileOpen $R2 "$awbBackup\owned-backup" w
      FileClose $R2
      StrCpy $R4 "HKCU"
      ${If} $installMode == "all"
        StrCpy $R4 "HKLM"
      ${EndIf}
      FileOpen $R2 "$awbBackup\registry" w
      FileWriteUTF16LE $R2 "$R4:\${INSTALL_REGISTRY_KEY}$\r$\n$R4:\${UNINSTALL_REGISTRY_KEY}"
      FileClose $R2
      File /oname=$awbBackup\rollback.ps1 "${PROJECT_DIR}\scripts\installer\rollback.ps1"
      System::Call 'kernel32::GetCurrentProcessId()i.r0'
      Exec '$\"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe$\" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File $\"$awbBackup\rollback.ps1$\" -InstallerProcessId $0 -InstallDirectory $\"$INSTDIR$\" -BackupDirectory $\"$awbBackup$\"'
      StrCpy $R3 0
      ${Do}
        ${If} ${FileExists} "$awbBackup\ready"
          ${ExitDo}
        ${EndIf}
        Sleep 100
        IntOp $R3 $R3 + 1
        ${If} $R3 >= 100
          SetErrorLevel 2
          MessageBox MB_OK|MB_ICONSTOP "Unable to start update recovery. The existing application has not been removed." /SD IDOK
          Quit
        ${EndIf}
      ${Loop}
    ${EndIf}
  FunctionEnd

  Function awbRestoreInstall
    ${If} $awbCommitted == "true"
    ${OrIf} $awbBackup == ""
      Return
    ${EndIf}
    CreateDirectory "$awbPreviousDirectory"
    ClearErrors
    CopyFiles /SILENT "$awbBackup\files\*" "$awbPreviousDirectory"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "Update failed. The previous application is preserved at $awbBackup. Restore it to $awbPreviousDirectory." /SD IDOK
    ${Else}
      FileOpen $R2 "$awbBackup\state" w
      FileWrite $R2 "restored"
      FileClose $R2
      StrCpy $awbBackup ""
    ${EndIf}
    SetErrorLevel 2
  FunctionEnd

  Function .onInstFailed
    Call awbRestoreInstall
  FunctionEnd

  Function .onGUIEnd
    Call awbRestoreInstall
  FunctionEnd
!endif
!macroend

!macro customInstall
  ; Extraction can report success with missing application files. Never commit that state.
  ${IfNot} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${OrIfNot} ${FileExists} "$INSTDIR\resources\app.asar"
    Call awbRestoreInstall
    SetErrorLevel 2
    MessageBox MB_OK|MB_ICONSTOP "Update failed to install application files. The previous application has been restored when available." /SD IDOK
    Quit
  ${EndIf}
  StrCpy $awbCommitted "true"
  ${If} $awbBackup != ""
    FileOpen $R2 "$awbBackup\state" w
    FileWrite $R2 "committed"
    FileClose $R2
    StrCpy $awbBackup ""
  ${EndIf}
!macroend
