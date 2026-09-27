import type { ComposeDslContext, ComposeNode } from "../../../../types/compose-dsl";
import {
  DEFAULT_PORT,
  ENV_KEY_PORT,
  ENV_KEY_DIR,
  ADMIN_PATH,
  toLinuxPath,
  parsePort,
} from "../../core.js";

const BAN_WARNING = "⚠ 注意：WorkBuddy 反代存在封号风险，建议使用小号测试。";
const DEFAULT_ADMIN_USER = "admin";
const DEFAULT_ADMIN_PASS = "admin123";

interface UiStatus {
  checking: boolean;
  started: boolean;
  stopped: boolean;
  running: boolean | null;
  processAlive: boolean | null;
  adminReachable: boolean | null;
  detail: string;
  error: string;
}

function useStateValue<T>(
  ctx: ComposeDslContext,
  key: string,
  initialValue: T
): { value: T; set: (value: T) => void } {
  const pair = ctx.useState<T>(key, initialValue);
  return { value: pair[0], set: pair[1] };
}
function toErrorText(error: unknown): string {
  if (error instanceof Error) return error.message || "unknown";
  return String(error || "unknown");
}


const SUBPACKAGE_ID = "proxy_control";

/** 确保子包已导入并激活（子包工具注册在 proxy_control 命名空间下）。 */
async function ensureSubpackage(ctx: ComposeDslContext): Promise<void> {
  const isImported = ctx.isPackageImported ? !!(await ctx.isPackageImported(SUBPACKAGE_ID)) : true;
  if (!isImported && ctx.importPackage) {
    const result = await ctx.importPackage(SUBPACKAGE_ID);
    const msg = String(result || "").toLowerCase();
    if (msg.includes("error") || msg.includes("failed") || msg.includes("not found")) {
      throw new Error(String(result || "import subpackage failed"));
    }
  }
  if (ctx.usePackage) {
    await ctx.usePackage(SUBPACKAGE_ID);
  }
}

