# DeepSeek Harness Large JSONL Viewer 实现计划

> 给接手实现的 AI：本项目是在独立仓库中开发可安装的 DeepSeek Harness 插件，将现有 VS Code Large JSONL Viewer 的能力迁移到 Harness Web / Desktop。本文最初制定交接计划；当前实现状态见文末第 11 节，实际验证以 `docs/validation.md` 为准。
>
> 调研日期：2026-10-20。所有“已确认”均指下述本地源码快照；性能数字是待验证目标。

## 1. 目标与依据

用户从 Harness 文件面板或文件链接打开 `.jsonl` / `.ndjson` 后，在现有右侧文档预览中使用大文件查看器。文件留在 Harness Host 所连接的文件系统中，后台建立物理行的字节索引，浏览器只取得当前记录及有界结构数据。浏览行为不调用模型、不消耗 token、不写入聊天上下文。

参考项目：

| 项目 | 调研位置 | 快照 |
| --- | --- | --- |
| VS Code 功能与读取内核 | `/Volumes/WD_BLACK/Repo/vscode-large-jsonl-viewer` | 包版本 `0.2.2`；commit `9c90a87433b82ab615094a39d0ef1c17dadbc5b7` |
| Harness 插件系统与宿主接口 | `/Volumes/WD_BLACK/Repo/deepseek-harness` | `workspace-files` 等包版本 `0.2.1-rc.2`；commit `687f282e8625c6b8d11ff58211a90524be2e4317` |
| 实现与交付仓库 | `/Volumes/WD_BLACK/Repo/dsh-large-jsonl-viewer` | 调研时为空目录，未初始化 Git |

开发前记录实际使用的 Harness 版本和 commit。Harness API 尚未稳定，依赖范围从已验收版本起步，不能直接声称支持所有 `0.2.x`。外部包使用自己的名称 `dsh-large-jsonl-viewer`，不冒用 `@deepseek-ai` scope。

### 已确认的宿主能力

- 插件使用 Cordis；Host 是 Node，Client 是浏览器。所有注册和长期资源必须有卸载清理。
- 可安装包通过 `package.json` 的 `dsh.bundle.patch` 声明组合层，通过 `dsh.client` 与 `./client` 导出声明浏览器部分。
- 文档预览有公开的 `ctx.documentPreviews.register(...)`，支持 `loading: 'renderer'`，允许插件自行请求数据，不经过内置文本分页。
- 查看器内容注册到 keyed slot `sidebar.right.tab.document`；预览标题栏还提供 `sidebar.right.tab.document.action`。
- 文档资源地址带 Session 身份；`fileAddressFor` / `hostFileOf` 等工作区路径工具负责地址语法。不能用当前聊天身份替换地址中的 Session。
- `@deepseek-ai/dsh-api-workspace-files` 导出 `WorkspaceFileScope`，并注册对应 Typert lookup。它能从 Session header 解析根目录，包括冷 Session，不必启动 Agent 或读完整聊天日志。
- `ctx.fs` 提供 `resolve`、`lstat`、`stat`、`readByteRange` 等能力。`processPath` 是**文件系统执行环境中的路径**，不保证是 Host 本地路径。
- Typert 提供 `TypertRemoteService`、`@Remote`、生成的 `./typert` / `./remote` 和 `ctx.remote.$mount(...)`；已有 authenticated Connection / Gateway 负责传输。
- 内置 `workspaceFiles.read` 按文本行顺序读取；`readBytes` 是有界字节读取。两者都没有大文件行索引，不能靠调高现有文件大小限制实现本插件。

### v1 范围

支持稳定、未压缩、UTF-8 普通文件；优先验收本地 `fs-local` 以及其正常组合的权限层，Web 和 Desktop 共用 Client 实现。浏览器连接另一台 Host 时，文件指那台 Host 所访问的文件，不是浏览器用户电脑的任意文件。

v1 不包括编辑保存、自动追尾、全文件搜索、跨记录 JSONPath、压缩文件、云对象存储、聊天工具、自动把内容送给模型。SSH 等后端可以沿用 `ctx.fs` 读取，但需单独证明随机读取成本、版本识别和取消能力后才能列为支持；不能把“接口存在”等同于“已支持大文件”。

## 2. 功能与交互

### 必须达到的功能

