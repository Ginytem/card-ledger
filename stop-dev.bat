@echo off
rem 卡账记 - 停止本地开发服务
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'wrangler' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo 服务已停止（如有残留 node 进程请检查任务管理器）。
