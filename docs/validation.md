# 实现与验证记录

日期：2026-10-20 至 2026-10-21（Asia/Shanghai）。插件版本：0.1.0。下述结果属于本项目，不沿用参考插件的测试结论。

## 构建与自动测试

- `pnpm install --frozen-lockfile --offline --ignore-scripts`：锁文件与独立开发依赖一致。
- 删除 `lib` 和构建声明 inventory 后重新 `pnpm build` 成功，验证不依赖旧产物。
- `pnpm build`：Host、官方 Typert 严格协议、ESM worker、Client 工厂和内联资源构建成功。
- `pnpm typecheck`：Host / Client 分别以真实发布依赖进行严格类型检查。
- `pnpm test`：8 项内核与浏览状态回归测试。
- `pnpm test:integration`：10 项真实文件系统 / worker / Gateway 集成测试。
- `pnpm pack:plugin`、`pnpm test:packaging`：预编译 tgz、所有 exports、worker、factory 求值、SSR、离线路径与许可证检查。
- Desktop 0.2.1-rc.2 自带 Electron Node 24.21 执行同一批自动测试；另有下述真实 Desktop GUI 验收。
- 安装包检查覆盖有/无 Better Sidebar 服务时的注册、Session 地址准入、两种界面的 SSR，以及 effect 清理。文件路由的实际优先级由 Desktop 文件树打开验证。

测试覆盖物理行/CRLF/空文件/短读、UTF-8/BOM、大整数/重复 key/转义保真、流式严格校验、缓存恢复与损坏、超过 4 GiB 的实际稀疏文件读取和 uint64 offset、9 MiB 常规记录跨桥接块、并发切行取消、视图上限、共享会话、源文件变化及重建、过期 token、精确分隔符导出。

Gateway 用真实 Session store、lookup、registry、access service 和 Peer 调用生成接口，验证错误类型、额外字段、未知 Session、无权限 Peer、跨 Peer 复用 viewId 的拒绝；导出经过原生二进制 codec。没有调用模型或使用 API key。

## 实际安装与 Web 页面

通过本机 `dsh` CLI 将 tgz 安装到临时 `DSH_HOME` 的隔离 Web profile，实际启动 Harness 0.2.1-rc.2（源码 commit `687f282e`）。从原生文件面板打开 fixture，而不是另建 demo 网页。

已观察并验证：

- `.jsonl` 默认采用插件的 `renderer` 模式，保留“打开方式”选择器。
- 125 行 fixture 的正文、初始 100 行选择器、跳到 101 行、随机与历史后退/前进。
- Monaco 折叠、展开菜单、精确的大整数字面量、中文/emoji、约 20% 的结构栏和全屏布局。
- 32 MiB 单条使用流式结构；展开其数组节点并查看 `[1,2,3]` 的独立文本窗口。
- 追加 fixture 后旧正文停止显示；明确重建后索引从 126 行恢复为 127 行，继续浏览。
- 停止并重新启动临时 Host，页面自动重新建立视图并恢复第 101 行。
- 用 CLI 卸载插件、重启 profile 并刷新页面后，原生代码/文本预览恢复；本次不声称 CLI 外部卸载会在无重启时立即撤掉现有 Client 界面。

真实页面曾暴露 Client 工厂标识符冲突、JSX transform 设置、重建和自动暂停竞态，均已修复，并补入工厂求值/SSR 或状态回归测试。Electron 测试暴露的并发切行乱序也已按请求序号修复。

截图：[普通记录](preview.png)、[超长记录](large-record.png)。这些是功能验收，不是端到端 p95。

## 官方 Desktop 与 Better Sidebar

2026-10-21 在 `/Applications/DeepSeek Harness.app` 的真实窗口（`dsh-app://app/`）完成验收。应用版本 **0.2.1-rc.2**，build `332895e0`；已有 **Better Sidebar 0.28.0** 保持启用。本次向用户的 Desktop profile 安装了插件，并保留测试工作区及已启用插件；没有发送聊天消息或调用模型。

