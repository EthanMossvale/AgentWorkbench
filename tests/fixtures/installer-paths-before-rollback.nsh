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
!macroend

; Preserve customInit's per-user default and any revisited picker choice.
!macro customInstallMode
  !ifndef BUILD_UNINSTALLER
    ${If} $installMode == "CurrentUser"
      Abort
    ${EndIf}
  !endif
!macroend
