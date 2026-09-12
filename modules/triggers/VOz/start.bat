@echo off
if exist venv\Scripts\activate.bat call venv\Scripts\activate.bat
uvicorn server:app --reload --host 127.0.0.1 --port 8000
pause