| 能力 | 要求 |
| --- | --- |
| 打开入口 | 点击现有文件面板中的 JSONL / NDJSON 即可进入；预览器选择器中显示 Large JSONL Viewer，仍保留 Harness 原有文本预览 |
| 渐进索引 | 第一条记录边界就绪即可查看；前 100 个物理行逐步进入选择列表；之后仍能访问第 101 行及更后面的行 |
| 导航 | 首行、上一行、下一行、输入物理行号、末行；末行只在完整索引后启用 |
| 未完成索引的跳转 | 展示等待目标行的状态，保留旧正文；单独取消此次跳转，不取消索引 |
| 随机 | 在已索引范围抽样，尽量避开当前行；索引完成前明确显示抽样范围 |
| 历史 | 后退/前进独立于相邻行；只记录已成功显示的访问，最多 200 项；新访问截断前进分支 |
| 常规记录 | 本地打包的只读 Monaco，保真格式化、对象/数组折叠、展开 1/2 级/全部、原始文本、本条记录查找 |
| 默认展开 | 默认 2 层；支持 `0` 全折叠、`-1` 全展开、`1–128` 层；不将其用于自动展开超长记录整棵树 |
| 结构导航 | 右侧 1/2 级 key 导航，定位并展开祖先；重复 key 按实际位置区分，中文与 emoji 定位正确 |
| 阅读布局 | 默认换行；结构栏可收起、调整宽度，约 20% 且默认上限 200px；窄面板默认收起 |
| 专注 | 隐藏插件自己的结构栏和底部状态，退出后恢复偏好；不改写 Harness 外层布局 |
| 索引控制 | 底部显示状态、已索引行数、字节进度；详情显示速度、ETA、缓存恢复状态及暂停/继续/取消/重建 |
| 超长记录 | 增量严格校验、分页对象/数组、64 KiB 原文/标量窗口，禁止整条物化 |
| 复制 | 只复制常规记录的原始文本；超过预算时明确提示使用导出，不拼接巨型剪贴板字符串 |
| 导出 | 导出当前源记录的精确字节，包括原有行分隔符；遵循第 7 节的有界传输方案 |
| 文件变化 | 追加、截断、替换、原地修改均使旧索引失效；停止旧任务并提供重建入口 |
| 生命周期 | 切换文件、刷新、切换预览器、关闭 tab、断线、插件卸载都正确取消和释放 |
| 外观 | 使用 Harness 主题和控件，中文/英文 locale；键盘焦点、ARIA、加载/错误状态可用 |

顶部不重复现有预览标题栏的文件路径、换行和刷新按钮。插件内增加一条紧凑导航工具栏，其他操作放“更多”。`wrap: true` 让 Harness 外层换行控件作用于常规正文和超长文本窗口。

快捷键沿用 `Alt+↑/↓` 切行、`Alt+←/→` 历史，仅在查看器聚焦时响应；先核对宿主命令/快捷键注册机制与冲突，不能全局拦截聊天输入。

`openResource(address, { params: { line } })` 的 `line` 表示 JSONL **物理记录行号**，不是格式化后的 JSON 行号。通过公开 `useTabInfo()` 导航数据处理重复打开带来的新 revision，不使用预览器内部 store。

## 3. 迁移策略与代码边界

采用“读取内核迁移 + Harness Host 适配 + 原生 React 预览”的结构。不嵌入 VS Code Webview，不保留 `acquireVsCodeApi`，不新开独立网页服务器。

### 参考代码处理表

以下相对路径均属于 `/Volumes/WD_BLACK/Repo/vscode-large-jsonl-viewer`。

| 来源 | 处理方式 |
| --- | --- |
| `src/index/scanner.ts` | 复用物理行扫描、前 100 行通知、检查点与暂停策略；将源文件打开改成注入的字节读取接口 |
| `src/index/store.ts` | 复用 uint64 分页索引、校验和、原子提交；更换源身份结构，补上目录元数据和活动索引的硬预算 |
| `src/io/files.ts` | 保留短读/短写、偏移校验、UTF-8 原则；源读取身份适配 `ctx.fs`，私有缓存仍可使用 Node fs |
| `src/json/normal.ts` | 复用 `jsonc-parser` 的校验和只改空白的格式化，不经 `JSON.parse → stringify` 重建数据 |
| `src/json/stream.ts` | 复用严格 tokenizer、分页和有界预览；去掉直接打开源路径，换成 RangeReader |
| `src/json/expansion.ts` | 复用展开深度校验与语义 |
| `src/editor/session.ts` | 复用会话/generation 的设计；移植为 Host manager，新增调用者引用、断线与受限队列 |
| `src/workers/index.ts`、`record.ts` | 改造为 ESM workers，通过有界 MessagePort 向 Host 请求源文件字节 |
| `webview/navigation.ts` | 复用随机行和 200 项历史的纯逻辑 |
| `webview/main.ts` | 只迁移 Monaco、折叠、定位等独立逻辑；UI 和状态改成 Harness React/Slots/Store |
| `webview/style.css`、`template.ts` | 参考布局，不照搬 VS Code 变量、全局 DOM 或硬编码中文 |
| `src/editor/provider.ts`、`src/extension.ts` | 不迁移 VS Code API；将其中的业务生命周期拆到 Host 和 Client |
| `test/unit/*`、`scripts/generate-fixtures.ts`、`benchmark.ts` | 迁移内核回归和生成器；新增 Harness 适配、真实浏览器和安装包测试 |

参考项目为 MIT。复制代码时保留许可证与归属，记录来源 commit 和改造范围；随包附带 Monaco、jsonc-parser 的所需许可证。不能把原项目测试通过或原项目基准写成本插件的验证结果。

### 建议目录

使用一个发布包，外加最小开发 workspace。这样可以匹配当前 Typert 生成器的工作区发现方式，同时避免拆出多个没有独立生命周期的发布包。

