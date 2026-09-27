/**
 * core.ts - WorkBuddy 反代控制核心逻辑
 *
 * 说明：
 * - ToolPkg 运行在 QuickJS 沙盒中，不是 Node.js：
 *   没有 child_process、不能监听端口，所有系统操作都通过
 *   Operit Terminal API（system.terminal）在持久终端会话里完成。
 * - 参考 codex-control 的做法：全程使用 visible 持久终端会话
 *   （terminal.create 按会话名复用），不使用 hiddenExec。
 *
 * 警告：WorkBuddy 反代存在封号风险，请使用小号测试。
 */

export const DEFAULT_PORT = 8790;
export const ENV_KEY_PORT = "WORKBUDDY_PROXY_PORT";
export const ENV_KEY_DIR = "WORKBUDDY_PROXY_DIR";
export const TERMINAL_SESSION_NAME = "workbuddy2api-proxy";
export const ADMIN_PATH = "/admin";

export interface ProxyConfig {
  port: number;
  /** 用户在配置界面填写的目录（Android 路径或 Linux 路径） */
  dirInput: string;
  /** 终端实际使用的 Linux 侧路径 */
  linuxDir: string;
}

export interface ProxyStatus {
  running: boolean;
  processAlive: boolean;
  adminReachable: boolean;
  adminBody: string;
  port: number;
  adminUrl: string;
  detail: string;
}

/**
 * 把用户填写的目录路径转换成 proot Linux 侧可用的绝对路径。
 * - 已以 / 开头的 Linux 路径（如 /home/xxx）原样使用
 * - /sdcard/... 或 /storage/... 直接使用（proot 内已挂载）
 * - 相对路径按 Download 目录下补全
 */
export function toLinuxPath(input: string): string {
  const raw = (input || "").trim();
  if (!raw) return "";
  let p = raw;
  if (!p.startsWith("/")) {
    p = "/sdcard/Download/" + p;
  }
  if (p.startsWith("/sdcard/")) {
    p = "/storage/emulated/0" + p.slice("/sdcard".length);
  }
  while (p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  return p;
}

export function parsePort(raw: string | number | undefined, fallback: number): number {
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 1 && n <= 65535) return n;
  return fallback;
}

/** 从 env 读取配置（沙盒脚本全局 getEnv）。 */
export function readConfig(): ProxyConfig {
  let portRaw = "";
  let dirRaw = "";
  try {
    portRaw = getEnv(ENV_KEY_PORT) || "";
    dirRaw = getEnv(ENV_KEY_DIR) || "";
  } catch (_e) {
    // 忽略，使用默认值
  }
  const port = parsePort(portRaw, DEFAULT_PORT);
  const dirInput = String(dirRaw || "").trim();
  return { port, dirInput, linuxDir: toLinuxPath(dirInput) };
}

/** 确保拿到（或创建）持久终端会话。 */
export async function ensureSession(): Promise<string> {
  const created = await Tools.System.terminal.create(TERMINAL_SESSION_NAME);
  if (!created || !created.sessionId) {
    throw new Error("terminal.create 未返回 sessionId");
  }
  return created.sessionId;
}

/**
 * 执行命令并拿到完整 stdout。
 * 返回 { ok, timedOut, output }，ok 表示命令在超时前正常结束。
 */
async function execCapture(
  sessionId: string,
  command: string,
  timeoutMs: number
): Promise<{ ok: boolean; timedOut: boolean; output: string }> {
  const r = await Tools.System.terminal.exec(sessionId, command, timeoutMs);
  return {
    ok: !!(r && r.exitCode === 0),
    timedOut: !!(r && r.timedOut),
    output: r && typeof r.output === "string" ? r.output : "",
  };
}

/** 方式 A：检查进程是否存活（pgrep 匹配 python main.py）。 */
export async function checkProcessAlive(sessionId: string): Promise<boolean> {
  try {
    const r = await execCapture(
      sessionId,
      "pgrep -f 'python3? main.py' >/dev/null 2>&1 && echo ALIVE || echo DEAD",
      10000
    );
    if (r.timedOut) return false;
    return /ALIVE/.test(r.output) && !/DEAD/.test(r.output);
  } catch (_e) {
    return false;
  }
}

