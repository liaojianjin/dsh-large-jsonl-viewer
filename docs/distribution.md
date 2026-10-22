# 分发与目录收录

插件的独立发布包位于 `packages/plugins/large-jsonl-viewer`，根目录是 private 开发工作区。从 npm 安装 `dsh-large-jsonl-viewer`，或使用 [GitHub Release v0.1.2](https://github.com/liaojianjin/dsh-large-jsonl-viewer/releases/tag/v0.1.2) 的预编译 tgz，不需要在用户机器执行构建脚本。Release 同时提供 SHA-256 校验文件，并与 npm 发布使用同一个 tgz。npm 包的 `repository` 指向本仓库，由目录自动探测 npm 映射，不在投稿 YAML 添加 `npm` 字段。

GitHub Packages 另提供带作用域的 `@liaojianjin/dsh-large-jsonl-viewer`，由 [发布工作流](github-packages.md) 单独构建、验证和发布。原 npm 包名保持不变。

## 目录条目

首次收录已通过 [awesome-dsh-plugin #8516](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/8516) 合并。本仓库的 [条目文件](registry/liaojianjin__dsh-large-jsonl-viewer--packages-plugins-large-jsonl-viewer.yml) 随版本准备最新固定 `tarball`；上游已有条目仍需通过目录仓库的版本更新 PR 同步，不会因本仓库发 Release 而自动替换固定 URL。提交时只更新该条目，不修改生成的 README。

- [awesome-dsh-plugin 贡献规则](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)允许 monorepo 子包。条目 URL 指向含 `dsh.bundle` 的插件子目录，使用 `docs` 分类，声明英文/中文功能描述及固定版本的 GitHub Release `tarball`。
- 插件子目录提供 `screenshots.json` 及两张真实 Desktop 截图；路径均在插件目录内。
- [dsh-market 的说明](https://github.com/dsh-market/dsh-market#contributing)明确它是市场应用，插件目录来自 awesome-dsh-plugin。条目合并后由市场同步，无需向 dsh-market 重复提交。

## 首次收录的年龄检查

GitHub API 返回本仓库创建时间为 **2026-10-20 23:35:23 Asia/Shanghai**（`2026-10-20T15:35:23Z`）。目录要求仓库创建至少一天，因此最早于 **2026-10-21 23:35:23 Asia/Shanghai** 提交。

首次提交在达到门槛后完成。后续版本更新仍核对 Release 下载、包清单、仓库 `dsh-plugin` topic 和上游贡献规则。
