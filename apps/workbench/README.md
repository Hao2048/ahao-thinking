# 好浩的产品工作台

v1.1.1 新增「智谱 / GLM Coding Plan（中国）」预设。选择后只填写套餐 API Key，默认 `glm-5.3-flash`、OpenAI 兼容协议与 `https://open.bigmodel.cn/api/coding/paas/v4`。获取个人套餐 Key 的链接直达套餐概览；团队套餐请使用团队套餐 Key。模型可在高级设置调整，不会退回普通按量付费地址。智谱官方限制套餐使用工具名单，本工作台尚未列入，需向智谱确认适用范围；本次仅验证配置与接入链路，未验证真实套餐授权。

## macOS 桌面版 v1.4.7

可双击 `产品经理工作台/桌面安装包/好浩的产品工作台.app`，或打开同目录 DMG 拖入 Applications。支持 Apple Silicon、macOS 13 及以上；应用自带 Electron、Node 24 和 Harness，不需要启动终端或浏览器。

`⌘N` 新建项目，`⌘,` 模型设置，`⌘Q` 退出。关闭窗口后任务继续，点击 Dock 图标恢复窗口。设置内可添加多个公司内部或其他兼容服务的连接并选择模型，真实连接须填写有效地址、模型 ID 和凭据。

桌面数据保存在 `~/Library/Application Support/AIPM Workbench`；项目与模型配置的 state.json 经 macOS 钥匙串加密，Harness 会话日志仍是本机文件。首次启动自动导入当前网页版本数据，保留原数据。钥匙串加密数据不适合直接复制到另一台 Mac；换机前请先导出文档并重新配置连接。

这是本地开发签名的应用，未使用 Apple Developer ID 签名与公证，正式发布脚本已支持 Developer ID 签名、公证和按架构生成更新包；本机尚无分发证书和公证凭据。当前交付为 Apple Silicon 本地签名包，Intel 构建需在 Intel Mac 上执行并验收。

```sh
npm run desktop:prepare
npm run desktop:dev
npm run desktop:package
npm run test:desktop
```

全新克隆请先执行根目录的 `node scripts/setup-workbench.mjs`。打包依赖此仓库已构建的 Harness 与 Electron；最终 `.app` 自身运行不依赖仓库路径。下文是保留的浏览器开发运行方式。

基于 DeepSeek Harness 官方 SDK 的本地个人产品工作台。要求 Node 24+，相邻 `deepseek-harness` 已安装依赖及构建 SDK/模型适配器（当前目录已有构建产物）。不修改三个源 skill。

```sh
cd /Users/penghao/Documents/AIProduct/AIProductControl/apps/workbench
npm start
```

运行 `npm start` 后打开 http://127.0.0.1:4318 。桌面开发版使用 `npm run desktop:dev`。

1. 新建项目。
2. 模型设置选择 DeepSeek、OpenAI、Anthropic / Claude、阿里云百炼（北京）或 Kimi（中国），只填 API Key 后保存；自动提供模型与地址并设为当前使用连接。其他模型、地域或内部服务展开高级设置填写，环境变量同样保留。编辑时 Key 不回显，更换地址或协议必须重新提供对应 Key。
3. 保存后可直接运行；测试连接为可选的真实 API 请求。已有连接可以切换默认模型。
4. 任意阶段加入文本、TXT/MD/JSON/CSV/PDF/DOCX/XLSX/PNG/JPG 或与 AI 对话，确认后运行。
5. 查看结构化数据、文档与版本，选择产物交给任意下一模块。

漏斗 CSV 是已汇总人数，表头 `step,users`，例如：

```csv
step,users
访问产品,1200
创建宠物,840
首次喂养,660
首次发布,180
```

示例仅为测试数据。实际计算要求同一用户群、时间窗与顺序定义，由数据提供者确认。

v0.3 新增「联网取材」：可直接抓取公开网页，也可在设置中配置 Tavily、Brave 或 SearXNG。AI 先提出检索词，用户确认后执行；网页正文与搜索摘要分别标注，确认的来源随模块交接保留。公开网页证据不等同于市场接受度验证。Mac 桌面版可选动态正文读取，通过独立、无登录的沙箱窗口执行公开页面脚本；仅允许公开 HTTP/HTTPS GET/HEAD，禁止私有地址、写请求和下载。登录、验证码与付费墙不绕过。浏览器开发模式提供静态读取。

文件先解析预览，确认后才加入材料。支持 PDF、DOCX、XLSX、PNG 和 JPG，最大 20 MB；文字 PDF 最多 100 页，XLSX 可选择工作表。Mac 上 PNG/JPG 自动进行中英文 OCR；扫描或混合 PDF 需勾选 OCR，最多 30 页，识别最长 120 秒。OCR 使用本机 Apple Vision，原始文件经标准输入传给 helper，不上传 OCR 服务、不写临时文件。数字和复杂表格可能识别错误，需核对预览；确认入库不等于数据准确性已验证。OCR 来源随前序交接保留。旧 DOC/XLS 需先转换；Excel 公式使用已有缓存值，不执行公式。提取文本最多 512 KB，超限提示失败，不默默截断。

