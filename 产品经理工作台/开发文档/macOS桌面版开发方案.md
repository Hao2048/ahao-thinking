# macOS 桌面版开发方案 · v0.2.0

## 架构

Electron 主进程负责原生窗口、菜单、生命周期及 safeStorage 加解密。预加载只向界面暴露限定的菜单动作；渲染器继续承载现有工作台。独立的内置 Node 24 子进程启动本地 HTTP 服务，再由官方 Harness SDK 启动 sdk-minimal 执行三个 skill。无须修改 Harness 核心。

服务只监听 127.0.0.1，采用系统分配端口。窗口关闭不关服务；退出时先请求优雅关闭，再按超时终止独立进程组。所有运行均使用应用自己的数据目录与生成 profile，不复制旧 profile 中的仓库路径。

## 核心文件

| 文件 | 职责 |
|---|---|
| apps/workbench/desktop/main.mjs | 原生窗口、单实例、菜单、启动/退出、下载、IPC 存储代理 |
| apps/workbench/desktop/preload.cjs | 隔离界面的限定动作桥接与标题栏 |
| apps/workbench/desktop/host.mjs | 内置 Node 服务入口和关停 |
| apps/workbench/desktop/storage.mjs | 一次性迁移与加密数据编解码 |
| apps/workbench/scripts/package-mac.mjs | 收集生产依赖、复制 Node/skill、图标、签名、DMG 和安装 |
| apps/workbench/tests/desktop-smoke.mjs | 启动真实打包应用、模拟模型生成及恢复测试 |

## 依赖与可移植性

打包从已安装并构建的 deepseek-harness 获取 SDK、pi-ai 适配器及 sdk-minimal，递归收集生产、peer 及已安装可选依赖，保留每个包精确依赖边及根级回退链接。原生加载器动态解析平台包，需要根级链接。所有运行时链接采用相对路径，拷贝时保留原始链接，避免 Node fs.cp 将链接转换为源构建目录的绝对路径。共收集 608 个包，自带 Node 24.21.0；未作激进裁剪，包体积较大。

skill 首选用户 Documents/Skills 下的三个现有目录，缺失时回退到应用内置副本。本次没有修改源 skill。

## 数据及进程边界

桌面数据在 ~/Library/Application Support/AIPM Workbench。state.json 包含项目、产物及模型配置，Electron safeStorage 用登录钥匙串保护；业务服务通过父子进程 IPC 请求加解密。渲染器没有 Node、文件系统或存储密钥接口。会话 JSONL 与日志仍为本地文件，目录限本机用户；不宣称整个数据目录加密。

渲染器开启 contextIsolation、sandbox 和 webSecurity，拒绝远程导航、新窗口、webview、未授权权限；原型继续使用隔离预览。实现依据：[Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security/)、[沙箱说明](https://www.electronjs.org/docs/latest/tutorial/sandbox)。

## 构建与安装

在 apps/workbench 执行 npm run desktop:package 生成 app 与 DMG；npm run desktop:install 同时安装到 ~/Applications。开发时先 desktop:prepare，再 desktop:dev。已收集运行时后可用 node scripts/package-mac.mjs --reuse-runtime 加速代码迭代。

当前只交付 arm64/macOS 13+，采用 ad-hoc 本地签名并验证完整性。公开发布还需 Developer ID 签名、公证、更新机制和 Intel 构建。保存的数据与会话独立于 app，升级应用不覆盖它们。
