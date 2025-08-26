@echo off
setlocal enabledelayedexpansion

echo Configuration de l'environnement EcoScope
echo ======================================
echo.

if exist ".env" (
    set /p KEEP_ENV=Le fichier .env existe déjà. Voulez-vous le conserver ? (o/N) 
    if /i "!KEEP_ENV!"=="n" (
        copy /Y .env .env.backup >nul
        echo Une sauvegarde a été créée : .env.backup
        del .env >nul
    ) else (
        echo Le fichier .env actuel sera conservé.
        goto :end
    )
)

rem Valeurs par défaut
set PORT=5002
set NODE_ENV=development
set VITE_API_URL=http://localhost:5002

rem Configuration interactive
set /p INPUT_PORT=Port du serveur [5002]: 
if not "!INPUT_PORT!"=="" set PORT=!INPUT_PORT!

set /p INPUT_NODE_ENV=Environnement (development/production) [development]: 
if not "!INPUT_NODE_ENV!"=="" set NODE_ENV=!INPUT_NODE_ENV!

set /p INPUT_VITE_API_URL=URL de l'API [http://localhost:5002]: 
if not "!INPUT_VITE_API_URL!"=="" set VITE_API_URL=!INPUT_VITE_API_URL!

echo. > .env
echo # Configuration du serveur >> .env
echo PORT=!PORT! >> .env
echo NODE_ENV=!NODE_ENV! >> .env
echo. >> .env
echo # Configuration du frontend >> .env
echo VITE_API_URL=!VITE_API_URL! >> .env

echo.
echo Configuration terminée !

:end
pause