- 从应用的“插件 → 添加插件”安装本地 tgz，观察“已安装”，点击“立即启用”，详情显示“运行中”。通过相同界面卸载旧测试构建，再安装兼容修复包，验证完整替换流程。
- 初次验证发现 Better Sidebar 的通用文件路由会覆盖原生 document preview。修复使用宿主公开的 `sidebarRightTabs` / keyed slot，只有检测到 Better Sidebar 服务时注册更具体的 JSONL / NDJSON 文件类型；未导入其私有模块或禁用其他插件。
- 从 Better Sidebar 文件树打开 125 行 JSONL，进入本插件。Monaco、worker、CSS 正常加载，大整数 `9007199254740993` 和重复 key 保真；第 101 行跳转、随机到第 98 行、历史返回第 101 行以及全屏正常。
- 从同一文件树打开 **33,554,498 字节**的 NDJSON 单条记录，进入流式结构；展开三元素数组，显示独立原文字节窗口 `[1,2,3]`。
- 使用系统原生 Save 对话框导出第 101 行，文件与源记录及换行分隔符逐字节一致（136 字节）。这次实测覆盖常规记录的 File System Access 保存，不外推所有浏览器或超长记录保存。
- 追加第 126 行后显示“源文件已变化，重建索引后继续”，旧正文停止显示；明确重建后显示 126 条记录并恢复浏览。
- `.txt` 继续进入 Better Sidebar 的现有编辑器，文本可正常显示。

截图位于插件目录：[普通记录](../packages/plugins/large-jsonl-viewer/screenshots/desktop-preview.png)、[32 MiB 单条记录](../packages/plugins/large-jsonl-viewer/screenshots/desktop-large-record.png)。截图只包含生成的测试数据。

## 后端基准

环境：macOS arm64、Apple M5 Pro、64 GiB、Node 26.7、本地 `/Volumes/WD_BLACK`。OS cache 未驱逐，均按暖缓存/未受控缓存报告。纯读和索引均经过同一个 `ctx.fs` adapter。生成数据、工作目录和大 fixture 在运行后删除，只保留 JSON 报告。

| 样本 | 索引会话（含关闭） | 首条边界 | 前 100 行边界 | 随机读取/解析 p95 | Host+workers 峰值 RSS |
| --- | --- | --- | --- | --- | --- |
| 约 1 GiB，100 KiB/条 | 413 ms | 33 ms | 38 ms | 33.6 ms | 280.4 MiB |
| 约 10 GiB，100 KiB/条 | 3894 ms | 33 ms | 38 ms | 31.4 ms | 286.0 MiB |
| 单条 32 MiB | 177 ms | 42 ms | 不适用 | 129.0 ms（3 次） | 181.7 MiB |
| 单条 256 MiB | 128 ms | 115 ms | 不适用 | 743.5 ms（3 次） | 292.7 MiB |

1/10 GiB 索引吞吐相对后置纯读基准分别为 64.8% / 65.6%。单条样本与小文件包含固定启动成本，不能用其吞吐比推断大文件持续扫描效率。

随机读取含 Host/worker 启动、读取、校验、格式化或完整流式扫描；不含 RPC 到浏览器、Monaco 绘制。3 次大记录样本的 p95 实际为最大值，样本不足以代表稳定分布。峰值 RSS 为同一进程及 worker 的总量，包含运行环境和 GC，不是单个索引缓存大小。

另用 64 MiB fixture 连续切行 1000 次：p95 33.9 ms，峰值 198.8 MiB；每 100 次采样 RSS 在约 150–191 MiB 间，最终 150.2 MiB，未见随切行次数持续增长。该结果不包括浏览器模型内存。

原始数据在 [benchmarks](benchmarks/)；复现：

```sh
pnpm benchmark -- --sizeMiB 1024
pnpm benchmark -- --sizeMiB 10240
pnpm benchmark -- --longMiB 32 --switches 3
pnpm benchmark -- --longMiB 256 --switches 3
pnpm benchmark -- --sizeMiB 64 --switches 1000
```

最终采样于 2026-10-20 23:27–23:28（Asia/Shanghai）。每份原始 JSON 包含 Host 和两个 worker 的 SHA-256，与交付构建一致。`indexMs` 包含首个索引会话完成、关闭与检查点提交；前 100 行指标在进度事件到达时取样。10 GiB 本次总 RSS 为 286.0 MiB，未量化相对宿主基线的增量，不能据此声称完整单视图内存目标已达标。

## 尚未完成的验收

Windows/Linux、Node 最低版本、SSH、50/100 GB、受控冷缓存、浏览器完整 p95 / 长期内存、超长记录原生文件保存和真实磁盘满/断电故障注入，均未声称通过。完整新旧宿主兼容范围见 [compatibility.md](compatibility.md)。
