@echo off
cd /d "%~dp0"
start "" "http://127.0.0.1:8765/index.html"
"C:\Users\USER\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" "%~dp0servidor-local.js"
