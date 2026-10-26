# 阿浩Thinking

个人 macOS 产品工作台，基于 DeepSeek Harness SDK。版本 **2.5.0**。

将文字、文档、联网搜索、市场／用户分析、统计分析和报告产出封装为独立节点，通过连接节点构建工作流。支持 C 深色／银白主题、节点独立配置与对话、可编辑文档大纲、流式回复、SVG 图表和按文档总结。

## 安装

从本仓库的私有 [Releases](https://github.com/peng411528/haohao-product-workbench/releases) 下载 DMG，打开后将“阿浩Thinking”拖入 Applications。当前提供 Apple Silicon 版本，要求 macOS 13+，内置 Node、Electron 和 Harness，无需启动浏览器。当前使用本地开发签名，尚未进行 Apple Developer ID 公证。

数据位于 `~/Library/Application Support/AIPM Workbench`，项目与模型配置由 macOS 钥匙串加密。首次启动或开发签名更新可能需要本人完成钥匙串授权。不要提交该目录或开发模式的 `apps/workbench/data`。

## 从源码构建

需要 Node.js 24+、Git、npm；Mac 打包还需要 Xcode Command Line Tools（含 Swift / macOS SDK）。Harness 固定为子模块提交 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`，依赖与构建产物不提交。

```sh
git clone --recurse-submodules https://github.com/peng411528/haohao-product-workbench.git
cd haohao-product-workbench
node scripts/setup-workbench.mjs
cd apps/workbench
npm test
npm run desktop:package
```

输出位于 `产品经理工作台/桌面安装包/`。`npm run desktop:dev` 启动开发版，`npm start` 提供本地浏览器开发入口。首次浏览器测试需安装 Chromium：在 `deepseek-harness/apps/web` 执行 `pnpm exec playwright install chromium`。

`apps/workbench/nodes/` 维护30个独立节点与启动模板，安装版在用户数据目录 `nodes` 中自动发现，详见该目录README。新节点不通过旧模块catalog注册。

旧六阶段界面和模块接口已移除。节点能力与指令统一维护在 `apps/workbench/nodes/`，不再加载或打包独立的旧 Skill 快照。升级时自动移除项目中的旧模块字段，保留项目、节点工作流、模型与设置；迁移前的原始加密文件存放于数据目录 `retired-module-backups/`，仅供恢复，不参与运行。

## 项目结构

| 路径 | 用途 |
| --- | --- |
| `apps/workbench/src` | 本地服务、Harness 路由、输入解析与统计 |
| `apps/workbench/public` | 工作区界面、文档及图表渲染、品牌 SVG |
| `apps/workbench/desktop` | Electron、钥匙串存储、联网动态读取、更新 |
| `apps/workbench/native` | Apple Vision / PDFKit OCR |
| `apps/workbench/tests` | 单元、模拟模型集成与界面回归 |
| `deepseek-harness` | 官方上游子模块，保留其许可证 |
| `产品经理工作台` | 需求、开发、原型和品牌资料 |
| `scripts` / `.agents` | 原型导出、PRD 校验与共享工作流资源 |

项目根目录的旧双击启动入口和 `关键点.md` 已清理。日常使用直接打开 Mac 应用；开发使用上述 npm 命令。若要维护早期独立 HTML 原型，其导出服务可在项目根目录用 `python3 scripts/start_service.py --serve` 启动（Windows 使用 `py -3`）。`skills/` 和 `.agents/` 中的安装模板描述适用于其他独立技能项目，不表示本桌面项目仍保留这些根目录入口。

图表依赖在构建时生成到 `public/vendor`，每次清理旧哈希文件，产物保持离线可用。安装包通过 Releases 分发，不进入 Git 历史。模型密钥、用户材料、会话、缓存、安装包、个人宠物项目及截图均排除上传。

Harness 遵循其 MIT 许可证；图表等第三方依赖的许可证随安装包保留。工作台源码和技能快照作为个人私有项目保存。

新版节点职责与内部规则、文档打开和图表数据修订见 `产品经理工作台/开发文档/节点专业职责与管理-v2.4.0.md`。
