' Kick Backend - Inicio silencioso (sin consola)
Dim shell, fso, scriptDir, env
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Obtener el directorio del script
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Verificar Node.js
If shell.Run("cmd /c where node >nul 2>nul", 0, True) <> 0 Then
  MsgBox "Node.js no está instalado." & vbCrLf & "Descargalo de https://nodejs.org", vbCritical, "Kick Backend"
  WScript.Quit 1
End If

' Instalar dependencias si no existen
If Not fso.FolderExists(fso.BuildPath(scriptDir, "node_modules")) Then
  shell.Run "cmd /c cd /d """ & scriptDir & """ && npm install", 0, True
End If

' Cargar .env en variables de entorno para que Node.js las herede
If fso.FileExists(fso.BuildPath(scriptDir, ".env")) Then
  Set env = shell.Environment("PROCESS")
  Dim lines, line, idx, key, value
  lines = Split(fso.OpenTextFile(fso.BuildPath(scriptDir, ".env")).ReadAll, vbCrLf)
  For Each line In lines
    line = Trim(line)
    If Len(line) > 0 And Left(line, 1) <> "#" Then
      idx = InStr(line, "=")
      If idx > 0 Then
        key = Trim(Left(line, idx - 1))
        value = Trim(Mid(line, idx + 1))
        If env(key) = "" Then env(key) = value
      End If
    End If
  Next
  Set env = Nothing
End If

' Iniciar servidor oculto desde el directorio del script
shell.Run "cmd /c cd /d """ & scriptDir & """ && node server.js", 0, False

' Esperar un momento y abrir navegador
WScript.Sleep 3000
shell.Run "msedge --app=""http://localhost:3000"" --no-first-run", 1, False

Set shell = Nothing
Set fso = Nothing
