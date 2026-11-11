@echo off
setlocal
set "ROOT=%~dp0"
if defined SHINCHAN_MODEL (set "MODEL=%SHINCHAN_MODEL%") else (set "MODEL=%ROOT%shinchan.glb")
if not exist "%MODEL%" (echo Model not found: %MODEL% 1>&2 & exit /b 1)
copy /Y "%MODEL%" "%ROOT%overlay-web\public\models\shinchan.glb" >nul || exit /b 1
cd /d "%ROOT%overlay-web" || exit /b 1
if not exist "node_modules\vite\bin\vite.js" (
  call npm ci || exit /b 1
)
call npm run build
if errorlevel 1 (
  echo Vite could not start. Trying the bundled Rollup fallback...
  call npm run build:offline || exit /b 1
)
if not exist "%ROOT%overlay-web\dist\models\shinchan.glb" (echo Built overlay is missing models\shinchan.glb 1>&2 & exit /b 1)
if not exist "%ROOT%overlay-web\dist\animations\manifest.json" (echo Built overlay is missing animations\manifest.json 1>&2 & exit /b 1)
if not exist "%ROOT%android-app\app\src\main\assets\overlay" mkdir "%ROOT%android-app\app\src\main\assets\overlay"
xcopy /E /I /Y "%ROOT%overlay-web\dist\*" "%ROOT%android-app\app\src\main\assets\overlay\" >nul || exit /b 1
if not exist "%ROOT%android-app\app\src\main\assets\overlay\models\shinchan.glb" (echo Android assets are missing models\shinchan.glb 1>&2 & exit /b 1)
if not exist "%ROOT%android-app\app\src\main\assets\overlay\animations\manifest.json" (echo Android assets are missing animations\manifest.json 1>&2 & exit /b 1)
echo Overlay built and synced to Android assets.
