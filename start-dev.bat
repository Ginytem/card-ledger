@echo off
rem 卡账记 - 本地开发服务启动脚本
cd /d "E:\card-ledger"
start "" /min cmd /c "npx wrangler dev --local --test-scheduled --ip 0.0.0.0 --port 8787 > .dev.log 2>&1"
echo 卡账记本地服务已启动，等待几秒后访问：
echo   http://127.0.0.1:8787
echo 登录账号见 .dev.vars（未创建请先复制 .dev.vars.example 为 .dev.vars 并填写）
echo 登录后可在设置页「账号安全」修改用户名与密码
echo 服务日志: .dev.log