漏斗、留存、A/B 的 CSV 或 JSON 数据可以来自手工输入、对话确认、文件或前序交接。留存支持 user_id,date,event 原始事件，以及 cohort,cohort_users,day,retained_users 汇总表；事件模式需要观察截止日期，未成熟或缺失的数据不当作零。漏斗另支持 user_id,timestamp,event 原始事件，运行前定义顺序步骤、观察截止时间和转化窗口；去重用户，排除观察窗口未成熟的入口用户。A/B 支持 2–6 组：variant,users,conversions 二元转化；variant,users,mean,stddev 连续指标汇总（样本标准差）；variant,user_id,value 连续指标原始数据。连续指标使用 Welch t 检验，多组与同一对照比较使用 Holm 校正；置信区间为各比较单独的 95% 区间。小样本二元比例不输出显著性结论，零方差连续比较不推断显著性。需随机分组和预先固定样本，尚不支持序贯检验。模型负责解释，统计数值由代码计算。

浏览器开发模式的数据在 `apps/workbench/data`，密钥保存在 0600 权限的本地 JSON，界面不回显；桌面版使用前述系统钥匙串加密。仅供本机个人使用，尚未接入团队认证。`AIPM_PORT` 改端口，`AIPM_DATA_DIR` 改存储目录，`AIPM_SKILL_ROOT` 改 skill 根目录。关闭服务后可备份整个数据目录；其中包含私密资料、密钥与 Harness 会话。

```sh
npm test
npm run test:harness
npm run test:enhanced
npm run test:ocr-browser
npm run test:workflow
```

真实 Harness 集成测试用本地模拟供应商，不调用商业 API。不等同于真实供应商连接验证。

## OCR 构建

打包使用 `xcrun swiftc` 将 `native/ocr.swift` 编译为内置 `runtime/ocr-helper`，运行时无需 Swift 编译器。默认使用开发工具目录的稳定 MacOSX.sdk；可用 `AIPM_MACOS_SDK` 指定与编译器兼容的 SDK。`desktop:prepare` 同时构建 helper。

没有 helper 或非 Mac 环境会禁用 OCR 选项，文字 PDF / Word / Excel 解析保持可用。原始文件不持久化；材料预览和用户确认的文字进入项目存储。六阶段 14 模块回归通过真实 SDK 调用本地模拟供应商，仅验证路由、技能映射、交接、统计注入与恢复，不代表真实模型质量验收。

## 桌面更新与正式发布

模型设置页包含更新服务。正式签名版本可配置 HTTPS JSON feed、每六小时检查；下载完成后由用户点击安装。运行中的模块会阻止立即安装。本地开发签名版本只保存配置并显示限制，不下载或安装更新。已下载的更新可能由 macOS 更新器在下次启动应用时应用。

正式发布需要 `AIPM_SIGN_IDENTITY`（Developer ID Application 证书）、`AIPM_NOTARY_PROFILE`（notarytool 钥匙串配置）和 `AIPM_RELEASE_BASE_URL`（HTTPS 发布目录），执行 `npm run desktop:release`。产物包含已公证并装订的 APP/DMG、ZIP 和 `latest-arm64.json` 或 `latest-x64.json`；上传发布目录由发布者完成。无凭据时构建前即停止。自动更新下载与替换、Apple 正式公证和 Intel 真机仍需相应环境验收。

本版本按本机个人工作台交付，包含六阶段十四模块及项目、来源、文档版本、交接、导出、统计和恢复；团队权限、云端协作不在本版范围。真实模型回答质量与市场判断需使用实际服务和实际材料验收。

## v1.1 接入简化

普通接入仅厂商与 Key 两项，默认地址与模型来自官方文档（2026-10-09 核对）。高级字段保留，旧内部连接按自定义方式编辑。不进行自动扣费的连接测试，也不会自动填入真实 Key。切换厂商清空输入中的 Key；服务器禁止把保存的 Key 静默转移到其他地址或协议。

### v1.2.0 工作助手

消息即时显示、实际模型增量实时更新。Enter 发送、Shift + Enter 换行，支持中文输入法。生成时跟随底部，主动上翻查看历史后暂停跟随，点击“回到最新”恢复。支持停止与失败重试；AI 澄清问题支持选项、自由文本、稍后回答和跳过。刷新可重新接收后台回复，服务重启保留已生成内容并提示重试。

验证实时交互：`npm run test:chat`；验证实际 Harness 逐段转发：`npm run test:harness`。

### v1.3 工作区隔离与入口

研究工作区统一提供产品想法／指定产品／用户需求入口，计划确认后连续完成市场、用户与机会研究。研究区取消前序继承；后续工作区支持上传材料及继承前一步产物。立项先盘点材料和产品阶段。每次生成与聊天仅使用当前所属 skill，参考文件按任务加载，Harness 使用独立目录与 home。六阶段现为 12 个独立运行模块；旧研究记录保留并合并展示。

研究未联网时需明确选择受限分析，修改材料后需重新确认计划。界面验证：`npm run test:workflow-ui`。
