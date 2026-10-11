; WA Stay: custom NSIS steps, included by electron-builder (`nsis.include`).
;
; electron-builder creates the "WA Stay" desktop and Start-menu shortcuts itself
; (createDesktopShortcut, createStartMenuShortcut), so this script never creates any.
;
; Upgrading from v1.x, the app's previous name (same appId, so the install upgrades in place):
; - customCheckAppRunning runs just before the old v1 uninstaller. It closes a running v1 app,
;   whose process keeps the v1 database open (WAL), then copies the v1 data into
;   "$APPDATA\WA Stay\legacy-snapshot\", because that uninstaller can ask to delete the data
;   even during an upgrade, with no silent default. The legacy folder is never moved or changed.
;   Known limitation: an elevated (per-machine) install skips CHECK_APP_RUNNING in its UAC inner
;   instance, so it takes no snapshot.
; - customInstall then removes the shortcuts v1 created itself.
;
; The install folder on an upgrade from v1 (cosmetic; the app works from either):
; - an unattended (/S) update keeps v1's folder, because NSIS reads InstallLocation from the
;   appId's key: "...\Programs\WA ParkStay Bookings\" (legacy-name-ok)
; - an interactive upgrade (the installer run by hand, or quitAndInstall with its UI) installs
;   into a "WA Stay" subfolder of it, because electron-builder's instFilesPre adds the app name
;   to a folder that lacks it: "...\Programs\WA ParkStay Bookings\WA Stay\" (legacy-name-ok)

; customCheckAppRunning replaces electron-builder's check, whose helpers are included only
; when this macro is not defined (allowOnlyOneInstallerInstance.nsh).
!include "getProcessInfo.nsh"
Var pid

; Close a running app as electron-builder does (its own check, electron-builder 26: whether
; PowerShell can list processes, then _CHECK_APP_RUNNING), then (installer only) close a running
; v1 app and take the legacy snapshot.
!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
  !ifndef BUILD_UNINSTALLER
    !insertmacro waStayCloseLegacyApp
    !insertmacro waStaySnapshotLegacyData
  !endif
!macroend

; v1.x's executable, whose process holds the v1 database open until it exits
!define WA_STAY_LEGACY_EXE "WA ParkStay Bookings.exe" ; legacy-name-ok

; Sets _RETURN to 0 when a v1.x app is running, found by its executable's name, as
; electron-builder 24's FIND_PROCESS did. electron-builder 26's FIND_PROCESS looks instead for
; any process under $INSTDIR (when PowerShell is available), which misses v1.x when an
; interactive upgrade installs into a "WA Stay" subfolder of v1's folder.
!macro waStayFindLegacyApp _RETURN
  !ifdef INSTALL_MODE_PER_ALL_USERS
    ${nsProcess::FindProcess} "${WA_STAY_LEGACY_EXE}" ${_RETURN}
  !else
    nsExec::Exec `%SYSTEMROOT%\System32\cmd.exe /c tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${WA_STAY_LEGACY_EXE}" /FO csv | %SYSTEMROOT%\System32\find.exe "${WA_STAY_LEGACY_EXE}"`
    Pop ${_RETURN}
  !endif
!macroend

; Closes a running v1.x app the way electron-builder 24's _CHECK_APP_RUNNING closed WA Stay, so
; the snapshot copies a database nothing is writing to: in an update, give the app time to exit
; by itself; otherwise ask first. Then taskkill, wait, and taskkill /f until it is gone.
!macro waStayCloseLegacyApp
  ${GetProcessInfo} 0 $pid $1 $2 $3 $4
  ${if} ${isUpdated}
    ; allow the app to exit without an explicit kill
    Sleep 300
  ${endIf}

  !insertmacro waStayFindLegacyApp $R0
  ${if} $R0 == 0
    ${if} ${isUpdated}
      ; allow the app to exit without an explicit kill
      Sleep 1000
      Goto waStayLegacyStop
    ${endIf}
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "WA ParkStay Bookings, the app WA Stay replaces, is running.$\nClick OK to close it.$\nIf it doesn't close, try closing it manually." /SD IDOK IDOK waStayLegacyStop ; legacy-name-ok
    Quit

    waStayLegacyStop:
    DetailPrint `Closing running "${WA_STAY_LEGACY_EXE}"...`
    !ifdef INSTALL_MODE_PER_ALL_USERS
      nsExec::Exec `taskkill /im "${WA_STAY_LEGACY_EXE}" /fi "PID ne $pid"`
    !else
      nsExec::Exec `%SYSTEMROOT%\System32\cmd.exe /c taskkill /im "${WA_STAY_LEGACY_EXE}" /fi "PID ne $pid" /fi "USERNAME eq %USERNAME%"`
    !endif
    ; to ensure that files are not "in-use"
    Sleep 300

    StrCpy $R1 0
    waStayLegacyLoop:
      IntOp $R1 $R1 + 1

      !insertmacro waStayFindLegacyApp $R0
      ${if} $R0 == 0
        ; wait to give it a chance to exit gracefully
        Sleep 1000
        !ifdef INSTALL_MODE_PER_ALL_USERS
          nsExec::Exec `taskkill /f /im "${WA_STAY_LEGACY_EXE}" /fi "PID ne $pid"`
        !else
          nsExec::Exec `%SYSTEMROOT%\System32\cmd.exe /c taskkill /f /im "${WA_STAY_LEGACY_EXE}" /fi "PID ne $pid" /fi "USERNAME eq %USERNAME%"`
        !endif
        !insertmacro waStayFindLegacyApp $R0
        ${if} $R0 == 0
          DetailPrint `Waiting for "${WA_STAY_LEGACY_EXE}" to close.`
          Sleep 2000
        ${else}
          Goto waStayLegacyClosed
        ${endIf}
      ${else}
        Goto waStayLegacyClosed
      ${endIf}

      ; Likely running elevated: ask the user to close it
      ${if} $R1 > 1
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "WA ParkStay Bookings cannot be closed.$\nPlease close it manually and click Retry to continue." /SD IDCANCEL IDRETRY waStayLegacyLoop ; legacy-name-ok
        Quit
      ${else}
        Goto waStayLegacyLoop
      ${endIf}
    waStayLegacyClosed:
  ${endIf}