```text
dsh-large-jsonl-viewer/
  plan.md
  README.md
  package.json                       # private，开发与验收脚本
  pnpm-workspace.yaml
  pnpm-lock.yaml
  tsconfig.host.json                 # Host 聚合
  tsconfig.client.json               # Client 聚合
  packages/
    plugins/
      large-jsonl-viewer/
        package.json                 # 发布名 dsh-large-jsonl-viewer
        cordis.patch.yml
        tsconfig.json                # solution
        tsconfig.host.json
        tsconfig.client.json
        src/
          index.ts                   # Host Cordis 入口
          config.ts
          types.ts                   # Client 可安全引用的协议类型
          host/
            controller.ts            # Typert Remote 服务
            source.ts                # WorkspaceFileScope + ctx.fs
            manager.ts               # 文件会话、引用、任务调度
            cache.ts
            worker-bridge.ts
          core/
            index/{scanner,store}.ts
            json/{normal,stream,expansion}.ts
            io/{reader,cache-files}.ts
          workers/{index,record}.ts
          client/
            index.ts                 # Remote 装配与 UI 注册的生命周期
            registration.ts
            face.ts
            store.ts
            navigation.ts
            JsonlPreview.tsx
            MonacoRecord.tsx
            LargeRecord.tsx
            Outline.tsx
            locales.ts
            style.css
        locale/{en,zh}.json           # 插件管理页展示元数据
        LICENSE
        THIRD_PARTY_NOTICES
        lib/                         # 构建产物，不手工修改
  scripts/                           # 构建、协议生成、fixtures、benchmark
  tests/{core,host,client,integration,packaging}/
  docs/{compatibility,validation}.md
```

该目录是建议，并非已验证的生成器配置。P0 必须在独立 checkout 中跑通；禁止让发布脚本依赖邻居 Harness 仓库的绝对路径或未导出模块。

## 4. Harness 接入与打包

### 4.1 Host / Client 注册

发布包至少包含：

- `type: "module"`、Host 入口 `.`、Client 入口 `./client`。
- Client 安全的 `./types`，生成的 `./typert` 和 `./remote`。
- `dsh.bundle.patch` 指向随包的 `cordis.patch.yml`，插入本包的 Loader 行。
- `dsh.client.platform: "web"`，按实际依赖声明加载关系；需要页面启动后即可接管文件预览时使用 `immediately: true`。
- `engines.dsh` 精确覆盖已验收宿主；注意预发布版本的 SemVer 匹配，不能用普通稳定版本范围误排 `rc`。
- 按已安装版本声明 Cordis 和共享 DSH 服务的 peer/development dependencies。外部发布包不能保留 `workspace:*`。
- `files` 覆盖入口、worker、Client chunk、Monaco 资源、locale、组合层、生成协议与许可证。

Client 使用真实接口注册：

```ts
// 注册意图示例；完整类型、locale、inject 和 disposer 以 P0 编译结果为准。
ctx.documentPreviews.register({
  id: 'dsh-large-jsonl-viewer',
  extensions: ['jsonl', 'ndjson'],
  priority: 'extension',
  title: () => t('title'),
  loading: 'renderer',
  wrap: true,
})
```

注册必须置于 `ctx.effect` 内；body 用相同 id 注册 `sidebar.right.tab.document`，通过 `ctx.slots.inject` 等待该 slot 可用。不要替换全局 `root`，不要 import 内置预览器的私有组件。

### 4.2 独立 Remote 装配

Host 定义 `largeJsonl` namespace。使用现有 `WorkspaceFileScope` lookup 解析 Session 身份，保持 Gateway 的 Session 资源授权；Host 依赖 `workspaceFiles` 以保证 lookup 提供方就绪。

插件自己的 Client 装配部分挂载本包生成的 `/remote` contribution，不改 Harness 内置 `api-remotes` 列表。装配只依赖 `remote`；实际调用部分再依赖 `remote` 和 `remote.largeJsonl`，避免“等自己创建的 namespace”造成死锁。挂载、失败回滚、异步 disposer 都应受 Cordis 管理。

当前文档以宿主内置 assembly 为主要示例。树外插件自行 `$mount` 的严格类型生成、模块装载和热卸载组合必须在 P0 用真实安装包验证；不能只写一份看似相同的 TypeScript 接口假装已有 RPC。

### 4.3 构建风险必须前置

当前 `@deepseek-ai/dsh-typert-generator/tsdown` 的 `findWorkspaceRoot` 查找带 `tsconfig.host.json` 与 `packages/` 的根，分析器通过项目引用发现包。最小 workspace 需要 Host/Client 独立 TypeScript program，先生成 Host reflection/Remote 产物，再构建 Client。

Harness 的 `packages/client/tsdown.client.ts` 是仓库构建文件，不能假设它是可从 npm import 的公共 SDK。先检查当前安装版本是否有公开构建入口；若没有，在本仓库实现必要的独立构建适配，遵循 `window.__ModuleLoader__.load({ id, factory })` 格式，记录参考文件与许可证。不要把普通 Vite 页面产物直接当作 Client plugin。

Monaco 及其 worker 不使用 CDN，不把 worker URL 指向开发仓库或假定 `/plugins/` 可以任意托管资源。先验证宿主可服务的资源格式；可采用随 Client 编译的 worker 源文本 + Blob worker、字体 data URL、插件 effect 管理的 CSS。如使用该方式，必须在 Web 和 Desktop 的实际 CSP 下验证，并在卸载时释放 URL/worker。Monaco 重依赖应尽量延后到首次打开查看器。

## 5. Host 数据内核

### 5.1 文件身份和读取授权

客户端只提交资源中的 Session id、路径和操作参数，不提交可直接执行的 Host 路径、索引目录或任意 worker 代码。

打开流程：

