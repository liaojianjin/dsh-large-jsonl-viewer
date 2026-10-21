# Compatibility and build notes

Implementation date: 2026-10-20 (Asia/Shanghai). The plugin targets Harness **0.2.1-rc.2**, Cordis **4.0.5**. Public DSH dependencies and the lockfile are pinned; other Harness releases are not claimed compatible.

## Confirmed

- Independent npm dependencies; no imports from the neighboring Harness or VS Code checkout in build artifacts.
- Host and Client compile as separate TypeScript programs against the **actual published declarations**.
- Strict Typert Host descriptors, input/result codecs, binary export encoding, Client declarations and namespace mounting are generated and exercised through the real Gateway.
- Real `fs-local` source admission; Session lookup, Peer ownership, source versions, byte-range reads and cancellation.
- ESM workers under Node 26.7 and installed Desktop's Electron Node 24.21.
- Packaged official Desktop 0.2.1-rc.2 (`332895e0`): GUI install, enable, uninstall/reinstall, ordinary and 32 MiB record previews, navigation, source rebuild and exact native Save export.
- Better Sidebar 0.28.0 stays enabled: an optional, more specific native JSONL/NDJSON tab route wins over its generic editor; `.txt` retains its editor. Reopen existing file tabs after installing to apply the new routing decision.
- Carrier restart was tested against the real Web profile: a new view resumed physical line 101 after Host restart. CLI removal followed by profile restart restored the native preview.
- A prebuilt tgz installed through `dsh plugin` into an isolated profile of the local Harness build (`687f282e`, 0.2.1-rc.2). The real Web UI displays ordinary and 32 MiB records.
- Monaco, editor worker, CSS, font assets and license texts are included. Client uses the host React / JSX runtime and Zod module table. No CDN or separate plugin server.

## Typert's tree-external build limitation

The pinned analyzer identifies decorator symbols and named lookup wire types through registered workspace packages. Directly analyzing only published npm dependencies produced no Remote methods, then failed on external lookup declarations. `scripts/build.mjs` creates an ignored, **build-only** declaration inventory under `packages/build-input/`:

1. It copies the installed protocol and Session declaration files without changing their contents, with narrow public barrels.
2. It extracts the exact `WorkspaceFileScope` interface and lookup declaration from the pinned published Workspace Files package.
3. The aggregate Host program uses those registered declaration inputs for the official `WorkspaceTypertGenerator`. The actual Host and Client compilation configs override these aliases and compile against published packages.
4. Generated `typert.host.*` / `typert.remote-client.*` come from the official emitter. Generated files are not maintained by hand.

The build fails when the pinned lookup declaration cannot be found. The inventory is not a runtime dependency, not shipped in tgz, and not part of the pnpm workspace. This is a version-specific build adaptation, not a claim that Harness currently provides a general external plugin build SDK.

## Client loading

esbuild produces a CommonJS module inside a `window.__ModuleLoader__.load({id,factory})` wrapper. A nested function isolates compiled identifiers from wrapper identifiers. React, React DOM and Zod stay external; stateless path/protocol helpers are private to the bundle. Monaco initialization is lazy. CSS is inserted through a plugin effect and removed during disposal; the editor worker is embedded as text and loaded through a Blob URL, which is revoked on unload.

The packaging smoke evaluates the factory and renders the registered component using SSR. This catches syntax and JSX-runtime errors before browser use. Real browser acceptance remains separate.

## Boundaries not yet verified

- Windows, Linux, Node 22.19 minimum, SSH or non-local backends.
- Streamed native saving of very large records and saving in every browser/carrier. Ordinary native Save was verified in Desktop; File System Access is used when available, otherwise Blob download is limited to 16 MiB.
- Browser end-to-end p95 and thousand-navigation browser memory. The committed stress report covers Host/worker reads only.
