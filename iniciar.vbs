' Kick Backend - Inicio silencioso (sin consola)
Dim shell, node, fso, npm
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Verificar Node.js
If shell.Run("cmd /c where node >nul 2>nul", 0, True) <> 0 Then
  MsgBox "Node.js no está instalado." & vbCrLf & "Descargalo de https://nodejs.org", vbCritical, "Kick Backend"
  WScript.Quit 1
End If

' Instalar dependencias si no existen
If Not fso.FolderExists("node_modules") Then
  shell.Run "cmd /c npm install", 0, True
End If

' Iniciar servidor oculto
shell.Run "cmd /c node server.js", 0, False

' Esperar un momento y abrir navegador
WScript.Sleep 2000
shell.Run "msedge --app=""http://localhost:3000"" --no-first-run", 1, False

Set shell = Nothing
Set fso = Nothing
