# 分发与目录收录

插件的独立发布包位于 `packages/plugins/large-jsonl-viewer`，根目录是 private 开发工作区。从 npm 安装 `dsh-large-jsonl-viewer`，或使用 [GitHub Release v0.1.4](https://github.com/liaojianjin/dsh-large-jsonl-viewer/releases/tag/v0.1.4) 的预编译 tgz，不需要在用户机器执行构建脚本。Release 提供预编译 tgz 及 SHA-256 校验文件；维护者可将同一个 tgz 单独发布到 npm。npm 包的 `repository` 指向本仓库，由目录自动探测 npm 映射，不在投稿 YAML 添加 `npm` 字段。

GitHub Packages 另提供带作用域的 `@liaojianjin/dsh-large-jsonl-viewer`，由 [发布工作流](github-packages.md) 单独构建、验证和发布。原 npm 包名保持不变。

## 目录条目

**普通 npm 发版不需要每次提交目录 PR。** npm 映射及版本信息由上游自动采集；目录和市场优先使用已验证的 npm 安装来源。GitHub Release 另提供固定文件名的备用安装包：

```yaml
tarball: https://github.com/liaojianjin/dsh-large-jsonl-viewer/releases/latest/download/dsh-large-jsonl-viewer.tgz
```

`latest/download/` 只替换 Release 标签，不会改写文件名。每个正式 Release 都需要实际包含 `dsh-large-jsonl-viewer.tgz`；它与同一 Release 的带版本号安装包逐字节一致。带版本号的安装包和原校验文件继续保留。

## 固定名安装包的自动发布

[Publish Release download alias](../.github/workflows/publish-release-alias.yml) 在正式 Release 发布后自动执行，不调用 npm、不重新构建安装包：

1. 从该 Release 下载带版本号的 tgz 和 `SHA256SUMS.txt`。
2. 核对 SHA-256、包名、包版本与 Release 标签及 `dsh.bundle`。
3. 将同一份字节以固定名上传，再下载固定名包核对内容。
4. 已有相同内容时重跑不会再次上传；已有不同内容时失败，不覆盖既有资产。草稿 / 预发布版不会作为最新正式版处理。

发布 Release 时应同时上传带版本号的安装包与校验文件，然后等待此工作流成功。既有正式 Release 可从 Actions 页选择 **Publish Release download alias → Run workflow**，使用 main 分支，填写 `tag`（例如 `v0.1.4`）补齐；这也是上传失败后重跑的入口。手动执行不会修改 latest 的选择。

仅此 job 具有 `contents: write`，使用仓库自带的 `GITHUB_TOKEN`，不需要额外长期凭据。发布脚本位于 [publish-release-alias.mjs](../scripts/publish-release-alias.mjs)，本地验证：`node --test tests/release-alias.test.mjs`。

## 上游收录

首次收录已通过 [awesome-dsh-plugin #8516](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/8516) 合并。[本仓库条目](registry/liaojianjin__dsh-large-jsonl-viewer--packages-plugins-large-jsonl-viewer.yml) 使用固定名 latest 地址，兼容说明为 `DSH >=0.2.1-rc.2`；上游通过一次条目更新 PR 切换，之后单纯发新版无需修改 tarball 行。简介、分类或仓库地址变化时仍需更新对应条目，不修改生成的 README。

规则见 [上游贡献指南](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)。

- [awesome-dsh-plugin 贡献规则](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)允许 monorepo 子包。条目 URL 指向含 `dsh.bundle` 的插件子目录，使用 `docs` 分类，声明英文/中文功能描述及可跟随最新正式版的 GitHub Release `tarball`。
- 插件子目录提供 `screenshots.json` 及两张真实 Desktop 截图；路径均在插件目录内。
- [dsh-market 的说明](https://github.com/dsh-market/dsh-market#contributing)明确它是市场应用，插件目录来自 awesome-dsh-plugin。条目合并后由市场同步，无需向 dsh-market 重复提交。

## 首次收录的年龄检查

GitHub API 返回本仓库创建时间为 **2026-10-20 23:35:23 Asia/Shanghai**（`2026-10-20T15:35:23Z`）。目录要求仓库创建至少一天，因此最早于 **2026-10-21 23:35:23 Asia/Shanghai** 提交。

首次提交在达到门槛后完成。后续版本更新仍核对 Release 下载、包清单、仓库 `dsh-plugin` topic 和上游贡献规则。
