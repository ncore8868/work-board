@echo off
chcp 65001 >nul
title UNION ONE - 앱 아이콘 되살리기
echo.
echo  ============================================
echo   UNION ONE  앱 아이콘 되살리기
echo  ============================================
echo.
echo   워크보드 앱 아이콘이 옛날 그림으로 뜰 때 쓰는 파일입니다.
echo.
echo   크롬의 [데이터 제거] 로는 안 지워지는 두 곳을 비웁니다.
echo     1. 크롬이 따로 복사해 둔 앱 아이콘
echo     2. 윈도우가 기억해 둔 아이콘 그림
echo.
echo   [ 주의 ]  크롬이 잠깐 닫힙니다. 저장 안 한 것이 있으면 먼저 저장하세요.
echo            화면이 잠깐 깜빡입니다. 정상입니다.
echo.
set /p GO=  계속할까요? (Y 를 누르고 엔터) : 
if /i not "%GO%"=="Y" goto BYE
echo.
echo  [1/5] 크롬을 닫습니다...
taskkill /F /IM chrome.exe >/dev/null 2>&1
timeout /t 2 /nobreak >nul
echo  [2/5] 크롬이 복사해 둔 앱 아이콘을 지웁니다...
set CUD=%LOCALAPPDATA%\Google\Chrome\User Data
if not exist "%CUD%" goto NOCHROME
for /d %%P in ("%CUD%\Default" "%CUD%\Profile *") do if exist "%%~P\Web Applications" rd /s /q "%%~P\Web Applications" 2>nul
goto ICONS
:NOCHROME
echo        크롬 폴더를 못 찾았습니다. 다음 단계로 넘어갑니다.
:ICONS
echo  [3/5] 윈도우가 기억해 둔 아이콘을 지웁니다...
taskkill /F /IM explorer.exe >/dev/null 2>&1
timeout /t 1 /nobreak >nul
del /f /q "%LOCALAPPDATA%\IconCache.db" >/dev/null 2>&1
del /f /a /q "%LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache_*.db" >/dev/null 2>&1
del /f /a /q "%LOCALAPPDATA%\Microsoft\Windows\Explorer\thumbcache_*.db" >/dev/null 2>&1
echo  [4/5] 바탕화면을 다시 켭니다...
start explorer.exe
timeout /t 2 /nobreak >nul
echo  [5/5] 끝났습니다.
echo.
echo  ============================================
echo   이제 이렇게 하세요
echo  ============================================
echo.
echo   1. 크롬을 엽니다
echo   2. 주소창에  ncore8868.github.io/work-board/  를 칩니다
echo   3. 주소창 오른쪽 끝 [설치] 단추를 눌러 다시 설치합니다
echo.
echo   그래도 옛날 아이콘이면 컴퓨터를 한 번 껐다 켜 주세요.
echo.
pause
goto :EOF
:BYE
echo.
echo   그만둡니다. 아무것도 바꾸지 않았습니다.
echo.
pause
