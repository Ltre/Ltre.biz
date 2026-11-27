
问：


	你整理出上面关于codex重连相关的有用的脚本，一一列出来


答：





# 处理Codex重连问题的参考脚本.md


下面整理的是这次排查 Codex“正在重新连接 5/5”时用到的脚本。除第 6 项修改配置外，其余均用于查找或检查。

以下假设你使用 **Windows PowerShell**，并且 Trojan-Qt5 端口仍为：

```text
HTTP 代理：   127.0.0.1:58591
SOCKS5 代理：127.0.0.1:51837
```

## 1. 查找桌面端附带的 Codex 程序

```powershell
$exe = Get-ChildItem "$env:LOCALAPPDATA\OpenAI\Codex\bin" -Filter codex.exe -File -Recurse -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 -ExpandProperty FullName

if ($exe) {
  Write-Host "找到 Codex：$exe"
} else {
  Write-Host "没有在桌面端目录中找到 codex.exe"
}
```

这会按文件修改时间选取一个程序。**如果存在多个版本，它不一定就是当前桌面端正在使用的版本。**可以先列出所有候选：

```powershell
Get-ChildItem "$env:LOCALAPPDATA\OpenAI\Codex\bin" -Filter codex.exe -File -Recurse -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object FullName, LastWriteTime
```

后面的 `& $exe ...` 命令需要在执行过第一个脚本的同一个 PowerShell 窗口运行。关闭窗口后，变量会消失。

## 2. 执行完整诊断

```powershell
& $exe doctor
```

用于检查网络、WebSocket、配置、认证、MCP、沙盒、会话索引等。

如果想展开被截断的列表：

```powershell
& $exe doctor --all
```

如果需要机器可读的脱敏 JSON 报告：

```powershell
& $exe doctor --json
```

报告仍可能包含本机路径等信息，对外分享前应检查。

## 3. 只检查网络

```powershell
& $exe doctor --network-only
```

重点看：

```text
respect system proxy     enabled
websocket                connected (HTTP 101 Switching Protocols)
```

`HTTP 101` 表示**当次 WebSocket 握手成功**，不保证长时间连接不会断开。

## 4. 临时启用系统代理进行对照检查

```powershell
& $exe doctor --network-only -c 'features.respect_system_proxy=true'
```

这条命令只为**本次诊断进程**临时启用该设置，不会修改 `config.toml`。适合在正式修改配置前，比较启用系统代理后 WebSocket 是否能够握手。

如果普通 HTTPS 可访问，但这条命令仍显示 WebSocket 超时，就需要继续检查系统代理指向、代理节点或 WebSocket 路由。

## 5. 分别检查 HTTP 和 SOCKS5 代理

检查 HTTP 代理：

```powershell
curl.exe -I --proxy http://127.0.0.1:58591 https://chatgpt.com/
```

检查 SOCKS5 代理：

```powershell
curl.exe -I --proxy socks5h://127.0.0.1:51837 https://chatgpt.com/
```

`SOCKS5h` 表示由代理侧解析目标域名。端口发生变化时，替换为 Trojan-Qt5 当前显示的端口。

如果只想看 HTTP 代理状态码和耗时：

```powershell
curl.exe -sS -o NUL --max-time 20 `
  --proxy http://127.0.0.1:58591 `
  -w "HTTP status=%{http_code} total=%{time_total}s`n" `
  https://chatgpt.com/
```

PowerShell 中反引号 `` ` `` 用于续行；复制时每行末尾不要在反引号后添加空格。

返回 `200` 表示那次普通 HTTPS 请求成功；它**不能代替第 3、4 项的 WebSocket 检查**。

## 6. 查看 Windows 系统代理设置

```powershell
Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' |
  Select-Object ProxyEnable, ProxyServer, AutoConfigURL
```

本次排查时看到：

```text
ProxyEnable  1
ProxyServer  127.0.0.1:58591
```

- `ProxyEnable` 为 `1`：手动系统代理已启用。
- `ProxyServer`：手动系统代理地址。
- `AutoConfigURL`：如果有值，可能使用 PAC 自动代理，需要结合 PAC 规则判断实际路由。

## 7. 正式启用 Codex 系统代理

先打开配置文件：

```powershell
notepad "$env:USERPROFILE\.codex\config.toml"
```

在已有的 `[features]` 段中添加或调整为：

```toml
respect_system_proxy = true
```

如果已有该项，直接把值改为 `true`，不要重复添加。若 `[features]` 已存在，也不要再创建第二个同名段。

这次你已自行添加该设置。修改后需要**完全退出桌面端并重新打开**，再用第 3 项检查。该设置适用于 Codex 原生运行程序的相关网络请求，不保证所有浏览器、插件和 shell 命令都使用相同代理。

## 8. 备份配置文件

正式修改前，可以执行：

```powershell
$config = Join-Path $env:USERPROFILE '.codex\config.toml'
$backup = "$config.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"

if (Test-Path -LiteralPath $config) {
  Copy-Item -LiteralPath $config -Destination $backup
  Write-Host "备份完成：$backup"
} else {
  Write-Host "配置文件不存在，没有创建备份。"
}
```

这里使用到秒的文件名，降低备份重名的可能。若设置了自定义 `CODEX_HOME`，应备份该目录中的 `config.toml`，而不是默认的用户目录文件。