import toolboxUI from "./ui/settings/index.ui.js";

/**
 * ToolPkg 主入口：注册工具箱 UI 模块（配置 + 控制界面）。
 * 核心进程控制逻辑在子包 packages/proxy_control.js 中，
 * 全部通过 Operit 持久终端会话（visible）完成，不使用 hiddenExec。
 */
export function registerToolPkg() {
  ToolPkg.registerToolboxUiModule({
    id: "workbuddy_proxy_settings",
    runtime: "compose_dsl",
    screen: toolboxUI,
    params: {},
    title: {
      zh: "WorkBuddy 反代控制",
      en: "WorkBuddy Proxy Control",
    },
  });
  return true;
}