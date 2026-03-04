Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "C:\dev\MinimalTimer"
shell.Run """C:\Program Files\nodejs\npm.cmd"" run dev", 0, False