/** 方式 B：curl 检查管理后台是否响应。返回是否响应 + 响应片段。 */
export async function checkAdminReachable(
  sessionId: string,
  port: number
): Promise<{ reachable: boolean; body: string }> {
  const cmd =
    `code=$(curl -s -m 5 -o /tmp/wb2api_admin.txt -w "%{http_code}" ` +
    `http://127.0.0.1:${port}${ADMIN_PATH} 2>/dev/null); ` +
    `echo "HTTP=$code"; head -c 300 /tmp/wb2api_admin.txt 2>/dev/null`;
  try {
    const r = await execCapture(sessionId, cmd, 20000);
    if (r.timedOut) return { reachable: false, body: "curl 超时" };
    const m = r.output.match(/HTTP=(\d{3})/);
    const code = m ? Number(m[1]) : 0;
    const body = r.output.replace(/^[\s\S]*?HTTP=\d{3}\s*/, "").trim();
    return { reachable: code >= 200 && code < 500, body: body.slice(0, 300) };
  } catch (e: unknown) {
    return { reachable: false, body: String(e) };
  }
}

/** 在持久终端里检查 main.py 是否存在，返回是否就绪。 */
export async function checkDirReady(sessionId: string, linuxDir: string): Promise<boolean> {
  const cmd = `test -f "${linuxDir}/main.py" && echo DIRREADY || echo DIRNOTREADY`;
  try {
    const r = await execCapture(sessionId, cmd, 10000);
    return r.output.includes("DIRREADY");
  } catch (_e) {
    return false;
  }
}

/**
 * 启动反代：cd 到代理目录，nohup 后台运行 python main.py，日志写 proxy.log。
 * 使用 nohup + & 保证后台进程在 exec 结束后继续存活。
 */
export async function startProxy(sessionId: string, linuxDir: string): Promise<{ ok: boolean; message: string }> {
  if (!linuxDir) {
    return { ok: false, message: "代理目录未配置（proxy_dir 为空）" };
  }
  const ready = await checkDirReady(sessionId, linuxDir);
  if (!ready) {
    return {
      ok: false,
      message: `目录中未找到 main.py：${linuxDir}（请先 clone workbuddy2api 并配置正确目录）`
    };
  }
  // 先杀掉旧进程，避免端口占用
  await stopProxy(sessionId);

  // 自动优先用项目内 .venv/bin/python（依赖随项目走），否则回退 python3
  const cmd =
    `cd "${linuxDir}" && ` +
    `PY=python3; ` +
    `[ -x .venv/bin/python ] && PY=.venv/bin/python; ` +
    `nohup "$PY" main.py > proxy.log 2>&1 & ` +
    `echo STARTED_PID=$!`;
  try {
    await execCapture(sessionId, cmd, 15000);
    // 给进程一点启动时间
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return { ok: true, message: "已启动，日志见代理目录下 proxy.log" };
  } catch (e: unknown) {
    return { ok: false, message: "启动失败：" + String(e) };
  }
}

/** 停止反代：优先按端口杀，兜底 pkill 命令行。 */
export async function stopProxy(sessionId: string, port?: number): Promise<{ ok: boolean; message: string }> {
  const p = parsePort(port, DEFAULT_PORT);
  const cmd =
    `(lsof -ti:${p} 2>/dev/null | xargs -r kill -9 2>/dev/null; ` +
    `pkill -f "python3? main.py" 2>/dev/null; ` +
    `sleep 1; echo STOP_DONE) >/dev/null 2>&1`;
  try {
    await execCapture(sessionId, cmd, 20000);
    return { ok: true, message: `已尝试停止端口 ${p} 上的反代进程` };
  } catch (e: unknown) {
    return { ok: false, message: "停止失败：" + String(e) };
  }
}

/** 综合状态查询：进程存活 + 管理后台响应。 */
export async function getStatus(port: number): Promise<ProxyStatus> {
  const sessionId = await ensureSession();
  const processAlive = await checkProcessAlive(sessionId);
  const admin = await checkAdminReachable(sessionId, port);
  const running = processAlive || admin.reachable;
  return {
    running,
    processAlive,
    adminReachable: admin.reachable,
    adminBody: admin.body,
    port,
    adminUrl: `http://127.0.0.1:${port}${ADMIN_PATH}`,
    detail:
      (processAlive ? "[A] 进程存活 " : "[A] 进程未运行 ") +
      (admin.reachable ? "[B] 管理后台响应正常" : "[B] 管理后台无响应")
  };
}
