# 写入飞书文档

先确认 lark-cli 可用：`lark-cli auth status --json --verify`。命令细节以 `--help` 实时输出为准，不凭记忆猜参数。

## 流程

1. 定位父节点：`lark-cli wiki +node-get --node-token <URL> --as user`，拿到 space_id、node_token
2. 新建子文档：`lark-cli wiki +node-create --space-id <id> --parent-node-token <token> --title "<报告名>" --obj-type docx --as user`，拿到 obj_token
3. 分批写入：每节写一个 md 文件，`lark-cli docs +update --doc <obj_token> --as user --command append --doc-format markdown --content @file.md`（一次 append 一节，避免超长失败）
4. 回读核验：`lark-cli docs +fetch --doc <obj_token> --doc-format markdown` 检查格式，错位内容用 `--command block_replace --block-id <id>` 整块替换修复

## 实测过的 markdown 限制（重要）

- **一行只能有一组 `**加粗**`**：多组加粗用顿号连接会被错误配对成跨词的粗体（如 `**A**（x）、**B**（y）` 会渲染成一大段连体加粗）。多个强调词要么拆成列表项（每项一组加粗，安全），要么用 → 分隔（安全），要么放弃加粗用纯文本
- 表格、有序/无序列表、单组加粗、各级标题均安全
- `--content @file` 只接受当前工作目录的相对路径，传绝对路径会报 unsafe file path
- 修改他人或自己已编辑过的文档前，先 fetch 最新版拿块 ID（revision 变化后旧 ID 可能失效；block_replace 返回"no document changes"多半是块 ID 过期或目标已被删除）
- 用户中途手动编辑过文档时，尊重其改动，不要按自己的旧计划恢复内容