1. Gateway 通过 `WorkspaceFileScope` 得到 Session 的工作区根；不存在的 Session 明确报错。
2. 参考 `workspaceFiles` 的公开行为进行空路径、NUL、文件类型检查；v1 与其一致地拒绝最终路径为符号链接、目录及设备。
3. 用 `ctx.fs.resolve(path, { cwd, signal })` 得到 opaque `FsTarget`，读取 `stat` 的版本和大小。需要已知、非负 safe integer 大小；不能把未知大小当作零。
4. 用 `ctx.fs.readByteRange` 读取首尾有界指纹和之后所需的块。所有源内容都经该服务读取，不能从 `targetKey` 或 `processPath` 推导本机 fs 路径。
5. 在记录读取/解析开始与结束、索引检查点、恢复缓存时检查源版本与大小；扫描期间也要周期检查。文件系统更换使相关会话全部失效。

权限与可访问路径沿用组成后的 `ctx.fs`，包括已允许的工作区外文件；不自建一个脱离宿主语义的“所有绝对路径都能读”接口。Session id 不因后台索引已存在而省略。多 Peer 的授权继续由 Gateway 检查，不能用猜到的 `viewerId` 越权访问其他 Session。

文件版本检查不是 OS 文件快照。`ctx.fs` 当前没有跨所有 range 的事务承诺，查看期间源文件稳定是正常使用前提；若发现不一致，不发布混合结果。此限制必须写入 README。

### 5.2 worker 与背压

源文件的 `ctx.fs` 对象不能传入 worker。推荐结构：

```text
React 预览
  → 已认证的 Gateway / largeJsonl Remote
  → Host manager / ctx.fs
  ↔ 有界 worker 消息与可转移字节块
  → 索引 worker、记录解析 worker
  → 插件私有磁盘索引
```

抽象一个 `RangeReader`，供 scanner、stream tokenizer 和原文窗口共同使用。worker 请求 `{ offset, length, taskId }`，Host 校验任务所属文件和范围，通过 `ctx.fs` 读取后返回字节。worker 仅可直接操作 Host 分配的插件私有缓存，不可自行打开源路径。

- 每个读取任务最多一个在途块，或显式配置最多两个预取块；传输预算包括等待队列中的字节。
- 有界 worker pool、活动文件数和待处理任务数；前台切行优先于后台扫描。
- 不在 Host 主线程做同步大 JSON 解析；不在浏览器做整文件扫描。
- 前台取消必须终止/中断实际任务，不能只忽略结果；底层读取使用对应 AbortSignal。
- worker 消息、磁盘索引和 RPC 属于数据输入，必须校验；同进程静态类型之间不重复堆叠无意义校验。
- Worker 异常或退出有明确失败状态；插件卸载等待任务结束并关闭 MessagePort。

### 5.3 索引格式与预算

沿用按物理行边界存储 uint64 的策略。索引只存偏移、校验和、源身份，不存正文。

- 以 LF 定位物理行；CRLF 不影响边界，展示时剥离分隔符，导出时保留。
- 连续空白行占行号；末尾 LF 不额外产生空记录；空文件为 0 行；EOF 提交无末尾 LF 的最后一行。
- 默认每页 4096 个 offset，页带完整性校验；以已完成行边界恢复。
- 临时文件写完后原子提交 manifest；未提交页不能被恢复读取。
- 所有内存/协议偏移使用经校验的 safe integer，不做 32 位位运算；磁盘 uint64 不意味着支持超过 JS 安全整数的文件。
- 缓存使用本插件自己的 format version，不直接复用 VS Code 插件缓存。
- 缓存 key 至少含部署缓存 namespace、Session 身份、opaque target 身份和源版本/大小/指纹；不同 fs 实例的活动会话不共享。第一版只在同一 Session 的多视图中共享索引，跨 Session 去重以后再做。
- 复用缓存前重新验证文件，索引页按需验证。损坏后明确重建，不静默显示错行。
- 每个缓存只有一个 writer；跨 Host 进程使用锁或隔离目录，不能并发覆盖同一个 manifest。
- 缓存不可写时使用临时目录并提示；关闭后清理临时目录。磁盘满必须结束相关写入并呈现错误/受限状态。

**必须处理参考实现的规模上限：**参考 `OffsetStore` 把所有页目录保留在数组中，manifest 上限为 16 MiB；它不是严格 O(1) 内存。v1 必须同时限制页目录、活动索引磁盘体积和记录数，在超限前停止索引、保留已就绪范围并告知原因。若要承诺高密度短行的 50/100 GB 文件，再实现磁盘分页的页目录，不能只加大 manifest 上限。

索引大小约为 `8 × (行数 + 1)` 字节再加页校验/目录；一亿行仅 offset 就约 763 MiB。缓存预算不能只按源文件大小估计。

### 5.4 记录保真与超长记录

常规模式预算基线来自参考项目：原文 8 MiB、格式化后 16 MiB、100,000 节点、128 层、约 2 秒处理预算。任一预算超限进入流式模式。

不得通过 JSON 反序列化/重新序列化改变 `9007199254740993`、`-0`、高精度小数、指数形式、重复 key、属性顺序或转义文本。格式化只改变字符串以外的空白。

非法 JSON 是记录级结果，不让整个文件会话失败。空白行、BOM、非法 UTF-8、截断文本都有明确状态；非法 UTF-8 给有界十六进制片段，不静默替换字符。

超长模式每页最多 100 个节点，窗口默认 64 KiB，最多保留 2000 个导航/节点元数据，容器栈最多 2048 层。超过结构深度仍可查看原文字节窗口。窗口边界要正确处理 UTF-8 跨字节字符；原始 byte offset 与显示文本位置不能混用。

