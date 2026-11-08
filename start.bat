@echo off
rem ---------------------------------------------------------------------------
rem  PouchWale configurator: one double-click starts everything.
rem    - database (embedded PostgreSQL on port 5433, no install needed)
rem    - API on port 4000 (applies migrations and seed data first)
rem    - web app on port 5173 (or the next free port if another app uses 5173)
rem  Then it opens the customer page in your browser.
rem  Stop: press Ctrl+C in this window (or just close it).
rem  Set PW_NO_BROWSER=1 to skip opening the browser.
rem ---------------------------------------------------------------------------
setlocal EnableExtensions
title PouchWale configurator
cd /d "%~dp0"
rem No Prisma update check: no internet call on each start (works offline at the stall).
set "CHECKPOINT_DISABLE=1"
set "PRISMA_HIDE_UPDATE_MESSAGE=1"

echo.
echo   PouchWale pouch configurator
echo   ============================
echo.

rem --- Node.js ------------------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 goto :no_node

rem --- Already running? -----------------------------------------------------------
netstat -ano -p tcp | findstr /c:":4000 " | findstr /c:"LISTENING" >nul
if not errorlevel 1 goto :busy_api

rem --- First run: packages ---------------------------------------------------------
if exist "node_modules\" goto :have_modules
echo   First run: installing packages. This takes a few minutes...
echo.
call npm install
if errorlevel 1 goto :install_failed
pushd server
call npx prisma generate
popd
echo.
:have_modules

rem --- First run: settings file ------------------------------------------------------
if exist "server\.env" goto :have_env
echo   First run: creating server\.env from server\.env.example with a new random JWT_SECRET and admin password.
copy /y "server\.env.example" "server\.env" >nul
node -e "const fs=require('fs'),c=require('crypto');const f='server/.env';const pw=c.randomBytes(12).toString('base64url');fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/^JWT_SECRET=.*$/m,'JWT_SECRET='+c.randomBytes(48).toString('hex')).replace(/^ADMIN_PASSWORD=.*$/m,'ADMIN_PASSWORD='+pw));console.log('  Admin login: admin@pouchwale.com / '+pw+'   (also saved in server\\.env)')"
echo   Write that password down, then change it in the admin panel: Change password, top right.
echo.
:have_env

rem --- Web port: 5173, or the next free one ---------------------------------------------
set "WEB_PORT="
for %%P in (5173 5180 5181 5182 5183 5184) do call :try_port %%P
if not defined WEB_PORT goto :no_port
set "URL=http://localhost:%WEB_PORT%"

echo   Customer page : %URL%
echo   Admin panel   : %URL%/admin
if not "%WEB_PORT%"=="5173" echo   (Port 5173 is used by another app, so PouchWale uses %WEB_PORT%.)
echo   iPad on the same Wi-Fi: use the "Network:" address printed below.
echo   Stop: press Ctrl+C in this window.
echo.

rem --- Open the browser once the API and the web app answer (up to 3 minutes) -----------------
if not defined PW_NO_BROWSER start "" /min powershell -NoProfile -WindowStyle Hidden -Command "for ($i = 0; $i -lt 180; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:4000/api/health' | Out-Null; Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%URL%' | Out-Null; Start-Process '%URL%'; break } catch { Start-Sleep -Seconds 1 } }"

rem --- Run database + API + web together ----------------------------------------------------
call npx concurrently -n db,api,web -c yellow,blue,magenta "npm run db -w server" "npm run dev:wait -w server" "npm run dev -w client -- --port %WEB_PORT% --strictPort"
endlocal
exit /b 0

rem ===========================================================================================
:try_port
if defined WEB_PORT exit /b 0
netstat -ano -p tcp | findstr /c:":%1 " | findstr /c:"LISTENING" >nul
if errorlevel 1 set "WEB_PORT=%1"
exit /b 0

:no_node
echo   Node.js is not installed. Install Node 20 or newer from https://nodejs.org and run start.bat again.
goto :fail

:busy_api
echo   Port 4000 is already in use: PouchWale is probably running in another window.
echo   Close that window first, or open the page it shows, then run start.bat again if needed.
goto :fail

:install_failed
echo   "npm install" failed. Check your internet connection and try again.
goto :fail

:no_port
echo   No free port for the web app: 5173 and 5180-5184 are all in use.
goto :fail

:fail
echo.
pause
endlocal
exit /b 1
