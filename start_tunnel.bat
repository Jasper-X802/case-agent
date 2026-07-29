@echo off
title Case Agent Tunnel
echo.
echo  ========================================
echo    Case Agent - å¬ç½é§éå¯å¨å¨
echo  ========================================
echo.
echo  æ­£å¨å°è¯å»ºç«å¬ç½é§é...
echo  å¦æè¿æ¥æåï¼ä¼æ¾ç¤ºä¸ä¸ª https:// å¼å¤´çç½å
echo  å°è¯¥ç½ååäº«ç»ä»»ä½äººå³å¯è®¿é®
echo.
echo  æ Ctrl+C å¯å³é­é§é
echo.
:retry
echo [1] å°è¯ localhost.run...
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 80:localhost:3900 nokey@localhost.run
if %ERRORLEVEL% NEQ 0 (
  echo [2] å°è¯ pinggy...
  ssh -p 443 -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R0:localhost:3900 a.pinggy.io
)
echo.
echo é§éæ­å¼ï¼5ç§åéè¯...
ping -n 5 127.0.0.1 > nul
goto retry