节点身份使用源位置/唯一 id，不使用 key 文本或 JSONPath 唯一标识。Host 只接受当前记录已发布的节点 id，并验证其文件版本和字节范围。超长容器后续分页允许重新扫描，但必须显示工作进度并可取消，不承诺 O(1) 翻到百万项数组末尾。

## 6. Remote、状态与生命周期

以下为**本项目拟新增的 API**，不是 Harness 已有方法。具体签名应满足 Typert 生成规则：参数有明确名字，支持取消的方法最后一个参数是 `signal: AbortSignal`，Client 使用生成的类型与 `RemoteResult`。

### 6.1 建议 Remote

每个方法都带可供 Gateway 授权的 Session lookup；表中省略重复参数和 `signal`。

| 方法 | 职责与返回 |
| --- | --- |
| `watch(path, clientViewKey)`，stream | 建立一个视图 lease；先返回 ready（viewerId、文件版本、有效配置），再发完整进度快照/失效事件；abort/结束释放 lease |
| `readRecord(viewerId, requestId, generation, line)` | 若行已就绪，返回 normal/large/invalid 记录；未就绪返回明确状态，由 Client 观察进度后重试 |
| `readNodePage(viewerId, requestId, recordToken, nodeId, skip)` | 返回有界子节点页；recordToken 防止使用过期节点 |
| `readWindow(viewerId, requestId, recordToken, nodeId, offset)` | 返回有界原文/标量字节窗口与实际 offset、EOF |
| `controlIndex(viewerId, generation, action)` | pause/resume/cancel；作用于该文件会话，所有共享视图同步看到 |
| `rebuild(viewerId, expectedGeneration)` | 取消旧任务、失效旧 token、增加 generation，重新开始；共享视图收到 reset |
| `readExportChunk(viewerId, recordToken, offset, length)` | 用 unary binary Remote 返回当前记录的有界原始字节；每块检查源版本 |

`watch` 的 lease 绑定调用者与 Session，不将视图状态持久化到 Session JSONL。进度流只发送小型快照，合并更新，慢消费者至多保留最新进度和必要终止状态，不积压正文或无限事件队列。

暂定错误域 `large-jsonl/*`：`source-changed`、`unsupported-source`、`view-expired`、`stale-record`、`line-not-ready`、`line-out-of-range`、`busy`、`cache-failed`、`limit-exceeded`。公共 Gateway 失败复用宿主已有 code；Client 按 code 分支，本地化解释，不匹配中文错误字符串。无效 JSON 放在正常记录结果中。

### 6.2 竞态规则

所有异步结果绑定：

`Host 服务 epoch + viewerId + 文件 generation/version + Client content.revision + requestId`

- 快速切行先取消前一次 read/parse，只有最新请求可替换正文。
- body 只在显示成功后调用 `content.loaded(version)`，失败调用 `content.failed()`；不能等全文件索引完成才结束首屏 loading。
- 折叠状态仅保留最近 10 条常规记录；历史仅保存行号等轻量信息，不保存 200 份正文。
- Client store 按 tab id 隔离；同一文件的多个视图可共享 Host 索引，但各自的选中行、正文、历史独立。
- “取消跳转”是视图级操作，“暂停/取消索引”是文件会话级操作；UI 解释其共享影响。
- `content.revision` 改变先取消旧工作并重新验证。相同源版本的普通刷新可复用索引；明确“重建索引”才丢弃旧索引。
- 宿主默认自动刷新会触发 revision 更新：源版本变化时停止旧会话并显示“文件已变化，重建索引”，不要静默连续全扫增长中的日志。
- 隐藏或切换 renderer 时取消渲染相关任务；保留轻量视图状态到 tab 生命周期结束，重挂载时重新建立 lease 并验证源版本。
- 最后一个 lease 结束时保存检查点、停止后台 worker；不无限保活。Host crash/断线不能依赖显式 close RPC 才清理。
- 重连重新取得 ready/epoch，旧 viewerId 和旧 recordToken 不可继续用；读取结果不跨 generation 混合。
- 插件卸载按顺序停止 Client 调用、释放 stream/资源、终止 worker、提交可用检查点并关闭文件，相关注册全部撤销。

## 7. 复制、导出和配置

### 7.1 有界导出

Web / Electron 中不能假定存在 VS Code 的 `showSaveDialog`，也不能把 `Blob([整条256MiB记录])` 当作流式导出。

主方案：用户点击导出时，在支持的浏览器使用 File System Access API 获取 writable，然后从 `readExportChunk` 逐块请求原始字节并顺序写入，严格背压。每个块为受支持的 unary binary Remote，避免预先假定 Remote stream 支持裸二进制。文件名默认为 `record-<物理行号>.jsonl`。

如果浏览器/桌面壳不支持该保存能力，提供有明确总字节上限的 Blob 下载（建议不超过 16 MiB），超大记录明确禁用该方式并说明限制。v1 如要求该环境也能导出任意大记录，必须在交付前实现并验证宿主已有的安全保存/下载扩展点；不能偷偷开放任意路径写入接口或无鉴权下载路由。