!macroend

; Copies the v1 database with its -wal and -shm files (all three, so the copy holds every committed
; change) from the v1 data folder into "$APPDATA\WA Stay\legacy-snapshot\", unless the data was
; already migrated (migration.json) or a snapshot exists. The v1 Gmail OTP file is not copied: that
; feature is gone. It runs after waStayCloseLegacyApp, so no v1 process is writing to them. Copies
; only: the legacy folder is left as it is.
!macro waStaySnapshotLegacyData
  ; Electron keeps app data per user
  ${if} $installMode == "all"
    SetShellVarContext current
  ${endIf}

  ${if} ${FileExists} "$APPDATA\parkstay-bookings\parkstay.db" ; legacy-name-ok
    ${ifNot} ${FileExists} "$APPDATA\WA Stay\migration.json"
      ${ifNot} ${FileExists} "$APPDATA\WA Stay\legacy-snapshot\parkstay.db" ; legacy-name-ok
        CreateDirectory "$APPDATA\WA Stay\legacy-snapshot"
        CopyFiles /SILENT "$APPDATA\parkstay-bookings\parkstay.db" "$APPDATA\WA Stay\legacy-snapshot" ; legacy-name-ok
        ${if} ${FileExists} "$APPDATA\parkstay-bookings\parkstay.db-wal" ; legacy-name-ok
          CopyFiles /SILENT "$APPDATA\parkstay-bookings\parkstay.db-wal" "$APPDATA\WA Stay\legacy-snapshot" ; legacy-name-ok
        ${endIf}
        ${if} ${FileExists} "$APPDATA\parkstay-bookings\parkstay.db-shm" ; legacy-name-ok
          CopyFiles /SILENT "$APPDATA\parkstay-bookings\parkstay.db-shm" "$APPDATA\WA Stay\legacy-snapshot" ; legacy-name-ok
        ${endIf}
        DetailPrint "Copied the previous version's data to $APPDATA\WA Stay\legacy-snapshot"
      ${endIf}
    ${endIf}
  ${endIf}

  ${if} $installMode == "all"
    SetShellVarContext all
  ${endIf}
  ClearErrors
!macroend

; Removes the shortcuts v1.x created itself, for the current user and for all users.
!macro customInstall
  DetailPrint "Installing WA Stay..."
  SetShellVarContext current
  !insertmacro waStayRemoveLegacyShortcuts
  SetShellVarContext all
  !insertmacro waStayRemoveLegacyShortcuts
  ${if} $installMode == "all"
    SetShellVarContext all
  ${else}
    SetShellVarContext current
  ${endIf}
  ClearErrors
!macroend

!macro waStayRemoveLegacyShortcuts
  Delete "$DESKTOP\WA ParkStay Bookings.lnk" ; legacy-name-ok
  Delete "$SMPROGRAMS\WA ParkStay Bookings.lnk" ; legacy-name-ok
  RMDir /r "$SMPROGRAMS\WA ParkStay Bookings" ; legacy-name-ok
!macroend

; Offers to delete the app's data, but never during an update (the installer runs the old
; uninstaller with --updated) and never in a silent uninstall (/SD IDNO). electron-builder 26
; runs it before removing the program files (24 ran it after); it touches only the data
; folders, so the order changes nothing but when the question appears.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; Electron keeps app data per user
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endIf}

    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Do you also want to delete your WA Stay data? This includes your watches, snipes, bookings and settings.$\n$\nClick Yes to delete it, or No to keep it." /SD IDNO IDYES waStayDeleteData
    DetailPrint "WA Stay data kept"
    Goto waStayDataDone

    waStayDeleteData:
      RMDir /r "$APPDATA\WA Stay"
      RMDir /r "$LOCALAPPDATA\wa-stay-updater"
      DetailPrint "WA Stay data deleted"

      ; The previous version's data is a separate folder: ask again, naming it (default No)
      ${if} ${FileExists} "$APPDATA\parkstay-bookings\*.*" ; legacy-name-ok
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "The data of WA ParkStay Bookings, the app WA Stay replaced, is still in:$\n$\n$APPDATA\parkstay-bookings$\n$\nDo you want to delete that folder too?" /SD IDNO IDNO waStayDataDone ; legacy-name-ok
        RMDir /r "$APPDATA\parkstay-bookings" ; legacy-name-ok
        DetailPrint "Previous version's data deleted"
      ${endIf}

    waStayDataDone:
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endIf}
  ${endIf}
!macroend

; Require Windows 10 or later
!macro customInit
  ${If} ${AtLeastWin10}
    ; OK to proceed
  ${Else}
    MessageBox MB_OK|MB_ICONSTOP "WA Stay requires Windows 10 or later." /SD IDOK
    Quit
  ${EndIf}
!macroend

; No customHeader or customFinishPage: the installer has no welcome page, and electron-builder's
; own finish page (with runAfterFinish's "Run WA Stay") is the one shown.
