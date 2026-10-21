# DeepSeek Harness Large JSONL Viewer

用于 DeepSeek Harness 的只读 JSONL / NDJSON 预览插件。Host 经 `ctx.fs` 建立物理行字节索引，浏览器每次读取一条记录。插件不调用模型，也不把文件内容写入聊天上下文。

开发目标版本为 **Harness 0.2.1-rc.2**；其他版本暂未验证。已在 macOS arm64 的 Web、官方 Desktop 和 Better Sidebar 0.28.0 中验证。运行时支持 Node ^22.19 或 >=24，已测试 Node 26.7 和 Desktop 自带的 Electron Node 24.21。

## 安装

从 [v0.1.0 Release](https://github.com/liaojianjin/dsh-large-jsonl-viewer/releases/tag/v0.1.0) 下载预编译包，或直接使用安装地址：

```text
https://github.com/liaojianjin/dsh-large-jsonl-viewer/releases/download/v0.1.0/dsh-large-jsonl-viewer-0.1.0.tgz
```

Desktop：打开 **插件 → 添加插件**，粘贴地址或下载后的 tgz 路径，安装后点击 **立即启用**。随后从文件面板打开 `.jsonl` / `.ndjson`。替换已安装的测试版本时，先在该插件详情中卸载，再安装新版。

Web CLI：

```sh
dsh plugin --profile web add https://github.com/liaojianjin/dsh-large-jsonl-viewer/releases/download/v0.1.0/dsh-large-jsonl-viewer-0.1.0.tgz
dsh web
```

本仓库根目录是开发工作区，不能直接作为 `dsh plugin add` 的源码包。需要自行构建时：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm pack:plugin
```

向已经存在的 Web profile 安装：

```sh
dsh plugin --profile web add /absolute/path/artifacts/dsh-large-jsonl-viewer-0.1.0.tgz
dsh web
```

Desktop 使用桌面应用自身的插件安装能力；不能假定系统 CLI 的 web profile 与 Desktop 的安装树相同。安装、界面与原生保存的实际结果见 [验证报告](docs/validation.md)。

CLI 安装或卸载后重启对应 Harness profile。在文件面板打开 `.jsonl` 或 `.ndjson`。查看器保留内置文本预览选项，支持前 100 行渐进选择、任意物理行跳转、随机、历史、保真格式化、折叠、key 导航、换行、专注和当前记录查找。`Alt+↑/↓` 切行，`Alt+←/→` 浏览历史，只在查看器聚焦时响应。

单条超过普通预算时使用分页结构和 64 KiB 原文窗口。暂停/取消索引会影响同一 Session 里该文件的所有视图；取消跳转只影响当前视图。文件变化后需明确重建索引。

启用 Better Sidebar 时，本插件通过原生文件类型路由接管 JSONL / NDJSON，其他文件仍进入现有编辑器。不需要关闭 Better Sidebar。安装前已打开的 JSONL 标签仍保留原来的查看器，重新从文件树打开即可进入本插件。

## 数据、缓存与限制

支持稳定、未压缩 UTF-8 普通文件，根可以是对象、数组或标量。空白行占物理行号。最终路径 symlink、目录、设备及未知大小被拒绝。浏览器连接远端 Host 时读取的是该 Host 文件系统。SSH 等文件系统尚未完成性能验收。

缓存默认位于 Host 的 `~/.cache/dsh-large-jsonl-viewer`，仅包含字节索引、版本和指纹，不包含正文。不可写或 writer 锁冲突时回退到临时目录；临时索引关闭后删除。异常崩溃留下的锁不会被擅自抢占，会触发临时缓存。可在关闭相关 Host 后清理其缓存。版本检查不是跨读取事务；源文件稳定是正常使用前提。

常规原文默认 8 MiB，格式化文本 16 MiB、100,000 节点、128 层及约 2 秒预算，超限改用流式模式。流式栈最多 2048 层，节点元数据至多 2000 项。默认最多 1000 万行、2 个活动文件索引、32 个视图、2 个记录 worker；超出限额显示错误。页目录有界，不能据此承诺任意高密度短行的 100 GB 文件。后部超长容器分页需要重新扫描。

导出保留原始字节及行分隔符。支持 File System Access API 的浏览器逐块写入；其他环境使用最多 **16 MiB** 的 Blob 下载，超出时明确提示。不能将半条导出报告为成功。剪贴板只支持常规有效 UTF-8 原文。

不支持编辑、自动追尾、压缩文件、全文件搜索、跨记录 JSONPath。未实测的性能与平台见验证报告。

## Host 配置

在 profile 的 `cordis.patch.yml` 中覆盖插件行，配置为完整对象：

```yaml
- id: large-jsonl-viewer
  config:
    cacheDirectory: /absolute/path/to/jsonl-cache
    scanChunkMiB: 4
    recordLimitMiB: 8
    cacheLimitMiB: 512
    maxLines: 10000000
    maxFiles: 2
    maxViews: 32
    maxRecordTasks: 2
    pollMs: 2000
```

扫描块允许 1/4/8 MiB；常规预算允许 1–16 MiB。其他参数由插件启动时校验。非活动缓存采用 LRU 清理，活动文件受 `maxLines` 和并发限额约束。查看器偏好与浏览历史保留到 tab 关闭，正文不进入持久布局。

## 开发验证

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm test:integration
pnpm pack:plugin
pnpm test:packaging
pnpm benchmark -- --sizeMiB 1024
```

构建顺序：独立 Host 编译 → 严格 Typert 协议生成 → ESM workers → Client 编译与 Harness factory。Monaco、worker、字体和 CSS 随包，无 CDN。当前版本 Typert 对树外包的限制通过仅用于构建的已发布声明适配解决，详见 `docs/compatibility.md`；运行时使用宿主共享包，不依赖旁边的源码 checkout。

![真实 Harness 预览](docs/preview.png)

Desktop 实测截图：[普通记录](packages/plugins/large-jsonl-viewer/screenshots/desktop-preview.png)、[32 MiB 单条记录](packages/plugins/large-jsonl-viewer/screenshots/desktop-large-record.png)。[收录条目与提交条件](docs/distribution.md)已准备，尚未向目录提交。

迁移代码参考 VS Code 插件 commit `9c90a87433b82ab615094a39d0ef1c17dadbc5b7`（MIT），Harness 接口参考 commit `687f282e8625c6b8d11ff58211a90524be2e4317`。许可证见发布包。