导出开始与每块返回都校验 recordToken/源版本；失败时 abort writable，不能把半条记录报告为成功。原始分隔符和 BOM 按原字节保留。通过 Host 保存时还必须拒绝覆盖源文件；浏览器保存能力的覆盖提示遵循其原生行为，并明确与 Host 源路径隔离的语义。

### 7.2 配置

部署可调参数由 Host Config schema 校验，向 Client 返回实际有效值；不要仅散落为 `DEFAULT_*`。UI 阅读偏好由 Client 自有 store/宿主公开偏好机制管理，不修改 VS Code 设置。

| 配置 | 起始默认值/策略 |
| --- | --- |
| 扫描块 | 4 MiB，允许 1/4/8 MiB |
| 常规原文预算 | 8 MiB，可配 1–16 MiB |
| 格式化预算 | 16 MiB，Host 与 Client 传输/内存预算联动 |
| 首批可选记录 | 100 个物理行，只预取选中的正文 |
| 超长节点分页 / 原文窗口 | 100 项 / 64 KiB |
| 默认展开 / 换行 / minimap | 2 / true / false |
| 非活动缓存预算 | 512 MiB，LRU 清理；另设活动索引、manifest、记录数上限 |
| 进度间隔 / 文件复核间隔 | 约 250 ms / 约 2 s；读取前后另行验证 |
| 普通解析预算 | 100,000 节点、128 层、约 2 s |
| 并发 | 起步最多 2 个后台索引、2 个记录任务；队列有界且前台优先 |
| 缓存目录 | Config 允许显式绝对路径；默认使用插件专用 OS cache 目录，由明确的 resolver 计算 |

默认缓存位置、限额和并发在 P1 基准后确定，写入 README。超限必须是可解释状态，不能 OOM 后才知道。生成基准文件前核对磁盘空间，不默认创建 50/100 GB 文件。

## 8. 分阶段实施及退出条件

### P0：真实插件原型与风险验证

- [ ] 建立独立 workspace、单个发布包、版本锁定、ESM Host/Client 构建。
- [ ] 验证 Typert 对树外包与 `WorkspaceFileScope` 的生成，产生真实 `/typert`、`/remote`，Client 自行挂载。
- [ ] 打包 tgz，安装到隔离的测试 Harness home/profile；依照已安装 CLI 的帮助使用 `dsh plugin --profile … add <tgz>`，通过 `dsh` profile 启动。
- [ ] 真实 JSONL 文件出现在现有预览器选择器，`loading: 'renderer'` 不触发默认正文读取。
- [ ] 经 Session lookup + `ctx.fs` 读取一个小字节窗口，验证普通错误和取消可到达 Client。
- [ ] 在 Web 与 Desktop 验证 Monaco、worker、字体、CSS 离线加载及关闭释放。
- [ ] 验证资源带行号导航、content revision、插件禁用后回到原生文本预览。
- [ ] 把依赖版本、构建限制、桌面导出能力记录到 `docs/compatibility.md`。

**退出条件：**从 tarball 安装后能打开小文件、显示一条记录、取消/关闭且可卸载。仅源码开发服务器可用不算通过。若独立生成/模块加载存在宿主缺口，先用最小可复现例记录缺失接口并调整方案，不进入完整 UI 开发掩盖问题。

### P1：文件读取、worker、渐进索引和缓存

- [ ] 迁移 `RangeReader`、scanner、分页 store；接入有界 worker/源读取桥。
- [ ] 处理 LF/CRLF/EOF/空行/短读，前 100 行渐进就绪。
- [ ] 文件版本与指纹、检查点恢复、索引页验证、writer 隔离、缓存清理与硬预算。
- [ ] 实现文件 manager、watch lease、进度合并、暂停/继续/取消/重建。
- [ ] 覆盖断线、关闭最后一个视图、worker crash、磁盘错误。

**退出条件：**1 GiB 样本在完整索引前可查看已完成行；关闭重开恢复检查点；多个视图无重复无界扫描，内存不随源字节数增长。

### P2：常规记录和完整浏览体验

- [ ] 保真格式化、严格 JSON 校验、Monaco 只读渲染与折叠。
- [ ] 相邻行/跳行/随机/历史、取消跳转、默认展开。
- [ ] key 导航、Unicode 位置映射、换行、专注、响应式布局。
- [ ] source revision/requestId 过滤，独立 tab store，源文件变化提示。
- [ ] 中英 locale、主题、键盘、复制与常规导出。

**退出条件：**参考插件的常规浏览行为在 Harness 中成立；快速操作不展示过期正文，重复 key 和数值字面量正确。

### P3：超长记录与资源限制

- [ ] 迁移增量严格 tokenizer、node token、分页、64 KiB 文本窗口。
- [ ] 预算超限自动转流式模式；解析中的“未校验完”与最终 valid/invalid 清晰区分。
- [ ] 32/256 MiB 单条、百万项数组、超深嵌套、取消与错误恢复。
- [ ] 验证导出大记录使用受支持的有界路径，缺少能力时明确受限。

**退出条件：**256 MiB 单条不创建完整字符串、完整 AST 或 Monaco model；切行/取消可用，进度和错误不污染其他视图。

### P4：安装验收、性能与交付

