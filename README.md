# 好浩的产品工作台

个人 macOS 产品工作台，基于 DeepSeek Harness SDK。版本 **1.4.7**。

提供市场／用户／机会研究、立项报告、MVP／PRD／原型／流程、埋点与验收、漏斗及其他数据分析、迭代复盘。中间面板采集材料与展示文档，右侧 AI 助手执行当前模块；三种技能隔离使用。支持模型厂商＋Key 接入、流式回复、联网取材、文档导入、离线 SVG 图表和按文档总结。

## 安装

从本仓库的私有 [Releases](https://github.com/peng411528/haohao-product-workbench/releases) 下载 DMG，打开后将“好浩的产品工作台”拖入 Applications。当前提供 Apple Silicon 版本，要求 macOS 13+，内置 Node、Electron 和 Harness，无需启动浏览器。当前使用本地开发签名，尚未进行 Apple Developer ID 公证。

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

`skills/` 保存软件使用的三个技能快照，确保其他电脑可构建。技能根目录依次使用 `AIPM_SKILL_ROOT`、本机 `~/Documents/Skills`、桌面内置技能／仓库快照；本机技能不存在时仍可运行。技能更新后需要重新打包。

## 项目结构

| 路径 | 用途 |
| --- | --- |
| `apps/workbench/src` | 本地服务、Harness 路由、输入解析与统计 |
| `apps/workbench/public` | 工作区界面、文档及图表渲染、品牌 SVG |
| `apps/workbench/desktop` | Electron、钥匙串存储、联网动态读取、更新 |
| `apps/workbench/native` | Apple Vision / PDFKit OCR |
| `apps/workbench/tests` | 单元、模拟模型集成与界面回归 |
| `skills` | 市场研究、立项、产品经理工作流快照 |
| `deepseek-harness` | 官方上游子模块，保留其许可证 |
| `产品经理工作台` | 需求、开发、原型和品牌资料 |
| `scripts` / `.agents` | 原型导出、PRD 校验与共享工作流资源 |

项目根目录的旧双击启动入口和 `关键点.md` 已清理。日常使用直接打开 Mac 应用；开发使用上述 npm 命令。若要维护早期独立 HTML 原型，其导出服务可在项目根目录用 `python3 scripts/start_service.py --serve` 启动（Windows 使用 `py -3`）。`skills/` 和 `.agents/` 中的安装模板描述适用于其他独立技能项目，不表示本桌面项目仍保留这些根目录入口。

图表依赖在构建时生成到 `public/vendor`，每次清理旧哈希文件，产物保持离线可用。安装包通过 Releases 分发，不进入 Git 历史。模型密钥、用户材料、会话、缓存、安装包、个人宠物项目及截图均排除上传。

Harness 遵循其 MIT 许可证；图表等第三方依赖的许可证随安装包保留。工作台源码和技能快照作为个人私有项目保存。
