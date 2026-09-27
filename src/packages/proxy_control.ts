/* METADATA
{
  name: proxy_control
  display_name: {
    zh: "WorkBuddy 反代控制",
    en: "WorkBuddy Proxy Control"
  }
  description: {
    zh: "通过 Operit 持久终端会话（visible）管理本地 workbuddy2api 反代：配置、启动、停止、状态查询、打开管理后台。注意封号风险，建议使用小号。",
    en: "Manage a local workbuddy2api proxy through Operit's persistent (visible) terminal session: configure, start, stop, status, open admin. Account-ban risk, use a secondary account."
  }
  category: "Network"
  env: ["WORKBUDDY_PROXY_PORT", "WORKBUDDY_PROXY_DIR"]
  tools: [
    {
      name: proxy_start,
      description: {
        zh: "启动 WorkBuddy 反代：在持久终端中 cd 到代理目录并后台运行 python main.py（日志写 proxy.log）。未配置目录或目录中缺少 main.py 时会返回错误提示。",
        en: "Start the WorkBuddy proxy: cd into the proxy dir in the persistent terminal and run python main.py in the background (logs to proxy.log). Returns an error hint if dir is unset or main.py is missing."
      },
      parameters: []
    },
    {
      name: proxy_stop,
      description: {
        zh: "停止 WorkBuddy 反代：优先按端口 kill（lsof -ti:PORT），并兜底 pkill 'python main.py'。",
        en: "Stop the WorkBuddy proxy: kill by port (lsof -ti:PORT) first, with pkill 'python main.py' as fallback."
      },
      parameters: []
    },
    {
      name: proxy_status,
      description: {
        zh: "查询 WorkBuddy 反代状态：方式 A 检查进程是否存活，方式 B curl 检查管理后台 /admin 是否响应。",
        en: "Check WorkBuddy proxy status: (A) whether the process is alive, (B) whether the /admin console responds via curl."
      },
      parameters: []
    },
    {
      name: proxy_open_admin,
      description: {
        zh: "用系统浏览器打开 WorkBuddy 反代管理后台（http://127.0.0.1:PORT/admin），方便进行 OAuth 登录加号或导入桌面端登录态。",
        en: "Open the WorkBuddy admin console (http://127.0.0.1:PORT/admin) in the system browser for OAuth login or importing desktop session state."
      },
      parameters: []
    }
  ]
}*/

import {
  DEFAULT_PORT,
  readConfig,
  ensureSession,
  startProxy,
  stopProxy,
  getStatus,
  toLinuxPath,
  ENV_KEY_PORT,
  ENV_KEY_DIR,
  ADMIN_PATH,
} from "../core.js";

function toErrorText(error: unknown): string {
  if (error instanceof Error) return error.message || "unknown";
  return String(error || "unknown");
}

// 警告：WorkBuddy 反代存在封号风险，建议使用小号。
const BAN_WARNING = "⚠ 注意：WorkBuddy 反代存在封号风险，建议使用小号测试。";

async function proxy_start(_params = {}): Promise<unknown> {
  const cfg = readConfig();
  const sessionId = await ensureSession();
  const result = await startProxy(sessionId, cfg.linuxDir);
  return {
    success: result.ok,
    message: result.message,
    linux_dir: cfg.linuxDir,
    port: cfg.port,
    warning: BAN_WARNING,
  };
}

async function proxy_stop(_params = {}): Promise<unknown> {
  const cfg = readConfig();
  const sessionId = await ensureSession();
  const result = await stopProxy(sessionId, cfg.port);
  return {
    success: result.ok,
    message: result.message,
    port: cfg.port,
    warning: BAN_WARNING,
  };
}

async function proxy_status(_params = {}): Promise<unknown> {
  const cfg = readConfig();
  const status = await getStatus(cfg.port);
  return {
    success: true,
    running: status.running,
    process_alive: status.processAlive,
    admin_reachable: status.adminReachable,
    admin_url: status.adminUrl,
    detail: status.detail,
    port: status.port,
    warning: BAN_WARNING,
  };
}

async function proxy_open_admin(_params = {}): Promise<unknown> {
  const cfg = readConfig();
  const url = `http://127.0.0.1:${cfg.port}${ADMIN_PATH}`;
  try {
    const r = await Tools.System.intent({
      type: "activity",
      action: "android.intent.action.VIEW",
      uri: url,
    });
    return {
      success: true,
      url,
      message: "已尝试用浏览器打开管理后台，请在其中完成 OAuth 登录加号或导入桌面端登录态。",
      intent: r || null,
      warning: BAN_WARNING,
    };
  } catch (e: unknown) {
    return {
      success: false,
      url,
      message: "打开浏览器失败：" + toErrorText(e) + "，请手动访问该地址。",
      warning: BAN_WARNING,
    };
  }
}

export { proxy_start, proxy_stop, proxy_status, proxy_open_admin };
export default { proxy_start, proxy_stop, proxy_status, proxy_open_admin };