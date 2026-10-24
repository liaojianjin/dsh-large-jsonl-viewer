# GitHub Packages distribution

The primary npm package remains **`dsh-large-jsonl-viewer`** on npmjs.org. GitHub Packages provides the same plugin as **`@liaojianjin/dsh-large-jsonl-viewer`** on `https://npm.pkg.github.com`. Choose one distribution per Harness profile.

## How publication works

The **Publish GitHub Packages** workflow runs manually, when a GitHub Release is published, or when its workflow file is pushed to `main` (the initial publication). A Release tag must match `v<package version>`.

1. The build job installs the frozen lockfile, builds and tests the normal npm identity.
2. `scripts/pack-github.mjs` copies source and build configuration into a disposable workspace. Only that workspace receives the scoped package name, GitHub registry and scoped bundle reference. Typert protocols and the Client factory are regenerated with the scoped identity, followed by core, real Gateway/worker and package checks. The original plugin manifest and patch are checked unchanged.
3. A separate publish job receives the verified tgz and checks its SHA-256. Only this job has `packages: write` and exposes `GITHUB_TOKEN` to npm.
4. Publication is restricted to `npm.pkg.github.com`. The staged manifest's `repository` points to this repository, which links the package when it is published. The registry's returned name, version, repository and integrity are verified. Re-running an identical release is a no-op; an existing version with different bytes fails instead of being overwritten.

The workflow never publishes to npmjs.org and does not change the existing npm package's name or publishing destination. It requires no additional long-lived PAT secret.

## Install the GitHub distribution

GitHub requires authentication even for public npm packages. Authenticate locally with a classic PAT that has `read:packages`; enter it in the npm prompt rather than committing it:

```sh
npm login --scope=@liaojianjin --registry=https://npm.pkg.github.com --auth-type=legacy
```

Map only this scope in the npm configuration used by your Harness profile:

```ini
@liaojianjin:registry=https://npm.pkg.github.com
```

Then install into the intended profile:

```sh
dsh plugin --profile web add @liaojianjin/dsh-large-jsonl-viewer@0.1.3
```

Desktop's profile is separate from the CLI Web profile. The usual npmjs.org installation remains:

```sh
dsh plugin --profile web add dsh-large-jsonl-viewer
```

References: [GitHub npm registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry), [publishing with Actions](https://docs.github.com/en/packages/managing-github-packages-using-github-actions-workflows/publishing-and-installing-a-package-with-github-actions).

## 中文说明

GitHub Packages 是额外分发渠道，现有 npm 包 `dsh-large-jsonl-viewer` 保持不变。scoped 包在临时工作区单独构建，重新生成对应包名的协议和 Client 模块，并运行相同测试。同一 profile 选择其中一种安装来源。

工作流使用仓库自带的 `GITHUB_TOKEN`，发布权限仅授予发布 job；npm 令牌、用户本机 `.npmrc` 和 Desktop profile 不会写入仓库。发布后通过制品校验和及 registry 返回的元数据核验版本与关联仓库。已有版本不会被覆盖。

从 GitHub npm registry 安装需要认证和 scope 配置，命令见上文。一般用户仍可直接使用 npmjs.org 的包名安装。
