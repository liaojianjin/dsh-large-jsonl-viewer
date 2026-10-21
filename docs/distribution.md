# 分发与目录收录

插件的独立发布包位于 `packages/plugins/large-jsonl-viewer`，根目录是 private 开发工作区。从 npm 安装 `dsh-large-jsonl-viewer`，或使用 [GitHub Release v0.1.1](https://github.com/liaojianjin/dsh-large-jsonl-viewer/releases/tag/v0.1.1) 的预编译 tgz，不需要在用户机器执行构建脚本。Release 同时提供 SHA-256 校验文件。npm 包的 `repository` 指向本仓库，由目录自动探测 npm 映射，不在投稿 YAML 添加 `npm` 字段。

## 已准备的条目

待提交文件：[liaojianjin__dsh-large-jsonl-viewer--packages-plugins-large-jsonl-viewer.yml](registry/liaojianjin__dsh-large-jsonl-viewer--packages-plugins-large-jsonl-viewer.yml)。提交时只将该文件放入目标仓库的 `data/plugins/`，不修改生成的 README。

- [awesome-dsh-plugin 贡献规则](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)允许 monorepo 子包。条目 URL 指向含 `dsh.bundle` 的插件子目录，使用 `docs` 分类，声明英文/中文功能描述及固定版本的 GitHub Release `tarball`。
- 插件子目录提供 `screenshots.json` 及两张真实 Desktop 截图；路径均在插件目录内。
- [dsh-market 的说明](https://github.com/dsh-market/dsh-market#contributing)明确它是市场应用，插件目录来自 awesome-dsh-plugin。条目合并后由市场同步，无需向 dsh-market 重复提交。

## 仓库年龄门槛

GitHub API 返回本仓库创建时间为 **2026-10-20 23:35:23 Asia/Shanghai**（`2026-10-20T15:35:23Z`）。目录要求仓库创建至少一天，因此最早于 **2026-10-21 23:35:23 Asia/Shanghai** 提交。

条目先准备，达到时间后再提交。提交前重新确认 Release 下载、包清单、仓库 `dsh-plugin` topic 和上游贡献规则；不绕过年龄检查。收录仍需维护者审核，本文件不代表已被收录。