- [ ] 从干净目录构建和打包；解包检查 exports、worker、locale、依赖、许可证完整。
- [ ] 独立 Harness home/profile 安装 tgz，分别验证 Web、Desktop、卸载、重新安装。
- [ ] 1/10 GiB 混合数据基准、快速切行、多 tab、断线与热卸载。
- [ ] 至少 1000 次切行/关闭重开观察内存、listener、worker 和文件句柄。
- [ ] README 写明支持环境、安装、配置、数据/缓存位置、导出限制和未测内容。
- [ ] 输出 `docs/validation.md` 和原始 benchmark JSON，不把目标写成结果。

**退出条件：**提供可安装 tgz、可重复执行的测试命令、实际验证报告。50/100 GB、Windows/Linux、不同文件系统分别标记通过或未验证，不能由 macOS 1/10 GiB 结果外推。

## 9. 测试与验收标准

只为业务行为和风险写测试，不为装饰样式堆快照。以下几类必须覆盖。

### 内核与数据正确性

- 空文件、单行、有/无尾 LF、连续空白行、CRLF 跨块、BOM、非法 UTF-8、中文/emoji 跨块。
- 不足/等于/超过 100 行；前 100 行含无效和超长记录；能继续查看第 101 行。
- 大整数、负零、指数、高精度小数、重复 key、数字形 key 属性顺序、转义换行和引号。
- 根对象/数组/标量，巨大字符串、百万项数组、深度超限、无效 JSON。
- 超过 2/4 GiB 偏移；另测 safe integer 越界明确拒绝。稀疏文件只验偏移，不作为吞吐证据。
- 源文件变化、短读/短写、权限/I/O 错误、缓存损坏、半写 manifest、format version 不兼容、磁盘预算耗尽。
- 对照独立逐行读取器/生成数据真值，不能让被测索引自行证明正确。

### Harness 与协议

- `WorkspaceFileScope` 正常/冷/缺失 Session；地址 Session 与当前聊天不同。
- 工作区外路径遵循 `ctx.fs` 的实际权限；非普通文件、最终 symlink、未知 size。
- 多 Peer 授权、伪造或跨 Session viewerId、过期 recordToken、越界节点/窗口。
- Client 不能提交源 Host 路径绕过文件系统；Node worker 只读获准字节。
- 多视图共享与独立导航，取消某个视图不误取消其他读者。
- 请求乱序、断线重连、Host epoch 更换、worker crash、插件卸载，结果与清理均可观测。
- 进度慢消费者、队列满、缓存不可写都有有界行为。
- 引入的 Remote 严格 codecs 对错误输入生效，不能仅 mock controller 而跳过 Gateway。

### 真实 Client 与安装包

- JSONL 默认选中本插件；选择原生文本查看仍可用；禁用后原生预览恢复。
- `loading: 'renderer'` 未触发全文件/默认文本页下载。
- 折叠、展开、定位、查找、换行、历史、外部物理行号导航。
- 首次渲染完成才记录历史；失败、取消、过期请求不加入。
- 主题切换、窄面板、键盘焦点、中英文文案。
- DevTools/网络记录确认离线资源齐全；正文没有进入聊天记录或模型请求。
- 安装包在无邻居源码仓库的环境可运行；闭包、worker URL 与 peer 解析正确。
- 增加 owner-local UI expected output/截图。此插件不改变模型/Session 日志，不为凑测试创建虚假的聊天事件；若后续加模型工具，再按 Harness 的 session snapshot 规则补充。

### 性能目标与报告方式

以下目标适用于本地 SSD、稳定文件、普通记录不超过 1 MiB，需记录硬件、Node/DSH/浏览器版本和冷热缓存条件：

| 指标 | 初始目标 |
| --- | --- |
| 预览外壳可交互 | p95 < 500 ms；冷启动/首次加载 Monaco 单列 |
| 首批 100 行合计 ≤ 16 MiB 的首次浏览 | p95 < 2 s，含选中正文可交互；不表示格式化 100 条 |
| 已索引随机记录显示 | p95 < 300 ms，含 RPC、浏览器模型建立和绘制 |
| 已显示记录的折叠/key 导航 | p95 < 100 ms |
| 取消 | 可分段任务 p95 < 200 ms；同时报告底层任务实际停止时间 |
| 扫描缓冲与索引页内存 | 初始预算约 64 MiB；页目录另外计量并设硬上限 |
| 单视图增量内存 | 起始目标 < 300 MiB，Host/worker/浏览器分别记录并按进程去重 |
| 全量索引 | 对照同环境、同 `ctx.fs` adapter 的纯顺序字节读取，目标吞吐 ≥ 60% |

大记录另报首个可用窗口、完整严格校验耗时、峰值 RSS、浏览器增量和取消延迟。索引不能跳过字节，因此总索引时间受文件大小和存储吞吐约束，不承诺“100 GB 几秒完成”。

原 VS Code 项目报告的是 1/10 GiB 暖缓存后端及 32/256 MiB 单条结果，其中没有 Harness RPC/React/浏览器完整延迟。本项目必须重新测量。

## 10. 交付给接手 AI 的要求

