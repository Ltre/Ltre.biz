# Codex 维护工具

Windows 桌面工具，使用 Go 与 Unison 展示 Codex Doctor 的诊断信息，并提供有前置网络检查和配置备份的 WebSocket 修复流程。

## 目录

- `cmd/codex-maintain/`：图形程序入口与界面。
- `internal/doctor/`：桌面端程序发现、Doctor 执行和 JSON 报告解析。
- `internal/proxy/`：Windows 系统代理和本地监听端口检查。
- `internal/config/`：TOML 校验、备份与配置修改。
- `internal/desktop/`：Windows 桌面端进程观察与启动。
- `assets/`：静态界面资源。
- `tests/`：隔离测试，使用模拟诊断报告和临时配置文件。
- `build/`：本机构建产物和缓存，不纳入 Git。

## 构建

需要 Windows 10 或更新版本以及 Go 1.27.3 或更新版本。模块使用 Unison v0.125.0；新环境首次构建需要下载 Go 模块。

```powershell
go test ./...
go build -ldflags='-H=windowsgui' -o build/codex-maintain.exe ./cmd/codex-maintain
```

## 使用和限制

1. 检查显示的桌面端 `codex.exe` 路径，点击“执行 Codex 诊断”；发现多个版本且无法唯一识别时需选择当前版本。
2. 诊断结果左侧逐项显示问题卡片，每张卡片可查看完整详情。右侧提供完整诊断日志和操作记录入口；两者在应用窗口内全屏查看，可滚动、复制并返回诊断结果。
3. 仅 WebSocket 问题的卡片右侧会显示修复按钮。工具检查系统代理，并以临时配置复测 WebSocket，成功后才创建备份并修改配置。
4. 如果选择立即重启，需要通过托盘菜单正常退出 ChatGPT。工具会等待已识别的桌面实例退出，再尝试启动并进行网络复查；不会强制结束进程。
5. PAC 自动配置、系统代理无法确认或临时 WebSocket 检测失败时会停止自动修改。

本工具的网络诊断是当次握手结果，不保证长时间连接不会中断。Doctor 检查结果不能替代每个插件、技能或沙盒功能的实际测试。请勿将含本机信息的报告直接公开。
