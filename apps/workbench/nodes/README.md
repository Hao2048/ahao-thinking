# 节点包维护

工作台扫描这个目录的一级子目录。每个功能独占一个文件夹；名称、配置表单、端口、规则和执行入口全部在这里维护。`_` 开头目录保留给模板/示例，不显示为节点。

开发运行扫描 `apps/workbench/nodes`。安装版首次启动将内置节点复制到 `~/Library/Application Support/AIPM Workbench/nodes`，以后扫描这个可编辑目录。节点库页面会显示实际路径，每5秒检查更新，也可立即刷新。修改源码目录后要重新打包才影响安装包；修改安装版节点目录直接生效。规则更新后请停止旧任务再重跑，新运行会记录新版本和哈希。

## 增加一个节点

1. 复制一个同类节点目录，修改 `node.json` 的唯一 `id`、`name`、`version`、`description`、`fields` 和端口。
2. AI节点在 `instructions.md` 中维护自己的SOP、最低材料要求、输出模板。只放本节点职责，不把其他阶段Skill一并加载。
3. 自定义代码节点使用 `executor: "plugin"`、`entry: "execute.mjs"`，导出 `execute(context)`。参见 `_examples/local-extract`，复制到本目录一级后即可使用。
4. 回到节点库，新节点自动出现；字段自动生成右侧配置面板，不需要修改注册表、HTML、调度器或主项目代码。

代码插件会以本机进程权限执行，是**可信本地代码**，不是安全沙箱。只安装自行编写或已经审查的包。主程序不自动下载第三方代码，也不把模型密钥直接提供给插件。

## node.json

```json
{
  "schemaVersion": 1,
  "id": "local.extract",
  "name": "材料摘要",
  "version": "1.0.0",
  "enabled": true,
  "category": "analysis",
  "description": "按固定规则提取材料首行",
  "executor": "plugin",
  "entry": "execute.mjs",
  "inputs": [{"id":"materials","name":"材料","types":["materials","documents"],"multiple":true}],
  "outputs": [{"id":"data","name":"结果","types":["analysis"]}],
  "fields": [{"key":"title","label":"报告标题","type":"text","default":"材料摘要"}]
}
```

分类是 `input`、`analysis`、`report`。端口类型用 `materials`、`sources`、`dataset`、`analysis`、`documents` 表达数据包内容；连线要求至少一个类型相交，不能循环或重复。内置节点统一输出一个数据包；多输出插件通过 `ports: {端口ID: 数据包}` 分别交接，执行器按连线选择输出并记录目标 `inputPort`，不会把所有端口混在一起。端口类型可兼容不意味着语义充分，AI节点还会检查材料与任务是否匹配。

字段支持 `text`、`textarea`、`number`、`boolean`、`select`、`json`、`model`、`file`、`artifact`。`select.options` 可为字符串数组或 `{value,label}` 数组。默认值写在 `default`。配置保存在节点实例中，模型字段只存模型ID，密钥继续保存在现有连接设置。

执行器 `text/file/web/artifact` 使用现有采集工具；`ai` 使用独立指令和输出大纲；`statistics` 先代码计算再AI解读；`plugin` 执行本地入口。新增通常能力复用AI或插件即可；引入新的系统级权限或运行时仍需扩展主程序。

## 插件接口

```js
export async function execute({config, inputs, upstream, signal, emitProgress}) {
  if (signal.aborted) throw new Error('已停止');
  await emitProgress({label: '正在整理材料'});
  return {
    kind: 'analysis',
    summary: '## 核心结论\n- 已按规则处理材料。',
    materials: [],
    documents: [{title: config.title, format: 'markdown', content: '# 材料摘要\n...'}],
    analysis: {count: inputs.length},
    sources: [], assumptions: [], warnings: []
  };
}
```

`inputs` 是上游材料与文档展开后的数组，含 `title/content/evidence` 以及来源；`upstream` 是完整数据包数组。输出 `kind` 必须匹配输出端口；文档需要 `title/format/content`，材料需要 `title/content`。继承的来源、假设不会被插件主动清空。插件有异步操作时应处理 `signal`，避免停止后仍继续工作。

## 状态与维护规则

- 有效定义自动加载；损坏定义、重复ID、越界资源单独报错，不影响其余节点。
- 不在启动/目录扫描时导入插件代码，只在用户运行该节点时导入。
- 结构、配置、节点规则哈希、上游结果、模型及清空上下文标记决定缓存。联网和历史引用每次重新读取，避免永久使用过时资料。
- 缺少材料时暂停；定性AI节点允许用户明确选择带假设草稿。统计格式错误不能通过草稿跳过。
- `instructions.md` 已从原有Skill中按职责拆分；节点实际执行不读取旧模块完整Skill。旧模块兼容入口已移除。
- `_templates/*.json` 是目录驱动的启动模板，可直接维护；结构为 `{id,name,graph:{nodes,edges,groups}}`，使用与普通工作流相同校验。
- 编辑内置节点后主动提高版本。安装版节点为用户持有的副本；存在本地修改时保留整个节点包并在节点库展示冲突，避免旧定义与新提示词混合。可比较新包后自行合并。

