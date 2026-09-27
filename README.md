# Operit WorkBuddy Bridge

一个 **Operit ToolPkg 插件**，用于在 Operit 的持久终端会话里管理本地 [workbuddy2api](https://github.com/weecliz/workbuddy2api) 反代服务。

> ⚠️ **免责声明 / 风险提示**
> WorkBuddy / CodeBuddy 反代存在**账号封禁风险**，请务必使用**小号**测试。
> 本项目仅做本地进程管理，不对上游服务的使用后果负责。请遵守对应服务的使用条款。

---

## 这是什么

[workbuddy2api](https://github.com/weecliz/workbuddy2api) 是一个把腾讯 WorkBuddy / CodeBuddy（代码助手）桌面端登录态转成 OpenAI / Anthropic 兼容 API 的本地反代项目。

本插件把它的**启动、停止、状态查询、打开管理后台**这些操作，封装成 Operit 工具箱里的一个可视化界面 + 4 个 AI 可直接调用的工具。

### 为什么需要插件

Operit ToolPkg 运行在 **QuickJS 沙盒**里，不是 Node.js：

- ❌ 没有 `child_process`，不能 `spawn` 进程
- ❌ 不能直接创建 HTTP 服务器 / 监听端口
- ✅ 只能通过 **Operit Terminal API**（`terminal.create` / `terminal.exec`）在**持久终端**里操作外部进程

所以本插件的做法是：**在 Operit 的可见持久终端会话里**执行 `cd` + `nohup python main.py &`，参考了 [liqiming-whu/codex-control](https://github.com/liqiming-whu/codex-control) 的思路——**全程走 visible 持久终端，不使用 `hiddenExec`**，方便用户随时看到实际执行的命令。

---

## 功能

| 功能 | 说明 |
|------|------|
| 🔧 **配置界面** | 填写代理端口（默认 8790）、代理目录路径 |
| ▶️ **启动** | 在持久终端里 `cd` 到代理目录，`nohup python main.py > proxy.log 2>&1 &` |
| ⏹ **停止** | 优先按端口杀 `lsof -ti:8790 \| xargs kill`，兜底 `pkill -f "python main.py"` |
| 📊 **状态查询** | 方式 A：`pgrep` 检查进程是否存活；方式 B：`curl -s http://127.0.0.1:8790/admin` 检查后台是否响应 |
| 🌐 **打开管理后台** | 拉起系统浏览器打开 `http://127.0.0.1:8790/admin`，用于 OAuth 登录加号 / 导入桌面端登录态 |

界面还内置了**封号风险警告**和**管理后台默认登录凭据提示**。

---

## 提供的工具（AI 可调用）

| 工具 | 说明 |
|------|------|
| `proxy_control:proxy_start` | 启动反代 |
| `proxy_control:proxy_stop` | 停止反代 |
| `proxy_control:proxy_status` | 查询状态（进程存活 + 管理后台响应）|
| `proxy_control:proxy_open_admin` | 打开管理后台 |

装好插件后，你也可以直接对 Operit AI 说「启动 WorkBuddy 反代」「查一下反代状态」等。

---

## 安装

### 方式一：导入 `.toolpkg`（推荐）

1. 下载 `workbuddy_proxy_control.toolpkg`
2. 在 Operit 里导入：把它放入 Operit 的外部包目录，或用 Operit 的插件导入功能
3. 启用插件，并在「环境配置」里填写：
   - `WORKBUDDY_PROXY_PORT`：代理端口，默认 `8790`
   - `WORKBUDDY_PROXY_DIR`：含 `main.py` 的 workbuddy2api 目录路径

### 方式二：从源码构建

```bash
# 需要 TypeScript
npm install -g typescript

git clone https://github.com/Xouerr/Operit-WorkBuddy-Bridge.git
cd Operit-WorkBuddy-Bridge
tsc -p tsconfig.json    # 产物输出到 dist/
```

构建后用 Operit 的 ToolPkg 调试安装功能加载本目录。

---

## 使用前置：准备 workbuddy2api

插件只是「遥控器」，反代本体需要你自己部署：

```bash
# 1. 拉取反代项目（建议放在 Linux 侧目录，便于跑 Python）
git clone https://github.com/weecliz/workbuddy2api
cd workbuddy2api

# 2. 准备 Python 环境（示例用 uv，也可用 venv + pip）
uv venv .venv
uv pip install --python .venv/bin/python -r requirements.txt

# 3. 记住这个目录，填到插件的「代理目录」里
pwd
```

> 插件的启动命令会**自动优先使用项目内的 `.venv/bin/python`**（若存在），否则回退到 `python3`，所以推荐把虚拟环境建在项目目录下的 `.venv`。

---

## 使用步骤

1. **配置**：在插件界面填写端口和代理目录，点「保存配置」
2. **启动**：点「启动」——状态卡片变绿「运行中」
3. **排错**：若启动失败，看日志 `cat <代理目录>/proxy.log`
4. **加号**：点「打开管理后台」，在浏览器里完成 OAuth 登录加号 / 导入桌面端登录态
5. **建 Key**：在后台「API Keys」页创建账号池 Key（67 字符），配给客户端
6. **接客户端**：
   - OpenAI SDK：`base_url: http://127.0.0.1:8790/v1`
   - Claude Code：`base_url: http://127.0.0.1:8790`（注意：不要再带 `/v1`）

### 管理后台默认登录凭据

| 项 | 默认值 |
|----|--------|
| 用户名 | `admin` |
| 密码 | `admin123` |

> ⚠️ 这是弱口令，部署后请尽快在后台修改，并建议同时设置强 `ADMIN_JWT_SECRET`。

---

## 已知问题 / 提示

- **反代强制流式的问题**：截至撰写时，workbuddy2api 的号池网关 `/v1/chat/completions` 端点会**无视 `stream:false` 强制返回 SSE**，导致部分按非流式 JSON 解析的客户端（如 Operit 的默认 OpenAI 客户端）报 `String cannot be converted to JSONObject`。如需在 Operit 里当模型用，需要给反代的 `admin/routers/proxy.py` 补一个非流式聚合分支（参考其 `/v1/responses` 端点的做法）。
- **目录路径**：插件会把 `/sdcard/...` 自动映射为 Linux 侧的 `/storage/emulated/0/...`；相对路径按 `/sdcard/Download/` 补全。含 `main.py` 的目录必须在**持久终端可访问**的位置。
- **端口冲突**：启动前插件会先停掉旧进程，避免端口占用。

---

## 目录结构

```
Operit-WorkBuddy-Bridge/
├── manifest.json                    # ToolPkg 清单（含子包声明）
├── tsconfig.json
├── src/
│   ├── main.ts                      # ToolPkg 主入口（注册 UI 模块）
│   ├── core.ts                      # 核心逻辑：终端会话、启停、状态、路径转换
│   ├── packages/
│   │   └── proxy_control.ts         # 子包：4 个工具（含 METADATA）
│   └── ui/
│       └── settings/
│           └── index.ui.ts          # Compose DSL 配置 + 控制界面
└── dist/                            # tsc 构建产物（插件实际加载这里）
```

---

## 技术要点

- **持久终端**：`Tools.System.terminal.create("workbuddy2api-proxy")` 按会话名复用同一终端会话
- **后台保活**：用 `nohup ... &` 保证进程在 `exec` 结束后继续存活
- **状态探测**：进程侧 `pgrep -f 'python3? main.py'`，服务侧 `curl /admin` 双保险
- **不用 hiddenExec**：所有命令都在 visible 持久终端里执行，可追溯

---

## License

MIT（不含 workbuddy2api 本体，那部分版权归其原作者）。

## 致谢

- [workbuddy2api](https://github.com/weecliz/workbuddy2api) — 反代本体
- [liqiming-whu/codex-control](https://github.com/liqiming-whu/codex-control) — 持久终端控制外部进程的思路参考
- [Operit](https://github.com/AAswordman/Operit) — ToolPkg 平台