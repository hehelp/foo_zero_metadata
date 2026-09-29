# foo_zero_metadata

**English** · [简体中文](README_zh.md)

`foo_zero_metadata` is a metadata discovery and aggregation component for foobar2000. It connects to the player ecosystem through [Zero Bus](https://github.com/hehelp/foo_zero_bus) and exposes a local WebSocket API for panels, scripts, and other components.

This GitHub project is for **compiled component installers and the public SDK only**. It does not distribute the component's source code. The single `.fb2k-component` installer contains the Windows x86, x64, ARM64EC and macOS universal (arm64 + x86_64) builds.

## What it does

- Searches and combines metadata from MusicBrainz, Last.fm, and Spotify.
- Resolves artist and album identities before merging source results.
- Applies field-level merge rules and returns source attribution with the data.
- Caches metadata in SQLite and supports stale-cache responses while refreshing data.
- Discovers cover art and downloads selected image assets on demand.
- Runs network and storage work asynchronously through Zero Bus.

## Compatibility and v1.0.0 build status

| Target | Intended support |
|---|---|
| Windows | foobar2000 1.x/2.x; x86, x64, ARM64EC |
| macOS | foobar2000 2.x on macOS 11+; arm64 and x86_64 |

All target binaries have been built, and the combined v1.0.0 `.fb2k-component` and SDK archive are prepared under `dist/`. Installation and runtime checks in the target foobar2000 hosts are still pending.

## Install

1. Install and start [Zero Bus](https://github.com/hehelp/foo_zero_bus).
2. Download `foo_zero_metadata-1.0.0.fb2k-component` from this project's GitHub Releases when the all-platform package is available.
3. In foobar2000, open **File → Preferences → Components → Install**, select the package, and restart the player.
4. Open **Preferences → Tools → Zero Metadata** to configure the providers you use.

The installer is a foobar2000 component archive. It places platform-specific binaries in the standard package layout; do not extract it and copy a binary from a different architecture into the player manually.

## Configure data providers

- **MusicBrainz** is available without an API key and is used for identity matching and metadata.
- **Last.fm** requires an API key. Add it in the Last.fm page under **Preferences → Tools → Zero Metadata** and use **Verify** to check it.
- **Spotify** requires a Client ID and Client Secret from Spotify's developer dashboard. Configure them in the Spotify page. Spotify results and artwork must retain the attribution and link required by Spotify's terms.
- Choose and order active providers in the component's data-source preferences.

Credentials are stored by the component's settings system. Do not put API credentials in SDK samples, issue reports, or logs.

## SDK and examples

The [`sdk/`](sdk/README.md) directory contains the API reference, a Node.js demo, a WebSocket test page, and runnable panel examples. The SDK README is in English by default; [简体中文 SDK 文档](sdk/README.zh-CN.md) is also available.

- [WebSocket test page](sdk/test.html)
- [Node.js demo](sdk/demo.mjs)
- [zero_ui_panel example](sdk/examples/zero_ui_panel/index.html)
- [SMP WebSocket example](sdk/examples/smp/README.zh-CN.md)

The default Zero Bus WebSocket endpoint is `ws://127.0.0.1:17890`. The port can be changed in **Preferences → Tools → Zero Bus**. Requests use the Zero Bus envelope and carry the `foo_zero_metadata` request as a JSON string in `payload`.

## License and release contents

See [Zero Bus protocol and API documentation](sdk/README.md) for operation names, parameters, return values, events, cache behavior, and error codes. GitHub Release assets are prepared under `dist/` and contain the combined `.fb2k-component`, SDK archive, and bilingual release notes. No source files are part of the public GitHub staging directory.

Copyright (C) 2026 klyrics.cn
