# 分发与目录收录

插件的独立发布包位于 `packages/plugins/large-jsonl-viewer`，根目录是 private 开发工作区。从 npm 安装 `dsh-large-jsonl-viewer`，或使用 [GitHub Release v0.1.4](https://github.com/liaojianjin/dsh-large-jsonl-viewer/releases/tag/v0.1.4) 的预编译 tgz，不需要在用户机器执行构建脚本。Release 提供预编译 tgz 及 SHA-256 校验文件；维护者可将同一个 tgz 单独发布到 npm。npm 包的 `repository` 指向本仓库，由目录自动探测 npm 映射，不在投稿 YAML 添加 `npm` 字段。

GitHub Packages 另提供带作用域的 `@liaojianjin/dsh-large-jsonl-viewer`，由 [发布工作流](github-packages.md) 单独构建、验证和发布。原 npm 包名保持不变。

## 目录条目

**普通 npm 发版不需要每次提交目录 PR。** npm 映射及版本信息由上游自动采集；目录和市场优先使用已验证的 npm 安装来源。当前条目另外固定了 v0.1.2 的 Release 备用包，只有要让这个固定备用地址跟随新版本时，才需要更新那一行。

要减少此类更新，可在每个正式 Release 同时附加一个固定名的 `dsh-large-jsonl-viewer.tgz`，然后只提交一次目录 PR，将 `tarball` 改成：

```yaml
tarball: https://github.com/liaojianjin/dsh-large-jsonl-viewer/releases/latest/download/dsh-large-jsonl-viewer.tgz
```

后续版本只需在各自的新 Release 中上传同名资产，并将正确的正式版本设为 latest。仍保留带版本号的 tgz 和校验文件供固定安装；不要覆盖旧 Release 的资产。不能把 `latest/download/` 与带版本号的文件名组合，否则下一次发版就会失效。

上述固定名方案尚未发布资产或修改上游目录；当前有效的备用下载仍为下面已合并条目所指向的版本。规则见 [上游贡献指南](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)。

首次收录已通过 [awesome-dsh-plugin #8516](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/8516) 合并。本仓库的 [条目文件](registry/liaojianjin__dsh-large-jsonl-viewer--packages-plugins-large-jsonl-viewer.yml) 已准备 v0.1.4 的固定 `tarball`；上游固定备用包目前仍为 v0.1.2，本次发布未自动创建目录更新 PR。上游已有条目仍需通过目录仓库的版本更新 PR 同步，不会因本仓库发 Release 而自动替换固定 URL。提交时只更新该条目，不修改生成的 README。

- [awesome-dsh-plugin 贡献规则](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)允许 monorepo 子包。条目 URL 指向含 `dsh.bundle` 的插件子目录，使用 `docs` 分类，声明英文/中文功能描述及固定版本的 GitHub Release `tarball`。
- 插件子目录提供 `screenshots.json` 及两张真实 Desktop 截图；路径均在插件目录内。
- [dsh-market 的说明](https://github.com/dsh-market/dsh-market#contributing)明确它是市场应用，插件目录来自 awesome-dsh-plugin。条目合并后由市场同步，无需向 dsh-market 重复提交。

## 首次收录的年龄检查

GitHub API 返回本仓库创建时间为 **2026-10-20 23:35:23 Asia/Shanghai**（`2026-10-20T15:35:23Z`）。目录要求仓库创建至少一天，因此最早于 **2026-10-21 23:35:23 Asia/Shanghai** 提交。

首次提交在达到门槛后完成。后续版本更新仍核对 Release 下载、包清单、仓库 `dsh-plugin` topic 和上游贡献规则。
