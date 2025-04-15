@echo off

REM Load environment variables from .env file if it exists
if exist .env (
    for /F "tokens=*" %%i in (.env) do set %%i
)

REM Set default values if not defined in .env
if not defined BACKEND_PORT set BACKEND_PORT=7432
if not defined FRONTEND_PORT set FRONTEND_PORT=7433

REM Set up virtual environment if not already set up
if not exist .venv (
    python -m venv .venv
)

REM Activate virtual environment
call .venv\Scripts\activate.bat

REM Install dependencies
pip install -r requirements.txt || exit /b

REM Parse arguments
set BACKEND=false
set FRONTEND=false
for %%i in (%*) do (
    if "%%i"=="--backend" set BACKEND=true
    if "%%i"=="--frontend" set FRONTEND=true
)

REM Start the Python backend if --backend is specified or no arguments are provided
if "%BACKEND%"=="true" (
    start cmd /k "cd src && python app.py --port=%BACKEND_PORT%" || exit /b
)

REM Start the React frontend if --frontend is specified or no arguments are provided
if "%FRONTEND%"=="true" (
    cd frontend && set PORT=%FRONTEND_PORT% && npm start || exit /b
)

REM Start both backend and frontend if no arguments are provided
if "%BACKEND%"=="false" if "%FRONTEND%"=="false" (
    start cmd /k "cd src && python app.py --port=%BACKEND_PORT%"
    cd frontend && set PORT=%FRONTEND_PORT% && npm start || exit /b
)