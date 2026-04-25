Unicode true
ManifestDPIAware true

!include MUI2.nsh
!include FileFunc.nsh
!include x64.nsh

!define PRODUCTNAME "{{product_name}}"
!define MAINBINARYNAME "{{main_binary_name}}"
!define OUTFILE "{{out_file}}"

Name "${PRODUCTNAME}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES\${PRODUCTNAME}"

; ------------------------
; 页面
; ------------------------

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES

; ✅ 只保留运行按钮
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION RunApp
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

; ------------------------
; 安装
; ------------------------

Section Install

  SetOutPath $INSTDIR

  ; 主程序
  File "{{main_binary_path}}"

  ; 卸载程序（关键）
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; ------------------------
  ; 多语言快捷方式（你完全控制）
  ; ------------------------

  ${If} $LANGUAGE == 2052
    StrCpy $0 "手机管理器"
  ${Else}
    StrCpy $0 "Mobile Manager"
  ${EndIf}

  ; 桌面
  CreateShortcut "$DESKTOP\$0.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"

  ; 开始菜单
  CreateDirectory "$SMPROGRAMS\$0"
  CreateShortcut "$SMPROGRAMS\$0\$0.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"

SectionEnd

; ------------------------
; 卸载（重点：你自己清理）
; ------------------------

Section Uninstall

  ; 删除所有可能语言（最稳）
  Delete "$DESKTOP\手机管理器.lnk"
  Delete "$DESKTOP\Mobile Manager.lnk"

  Delete "$SMPROGRAMS\手机管理器\手机管理器.lnk"
  Delete "$SMPROGRAMS\Mobile Manager\Mobile Manager.lnk"

  RMDir "$SMPROGRAMS\手机管理器"
  RMDir "$SMPROGRAMS\Mobile Manager"

  ; 删除程序
  Delete "$INSTDIR\${MAINBINARYNAME}.exe"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"

SectionEnd

; ------------------------
; 运行
; ------------------------

Function RunApp
  Exec "$INSTDIR\${MAINBINARYNAME}.exe"
FunctionEnd