验证：在仓库根运行 `node --test apps/workbench/tests/nodes.test.mjs`，或在工作台目录运行 `npm test`；UI运行 `node apps/workbench/tests/node-browser.mjs`。

## 报告节点大纲（2.0.1）

所有AI报告节点在配置和输出页都有独立「文档大纲」入口。默认结构来自本节点node.json的fields中key为outline的default；新增AI报告节点无需再实现专用面板。编辑器支持结构预览、恢复默认、导出大纲、保存和保存并生成。`#`是一份文档，`##`和`###`是章节与小节，可在章节下写填写要求。多个顶级标题会分别生成文档。

生成器按已保存大纲逐份填充；检查标题、层级、顺序、空章及多余同级章节，未通过时尝试一次补齐，仍失败则明确报错并保留已有结果。每份新文档包含自己的outline快照；阅读器的「文档大纲」展示该版本快照，文档导出使用实际填充后的正文。Skill提供写作方法和证据规则，用户保存的大纲决定输出结构。代码插件自行实现SOP，不强行修改其自定义输出格式。

## v2.4 专业职责

当前30个节点：4个输入、15个分析、11个报告。原先报告里的立项论证、MVP设计、PRD方案、原型方案、流程设计、埋点设计、验收设计移入分析节点；增加需求洞察分析。报告节点仅整理上游已有成果，不能搜索、计算或作新的产品取舍。

`workflow` 数组定义节点内部的步骤（id/title/prompt），随运行快照传给执行器；`capabilities` 描述职责权限。节点管理点击卡片可阅读步骤、完整SOP和运行提示词模板，再明确选择添加到工作流。AI节点步骤作为本节点的执行规则输入；输入检查、代码计算、生成及章节校验由共享执行器负责，并非所有步骤都对应一次单独模型调用。

报告运行前区分相关性与充分性：无关或无可用内容直接失败；相关但不足继续整理已有部分，缺失内容在节点、文档顶部和下游quality/warnings中标明。判定依赖模型，不能保证所有语义误判均被消除。缺少专业分析成果时应连接对应分析节点。

文档支持节点双击/配置页按钮打开；Markdown的chart围栏支持表格编辑、增删行、补来源/证据性质、完整JSON、SVG预览和另存修订。原稿及计算结果保留，正文不会因手工改图自动重算；新修订会提醒核对图文一致性。Mermaid源码及外部图片不属于数据表编辑器处理范围。

安装版升级只更新此前由内置包管理、内容未被用户修改的文件，并补充新节点；自定义文件保留。冲突记录在desktop.log，节点库仍显示实际用户目录，不覆盖用户定制。

## 四层验收（2026-10-24）

在项目根目录执行 `node apps/workbench/scripts/audit-node-capabilities.mjs`，或在工作台目录执行 `npm run audit:nodes`。脚本检查全部内置节点并运行隔离执行样例，输出到项目开发文档中的JSON记录。模型和检索为替身，不读取用户存储，不调用真实模型。基础样例通过不代表原Skill专业能力全部迁入；规则、工具、专项检查、真实任务质量必须分别验收。


## v2.5 可靠执行与数据约定

- `file` 字段使用自己的 key 保存，支持同节点多个文件字段；确认预览绑定具体字段。文件执行器合并所有文件字段；AI 和插件的 inputs 同样包含这些确认材料。
- 标准交接包括材料、文档、结构化分析、代码计算、质量与假设。结构化分析无需先包装为文档才能交给报告节点。
- 单输出保持旧格式。多输出只用于 plugin，返回 `ports` 映射；每个端口独立校验。`upstream` 的 `inputPort` 指明目标入口，`inputs` 是去重后的便捷材料视图。
- 助手仅引用与当前节点、上游配置、规则和清空标记匹配的成功结果。清空不删除历史文档；仍会使用用户明确连接的当前上游结果。
- 统计分析及引用其计算结果的报告使用 `{{fact:rows.1.users}}`、`{{fact:rows.1.cumulativeRate|percent}}` 等指标令牌。软件校验并填入代码值；模型不得直接填写数字。未绑定数值会阻止发布该解读，统计节点仍保留确定性的表格与图表。该校验不代表输入真实性或因果判断已获验证。
- 联网停止信号贯穿搜索、页面读取及桌面动态取材；HTML生成按文档去重、可停止，并参与退出清理。
- 存储 schemaVersion 2 将已完成运行存成独立加密记录，主索引保留引用。旧数据自动迁移并在 `storage-layout-backups` 保留原始加密索引。旧版应用会拒绝新存储格式；如需回退，应先恢复完整备份，而非让旧版直接读新索引。