export default function Screen(ctx: ComposeDslContext): ComposeNode {
  const portState = useStateValue(ctx, "portInput", String(ctx.getEnv(ENV_KEY_PORT) || DEFAULT_PORT));
  const dirState = useStateValue(ctx, "dirInput", String(ctx.getEnv(ENV_KEY_DIR) || ""));
  const statusState = useStateValue<UiStatus>(ctx, "status", {
    checking: false,
    started: false,
    stopped: false,
    running: null,
    processAlive: null,
    adminReachable: null,
    detail: "尚未查询。",
    error: "",
  });
  const busyState = useStateValue(ctx, "busy", "");
  const initState = useStateValue(ctx, "initialized", false);

  const setStatus = (patch: Partial<UiStatus>): void => {
    statusState.set({ ...statusState.value, ...patch });
  };

  const callSubTool = async (toolName: string): Promise<Record<string, unknown>> => {
    // 子包工具注册在 proxy_control:<tool> 命名空间下；先确保子包已激活。
    await ensureSubpackage(ctx);
    const candidates: string[] = [`${SUBPACKAGE_ID}:${toolName}`, toolName];
    if (ctx.resolveToolName) {
      try {
        const resolved = await ctx.resolveToolName({
          packageName: SUBPACKAGE_ID,
          toolName,
          preferImported: true,
        });
        const value = String(resolved || "").trim();
        if (value) candidates.unshift(value);
      } catch (_e) {
        // ignore
      }
    }
    let lastErr = "unknown";
    for (const name of candidates) {
      if (!name || candidates.indexOf(name) !== candidates.lastIndexOf(name)) continue;
      try {
        const r = await ctx.callTool<Record<string, unknown>>(name, {});
        if (r && typeof r === "object") return r;
        return { success: true, message: String(r || "") };
      } catch (e: unknown) {
        lastErr = toErrorText(e);
      }
    }
    throw new Error(lastErr);
  };

  const checkStatus = async (): Promise<void> => {
    setStatus({ checking: true, error: "" });
    try {
      const r = await callSubTool("proxy_status");
      setStatus({
        checking: false,
        running: !!r.running,
        processAlive: !!r.process_alive,
        adminReachable: !!r.admin_reachable,
        detail: String(r.detail || ""),
      });
    } catch (e: unknown) {
      setStatus({ checking: false, error: toErrorText(e) });
    }
  };

  const saveConfig = async (): Promise<void> => {
    setStatus({ error: "" });
    const port = parsePort(portState.value, DEFAULT_PORT);
    const dir = String(dirState.value || "").trim();
    try {
      await ctx.setEnv(ENV_KEY_PORT, String(port));
      await ctx.setEnv(ENV_KEY_DIR, dir);
      await ctx.showToast("配置已保存");
    } catch (e: unknown) {
      setStatus({ error: "保存配置失败：" + toErrorText(e) });
    }
  };

  const doStart = async (): Promise<void> => {
    if (busyState.value) return;
    await saveConfig();
    busyState.set("start");
    setStatus({ error: "", started: false, stopped: false });
    try {
      const r = await callSubTool("proxy_start");
      setStatus({ started: !!r.success, detail: String(r.message || "") });
      if (r.success) await checkStatus();
      else setStatus({ error: String(r.message || "启动失败") });
    } catch (e: unknown) {
      setStatus({ error: toErrorText(e) });
    } finally {
      busyState.set("");
    }
  };

  const doStop = async (): Promise<void> => {
    if (busyState.value) return;
    busyState.set("stop");
    setStatus({ error: "", started: false, stopped: false });
    try {
      const r = await callSubTool("proxy_stop");
      setStatus({ stopped: !!r.success, detail: String(r.message || "") });
      await checkStatus();
    } catch (e: unknown) {
      setStatus({ error: toErrorText(e) });
    } finally {
      busyState.set("");
    }
  };

  const doOpenAdmin = async (): Promise<void> => {
    await saveConfig();
    setStatus({ error: "" });
    const url = `http://127.0.0.1:${parsePort(portState.value, DEFAULT_PORT)}${ADMIN_PATH}`;
    // 优先在 UI 上下文里直接拉起系统浏览器（VIDEO/VIEW intent）。
    try {
      const intentFn = (Tools as unknown as {
        System?: { intent?: (o: Record<string, unknown>) => Promise<unknown> };
      })?.System?.intent;
      if (typeof intentFn === "function") {
        await intentFn({ type: "activity", action: "android.intent.action.VIEW", uri: url });
        setStatus({ detail: `已尝试打开管理后台：${url}` });
        return;
      }
    } catch (_e) {
      // 落到子包工具兜底
    }
    try {
      const r = await callSubTool("proxy_open_admin");
      if (!r.success) {
        setStatus({ error: String(r.message || "打开失败") + `（可手动访问 ${url}）` });
      } else {
        setStatus({ detail: String(r.message || `已打开 ${url}`) });
      }
    } catch (e: unknown) {
      setStatus({ error: toErrorText(e) + `（可手动访问 ${url}）` });
    }
  };

  const cfg = { port: parsePort(portState.value, DEFAULT_PORT), linuxDir: toLinuxPath(dirState.value) };
  const status = statusState.value;
  const busy = busyState.value;

  const statusCardColor = status.running === null
    ? "surfaceVariant"
    : status.running
      ? "primaryContainer"
      : "errorContainer";
  const statusTextColor = status.running === null
    ? "onSurfaceVariant"
    : status.running
      ? "onPrimaryContainer"
      : "onErrorContainer";
  const statusTitle = status.checking
    ? "查询中…"
    : status.running === null
      ? "未查询"
      : status.running
        ? "运行中"
        : "未运行";

  const rootChildren: Array<ComposeNode | null> = [
      ctx.UI.Row({ verticalAlignment: "center" }, [
        ctx.UI.Icon({ name: "swap_horiz", tint: "primary" }),
        ctx.UI.Spacer({ width: 8 }),
        ctx.UI.Text({
          text: "WorkBuddy 反代控制",
          style: "headlineSmall",
          fontWeight: "bold",
        }),
      ]),
      ctx.UI.Card({
        fillMaxWidth: true,
        containerColor: "errorContainer",
        shape: { cornerRadius: 12 },
        elevation: 0,
      }, [
        ctx.UI.Row({ padding: { horizontal: 14, vertical: 10 }, spacing: 8, verticalAlignment: "center" }, [
          ctx.UI.Icon({ name: "warning", tint: "onErrorContainer", size: 18 }),
          ctx.UI.Text({ text: BAN_WARNING, style: "bodyMedium", color: "onErrorContainer", weight: 1 }),
        ]),
      ]),

      // 配置卡片
      ctx.UI.Card({ fillMaxWidth: true }, [
        ctx.UI.Column({ padding: 16, spacing: 10 }, [
          ctx.UI.Row({ verticalAlignment: "center" }, [
            ctx.UI.Icon({ name: "settings", tint: "primary" }),
            ctx.UI.Spacer({ width: 8 }),
            ctx.UI.Text({ text: "配置", style: "titleMedium", fontWeight: "semibold" }),
          ]),
          ctx.UI.TextField({
            label: "代理端口",
            placeholder: "8790",
            value: portState.value,
            onValueChange: portState.set,
            singleLine: true,
          }),
          ctx.UI.TextField({
            label: "代理目录（含 main.py 的 workbuddy2api 目录）",
            placeholder: "/sdcard/Download/workbuddy2api 或 /home/xxx/workbuddy2api",
            value: dirState.value,
            onValueChange: dirState.set,
            singleLine: true,
          }),
          ctx.UI.Text({
            text: cfg.linuxDir
              ? `终端实际路径：${cfg.linuxDir}`
              : "未配置目录时，启动会失败。默认路径规则：/sdcard/... → /storage/emulated/0/...，相对路径按 /sdcard/Download/ 补全。",
            style: "bodySmall",
            color: "onSurfaceVariant",
          }),
          ctx.UI.Button({ text: "保存配置", fillMaxWidth: true, enabled: !busy, onClick: saveConfig }),
        ]),
      ]),

      // 状态卡片
      ctx.UI.Card({
        fillMaxWidth: true,
        containerColor: statusCardColor,
        shape: { cornerRadius: 12 },
      }, [
        ctx.UI.Column({ padding: 16, spacing: 8 }, [
          ctx.UI.Row({ verticalAlignment: "center" }, [
            ctx.UI.Icon({ name: status.running ? "play_circle" : "stop_circle", tint: statusTextColor }),
            ctx.UI.Spacer({ width: 8 }),
            ctx.UI.Text({ text: statusTitle, style: "titleMedium", color: statusTextColor, fontWeight: "semibold" }),
            ctx.UI.Spacer({ width: 8, weight: 1 }),
            ...(status.checking
              ? [ctx.UI.CircularProgressIndicator({ width: 16, height: 16, strokeWidth: 2, color: statusTextColor })]
              : []),
          ]),
          ctx.UI.Text({
            text: `进程存活(A)：${status.processAlive === null ? "未查询" : status.processAlive ? "是" : "否"}    管理后台(B)：${status.adminReachable === null ? "未查询" : status.adminReachable ? "响应正常" : "无响应"}`,
            style: "bodySmall",
            color: statusTextColor,
          }),
          ...(status.detail
            ? [ctx.UI.Text({ text: status.detail, style: "bodySmall", color: statusTextColor })]
            : []),
        ]),
      ]),

      // 操作按钮
      ctx.UI.Row({ fillMaxWidth: true, spacing: 10 }, [
        busy === "start"
          ? ctx.UI.Button({ enabled: false, weight: 1, onClick: doStart }, [
              ctx.UI.Row({ verticalAlignment: "center", horizontalArrangement: "center" }, [
                ctx.UI.CircularProgressIndicator({ width: 14, height: 14, strokeWidth: 2, color: "onPrimary" }),
                ctx.UI.Spacer({ width: 6 }),
                ctx.UI.Text({ text: "启动中…" }),
              ]),
            ])
          : ctx.UI.Button({ text: "启动", weight: 1, enabled: !busy, onClick: doStart }),
        busy === "stop"
          ? ctx.UI.Button({ enabled: false, weight: 1, onClick: doStop }, [
              ctx.UI.Row({ verticalAlignment: "center", horizontalArrangement: "center" }, [
                ctx.UI.CircularProgressIndicator({ width: 14, height: 14, strokeWidth: 2, color: "onPrimary" }),
                ctx.UI.Spacer({ width: 6 }),
                ctx.UI.Text({ text: "停止中…" }),
              ]),
            ])
          : ctx.UI.Button({ text: "停止", weight: 1, enabled: !busy, onClick: doStop }),
      ]),
      ctx.UI.Row({ fillMaxWidth: true, spacing: 10 }, [
        ctx.UI.Button({ text: "刷新状态", weight: 1, enabled: !busy && !status.checking, onClick: checkStatus }),
        ctx.UI.Button({
          text: "打开管理后台",
          weight: 1,
          enabled: !busy,
          onClick: doOpenAdmin,
        }),
      ]),
      ctx.UI.Card({
        fillMaxWidth: true,
        containerColor: "secondaryContainer",
        shape: { cornerRadius: 12 },
        elevation: 0,
      }, [
        ctx.UI.Column({ padding: 14, spacing: 4 }, [
          ctx.UI.Row({ verticalAlignment: "center", spacing: 8 }, [
            ctx.UI.Icon({ name: "key", tint: "onSecondaryContainer", size: 18 }),
            ctx.UI.Text({
              text: "管理后台登录（默认凭据）",
              style: "titleSmall",
              fontWeight: "semibold",
              color: "onSecondaryContainer",
            }),
          ]),
          ctx.UI.Text({
            text: `地址：http://127.0.0.1:${cfg.port}${ADMIN_PATH}\n用户名：${DEFAULT_ADMIN_USER}\n密码：${DEFAULT_ADMIN_PASS}`,
            style: "bodyMedium",
            color: "onSecondaryContainer",
          }),
          ctx.UI.Text({
            text: "默认密码为弱口令，建议部署后尽快在后台修改。",
            style: "bodySmall",
            color: "onSecondaryContainer",
          }),
        ]),
      ]),
      ctx.UI.Text({
        text: `管理后台用于 OAuth 登录加号 / 导入桌面端登录态。所有操作都在 Operit 持久终端会话里可见执行，不使用 hidden 通道。`,
        style: "bodySmall",
        color: "onSurfaceVariant",
      }),
    ];

  return ctx.UI.LazyColumn(
    {
      onLoad: async () => {
        if (!initState.value) {
          initState.set(true);
          await checkStatus();
        }
      },
      fillMaxSize: true,
      padding: 16,
      spacing: 12,
    },
    rootChildren.filter((n): n is ComposeNode => !!n),
  );
}