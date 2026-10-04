# 卡账记 CardLedger

个人信用卡资产管理工具：管理多张信用卡的额度、账单、还款日和年费减免进度。单文件、零外部依赖、数据自持，部署到 Cloudflare Workers 即可全平台使用（Web / 手机 PWA）。

在线体验：[https://ginytem.github.io/card-ledger/](https://ginytem.github.io/card-ledger/)（演示站 · 内置虚拟数据，免登录直接体验，数据仅存本浏览器）

## 功能特性

- **卡片管理**：多银行多卡种，额度 / 账单日 / 还款日 / 年费周期等字段，支持新增、编辑、删除、详情
- **账单与还款**：账单金额与最低还款、一键标记已还、逾期标识，按账单日 / 还款日自动推算
- **额度管理**：永久 / 临时 / 可用额度，使用率三色进度条；每次调额自动留痕，详情页时间轴展示
- **年费减免**：刷次数 / 刷金额 / 积分兑换三种条件，进度条与状态，周期临近结束未达标自动提醒
- **仪表盘**：总授信 / 已用 / 可用 / 未来 7 天待还 KPI，账单还款日历（三种标注模式），信用卡列表（搜索 + 四种排序），近期提醒，年费概览
- **提醒**：还款日提前 N 天、年费未达标提醒；PushPlus / Bark / 邮件多渠道，同一提醒不重复
- **数据安全**：JSON 全量导出 / 恢复，CSV 导入导出（中文模板，同银行 + 尾号自动去重）
- **界面**：Apple Wallet 卡片视觉，深 / 浅双主题，移动端优先 + PC 适配，PWA 可安装

## 技术栈

- Cloudflare Workers（单文件 worker.js，前端 + API + 定时任务一体）
- Cloudflare D1（SQLite）数据库
- 零外部 CDN 依赖，前端资源全部内联

## 快速开始（本地开发）

环境要求：Node.js 18+

```bash
# 1. 安装依赖
cd card-ledger
npm install

# 2. 创建本地开发配置（仓库已提供模板，复制后填写自己的账号密码）
#    Windows: copy .dev.vars.example .dev.vars
#    macOS / Linux: cp .dev.vars.example .dev.vars
#    （.dev.vars 已 gitignore，不会进入仓库）

# 3. 初始化本地数据库（D1 本地模拟）
npx wrangler d1 execute card-ledger-db --local --file=./d1/init.sql

# 4. 启动本地服务
npm run dev
# 或直接双击 start-dev.bat
```

访问 http://127.0.0.1:8787 ，本地开发登录账号密码即 `.dev.vars` 中填写的 USERNAME / PASSWORD（模板默认 admin / admin）。**部署上线后登录账号为 wrangler.toml 中 USERNAME（默认 admin）与部署时 `wrangler secret put PASSWORD` 设置的密码；默认账号仅用于首次登录，登录后请在设置页「账号安全」尽快修改用户名与密码。**

停止服务：双击 `stop-dev.bat`

## 部署上线（Cloudflare Workers）

前置：Node.js 18+、Cloudflare 账号、域名（可选，推荐绑定自定义域名）。

```bash
# 1. 登录 Cloudflare（浏览器授权）
wrangler login

# 2. 创建 D1 数据库
wrangler d1 create card-ledger-db
# 把返回的 database_id 填入 wrangler.toml 的 [[d1_databases]] database_id

# 3. 初始化数据库表结构（含示例数据，可手动删除）
wrangler d1 execute card-ledger-db --remote --file=./d1/init.sql

# 4. 设置必需敏感配置（推荐用 Secret，加密存储、不进仓库；其余账号 / 密码 / 推送等配置部署后登录设置页自助完成）
wrangler secret put PASSWORD      # 你的登录密码（≥6 位，别用 admin123）；登录后可在设置页「账号安全」自助修改用户名与密码，无需再碰命令行
wrangler secret put TOKEN_SECRET  # 随机密钥：openssl rand -hex 32（token 签名密钥 + 密码盐，无法后台修改，必须部署前配置）
wrangler secret put PUSHPLUS_TOKEN # 可选：PushPlus token（也可直接在设置页「提醒设置」填写保存，二选一即可；不配置则 PushPlus 微信提醒不可用，可改用 Bark）
# 然后将 wrangler.toml [vars] 中对应的 PASSWORD / TOKEN_SECRET / PUSHPLUS_TOKEN 三项删除，
# 只保留 USERNAME 与 PUSHPLUS_API（非敏感项可留在 vars；USERNAME 仅为初始账号，登录后可在设置页修改）

# 5. 部署
wrangler deploy
```

部署完成后：

**6. 配置定时提醒（Cron）**
在 `wrangler.toml` 中已内置：

```toml
[triggers]
crons = ["0 1 * * *"]   # 每天 UTC 01:00 = 北京时间 09:00
```

执行 `wrangler deploy` 时会自动创建 Cron 触发器（部署日志会显示 `schedule: 0 1 * * *`）。如需修改，改 toml 后重新 deploy 即可；也可在控制台 Worker 详情 → Triggers 中调整。

**7. 绑定自定义域名**
控制台 → Workers & Pages → 找到 `card-ledger` → 打开 Worker 详情页（Overview 页面的 Worker URL 区下方）→ **Custom Domains and Routes** → **+ Add Domain** → 选择你的域名（如 `ginytem.com`）→ 输入子域名（如 `cards`）→ 保存。Cloudflare 会自动创建 DNS 记录并签发证书（约 1–3 分钟生效）。若域名尚未接入 Cloudflare，先在控制台添加站点（把域名 DNS 服务器改为 Cloudflare 提供的两个）。

**8. 验证**
- 访问域名，用部署时设置的账号密码登录（账号 = wrangler.toml 的 USERNAME，默认 admin；密码 = 第 4 步 wrangler secret put PASSWORD 设置的值；登录后请尽快在设置页修改默认账号）
- 设置页 → 提醒设置 → 推送渠道 → 启用 PushPlus 或 Bark 并保存 → 发送测试提醒，能收到消息即推送通道正常
- 启用两步验证（可选，推荐）

> **推送渠道二选一**：启用 Bark 后提醒改走 Bark（设备 Key 填设置页即可，无需部署配置）；未启用 Bark 时走 PushPlus（Token 可在设置页填写保存，或部署前配置 PUSHPLUS_TOKEN）。设置页顶部「提醒渠道状态」可查看各渠道当前是否已启用、已配置。

## 配置说明

| 配置 | 说明 |
|---|---|
| USERNAME / PASSWORD | 管理员登录账号 / 密码。账号默认 admin（wrangler.toml 中配置），密码部署时自行设置；均为初始值，登录后可在设置页「账号安全」自助修改用户名与密码；修改后旧账号（初始值）不再可用 |
| TOKEN_SECRET | 登录 token 签名密钥，**上线前必改为随机长字符串**（`openssl rand -hex 32`），用 Secret 设置；同时用作密码哈希盐 |
| PUSHPLUS_TOKEN | PushPlus 微信推送 token（pushplus.plus 注册获取），可选：设置页填写保存即可，也可用 Secret 配置 |
| PUSHPLUS_API | 推送接口地址，默认 PushPlus；可改为兼容 JSON（token, title, content）的邮件 / 通知接口 |
| bark_key（设置页） | Bark 设备 Key（iPhone 安装 Bark 后复制），在设置页「提醒设置」填写并保存，存于数据库，无需部署配置 |

> 上表中仅 `TOKEN_SECRET` 与 `PUSHPLUS_API` 需部署前配置（无法在设置页修改）；`USERNAME`、`PASSWORD`、`PUSHPLUS_TOKEN`、`bark_key` 均可部署后登录设置页自助修改或填写。

安全机制：登录返回 HMAC-SHA256 签名 token（7 天过期），无固定密钥硬编码；密码存数据库为 SHA-256 加盐哈希（不存明文）；设置接口不下发密码哈希与 2FA 密钥类字段（Bark / PushPlus 密钥仅登录后用于回填展示）；同一 IP 连续 5 次密码错误锁定 15 分钟；数据接口均需登录鉴权；部署到 Cloudflare 后自动启用 HTTPS。未登录可浏览仪表盘（不含明细数据），账单 / 设置 / 数据页需登录后访问。**部署后除初始密码与 TOKEN_SECRET 外，账号、密码、推送渠道等配置均可在设置页自助完成，无需再改配置文件。**

## 两步验证（2FA，可选）

设置页 → 两步验证：

1. 点「生成密钥」，用 Google Authenticator / 1Password 等标准 TOTP 认证器添加
2. 输入认证器显示的 6 位动态码完成启用
3. 启用后登录需密码 + 动态码

启用时生成 **10 个一次性恢复码**，请妥善保存（每个用后作废）。

**应急关闭**（丢失认证器且恢复码用完时）：删除数据库中的 2FA 配置后重新登录即可。

```sql
DELETE FROM settings WHERE key IN ('totp_secret','totp_enabled','totp_recovery');
```

- 本地：sqlite 工具直连 `.wrangler/state` 下 D1 文件执行
- 线上：Cloudflare 控制台 → D1 → card-ledger-db → 控制台执行；或 `wrangler d1 execute card-ledger-db --remote --command="..."`

## 数据导入导出与备份

- 设置页 → 备份与恢复：JSON 全量导出 / 导入恢复 / CSV 卡片导出
- 设置页 → 批量导入：下载 CSV 模板（中文表头：银行,卡种,尾号,状态,永久额度,临时额度,临时额度到期日,账单日,还款方式,还款日/天数,年费金额,年费周期起始,年费周期结束,已用额度,备注），一次导入多张卡片
  - 尾号若以 0 开头（如 0567），该列请设为文本格式或加 `'` 前缀，防止 Excel 吞掉前导 0
  - 同银行 + 同尾号已存在的卡片自动跳过，不会重复导入

## 目录结构

```
card-ledger/
├── worker.js          # 单文件应用（前端 + API + 定时任务）
├── wrangler.toml      # Cloudflare 配置（vars / D1 / Cron）
├── d1/init.sql        # 数据库初始化脚本
├── demo/index.html    # 演示站（GitHub Pages，内置虚拟数据）
├── build_demo.py      # 演示站构建脚本（从 worker.js 提取前端）
├── templates/         # 批量导入模板（CSV + 导入说明）
├── start-dev.bat      # Windows 本地启动脚本
├── stop-dev.bat       # Windows 本地停止脚本
└── package.json       # wrangler 依赖与脚本
```

## 发布记录

### v1.1.0（2026-10-04）

- **新增 Bark 推送**：iOS 推送通道，设备 Key 在设置页填写保存即可，启用后定时提醒改走 Bark
- **新增自助修改密码**：登录后可在「账号安全」修改登录密码，密码以加盐哈希存储，不存明文
- **未登录访问策略**：未登录可直接浏览仪表盘，账单 / 设置 / 数据页需登录后访问；敏感接口不对外暴露
- **2FA 二维码**：启用两步验证时，桌面端展示二维码（扫码添加），移动端展示密钥字符串，支持一键复制
- **体验优化**：移动端还款日历宽度对齐，设置页分区更清晰，演示站默认展示虚拟数据

### v1.0.0（第一版上线 · 2026-10-03）

首个公开版本，已上线 Cloudflare Workers + D1 生产环境，GitHub 开源仓库 [Ginytem/card-ledger](https://github.com/Ginytem/card-ledger)。

- 卡片管理（14+ 字段）、账单与还款（标记已还 / 逾期）、额度管理（使用率三色规则）
- 额度变更历史时间轴、年费减免规则与进度（三种条件、四种状态）
- 仪表盘：KPI（总授信 / 已用 / 可用 / 未来 7 天待还 / 年费概览）、账单还款日历（三态标注）、信用卡表格列表（四种排序 + 搜索）、近期提醒
- 提醒：还款提前 N 天、年费提前 60 天未达标，PushPlus 微信推送（免重复），设置页测试推送
- 数据：JSON / CSV 导入导出、CSV 批量导入模板、同银行多卡额度合并统计
- 安全：动态签名 token、登录限流、全接口鉴权、可选 2FA + 恢复码
- 体验：深 / 浅双主题、PWA 可安装、移动端优先 + PC 全宽表格、品牌图标与 favicon
- 演示站：GitHub Pages 在线体验（内置虚拟数据，本地模拟）