1. 先阅读本计划及下方关键源码，记录实际宿主版本；按 P0 → P1 → P2 → P3 → P4 实施，每阶段更新状态与验证证据。
2. 默认只修改本仓库；参考插件与 Harness 仓库作为只读资料。确有宿主接口缺口时，单独给出具体补丁需求，不把修改宿主作为隐藏安装步骤。
3. 本次交付是 `plan.md`；后续实现的最终交付是源码、锁文件、完整 README、测试/性能脚本、实际报告和可安装 tgz。
4. 在本仓库定义并记录可执行的 `pnpm build`、`pnpm typecheck`、`pnpm test`、`pnpm test:integration`、`pnpm test:packaging`、`pnpm benchmark`、`pnpm pack:plugin`。这里是拟定脚本名，当前尚不存在。
5. 构建和测试不调用真实模型，不要求 API key；用隔离 Harness home/profile 和 fixture Session 验证。宿主只通过 `dsh` profile 启动。
6. 优先交付预构建 tgz，避免 Git 安装依赖 `prepare` 授权；若支持 Git 安装，单独验证自包含构建并准确说明要求。
7. 未完成或不支持的能力必须出现在 README/验收报告；不能以“已适配 API”“单元测试通过”代替真实宿主和安装包验收。

### 关键本地资料

源插件：

- [README 与当前功能](/Volumes/WD_BLACK/Repo/vscode-large-jsonl-viewer/README.md)
- [原始设计](/Volumes/WD_BLACK/Repo/vscode-large-jsonl-viewer/plan.md)
- [实测范围与限制](/Volumes/WD_BLACK/Repo/vscode-large-jsonl-viewer/docs/validation.md)
- [宿主耦合位置](/Volumes/WD_BLACK/Repo/vscode-large-jsonl-viewer/src/editor/provider.ts)
- [索引存储与目录上限](/Volumes/WD_BLACK/Repo/vscode-large-jsonl-viewer/src/index/store.ts)
- [流式 JSON](/Volumes/WD_BLACK/Repo/vscode-large-jsonl-viewer/src/json/stream.ts)

Harness：

- [架构及 profile 启动](/Volumes/WD_BLACK/Repo/deepseek-harness/docs/architecture.md)
- [插件打包与安装](/Volumes/WD_BLACK/Repo/deepseek-harness/docs/user/develop/basic/publish.zh.md)
- [Client 约定](/Volumes/WD_BLACK/Repo/deepseek-harness/packages/client/AGENTS.md)
- [文档预览的公开扩展点](/Volumes/WD_BLACK/Repo/deepseek-harness/packages/client/ui-sidebar-documentpreview/README.md)
- [DocumentContent、slot props](/Volumes/WD_BLACK/Repo/deepseek-harness/packages/client/ui-sidebar-documentpreview/src/client/document/contract.ts)
- [预览 registry](/Volumes/WD_BLACK/Repo/deepseek-harness/packages/client/ui-sidebar-documentpreview/src/client/document/registry.ts)
- [renderer 自行加载的参考](/Volumes/WD_BLACK/Repo/deepseek-harness/packages/client/ui-sidebar-documentpreview/src/client/office/index.ts)
- [Session 文件读取语义](/Volumes/WD_BLACK/Repo/deepseek-harness/packages/api/workspace-files/README.md)
- [WorkspaceFileScope 与 lookup](/Volumes/WD_BLACK/Repo/deepseek-harness/packages/api/workspace-files/src/index.ts)
- [文件系统接口](/Volumes/WD_BLACK/Repo/deepseek-harness/packages/fs/fs/src/index.ts)
- [Remote 编写](/Volumes/WD_BLACK/Repo/deepseek-harness/docs/cookbook/adding-a-remote-api.md)
- [Gateway 与协议生成](/Volumes/WD_BLACK/Repo/deepseek-harness/docs/api-gateway.md)
- [Remote 装配参考](/Volumes/WD_BLACK/Repo/deepseek-harness/packages/api/remotes/src/client/index.ts)
- [Typert 外部构建入口](/Volumes/WD_BLACK/Repo/deepseek-harness/packages/typert/generator/src/tsdown-plugin.ts)
- [Typert 工作区发现要求](/Volumes/WD_BLACK/Repo/deepseek-harness/packages/typert/generator/src/workspace.ts)
- [Client 编译器参考，非公共包入口](/Volumes/WD_BLACK/Repo/deepseek-harness/packages/client/tsdown.client.ts)
- [树外 Client 工厂样例](/Volumes/WD_BLACK/Repo/deepseek-harness/packages/preset/agent-preset/skills/cordis-plugin-development/templates/decoration/client.js)

这些链接用于本机交接；构建产物和安装流程不得依赖这些绝对路径。


## 11. 实现状态（2026-10-21）

已实现独立发布包、严格 Typert Remote、Session/Peer 视图租约、`ctx.fs` 字节桥接、ESM worker、渐进可恢复索引、记录预算、保真格式化、Monaco、导航历史、结构导航、超长记录分页/窗口、有界导出和生命周期清理。

P0 的独立构建/tgz/真实 Web 接入、P1–P3 的主要功能已落地。P4 已完成核心/Gateway 自动测试、安装包 smoke、真实 Web 与官方 Desktop GUI 功能检查、Better Sidebar 0.28.0 兼容路由、原生保存逐字节比对、1/10 GiB 和 32/256 MiB 后端基准、1000 次后端切行；尚未完成跨平台及完整浏览器性能等验收。未验证条目保持原阶段清单，不能理解为全部打勾。

入口与说明：`README.md`；安装包：`artifacts/dsh-large-jsonl-viewer-0.1.1.tgz`；兼容性：`docs/compatibility.md`；结果与限制：`docs/validation.md`。0.1.1 补充插件图标和发布配置，查看器运行时代码与已验收的 0.1.0 保持一致。本实现只修改当前仓库，参考仓库作为只读资料使用。
