[English](README.md) · **简体中文**

# foo_zero_metadata

`foo_zero_metadata` 是一款用于 foobar2000 的元数据发现与聚合组件。它通过 [Zero Bus](https://github.com/hehelp/foo_zero_bus) 接入播放器生态，并为面板、脚本及其他组件提供本机 WebSocket API。

本 GitHub 项目**只托管编译后的组件安装包和对外 SDK**，不托管组件源码。单个 `.fb2k-component` 安装包包含 Windows x86、x64、ARM64EC 和 macOS Universal（arm64 + x86_64）版本。

## 功能

- 聚合 MusicBrainz、Last.fm 与 Spotify 的搜索和元数据。
- 解析艺人与专辑身份，再合并多个来源的结果。
- 按字段执行合并，并随结果返回来源信息。
- 使用 SQLite 缓存元数据；缓存过期后可先返回旧数据并在后台刷新。
- 发现封面图片，并按请求下载图片资产。
- 通过 Zero Bus 异步处理网络与存储工作。

## 兼容范围与 v1.0.0 构建状态

| 目标 | 计划支持 |
|---|---|
| Windows | foobar2000 1.x/2.x；x86、x64、ARM64EC |
| macOS | macOS 11+ 上的 foobar2000 2.x；arm64、x86_64 |

所有目标架构均已构建，v1.0.0 合并安装包 `.fb2k-component` 和 SDK 压缩包已整理在 `dist/`。仍需在目标 foobar2000 宿主中完成安装及运行检查。

## 安装

1. 安装并启动 [Zero Bus](https://github.com/hehelp/foo_zero_bus)。
2. 完成全平台安装包后，从本项目 GitHub Releases 下载 `foo_zero_metadata-1.0.0.fb2k-component`。
3. 在 foobar2000 中打开 **文件 → 首选项 → 组件 → 安装**，选择安装包并重启播放器。
4. 打开 **首选项 → 工具 → Zero Metadata** 配置所需数据源。

安装文件是 foobar2000 组件归档，按标准目录结构收录各平台二进制。不要将其他架构的二进制解压后手工复制到播放器中。

## 配置数据源

- **MusicBrainz** 无需 API Key，可用于身份匹配和元数据查询。
- **Last.fm** 需要 API Key。在 **首选项 → 工具 → Zero Metadata → Last.fm** 配置后，可点击 **验证** 检查密钥。
- **Spotify** 需要从 Spotify Developer Dashboard 获取 Client ID 和 Client Secret，并在 Spotify 配置页填写。使用 Spotify 结果和图片时应保留 Spotify 要求的署名和回链。
- 可在数据源偏好页选择启用的数据源并调整顺序。

凭据由组件的设置系统保存。请勿将 API 凭据放入 SDK 示例、问题报告或日志中。

## SDK 与示例

[`sdk/`](sdk/README.md) 包含 API 参考、Node.js Demo、WebSocket 测试页和可运行的面板示例。SDK 默认英文，同时提供[简体中文文档](sdk/README.zh-CN.md)。

- [WebSocket 测试页](sdk/test.html)
- [Node.js Demo](sdk/demo.mjs)
- [zero_ui_panel 示例](sdk/examples/zero_ui_panel/index.html)
- [SMP WebSocket 示例](sdk/examples/smp/README.zh-CN.md)

Zero Bus 默认 WebSocket 地址为 `ws://127.0.0.1:17890`，可在 **首选项 → 工具 → Zero Bus** 修改端口。请求遵循 Zero Bus 信封协议，并将 `foo_zero_metadata` 业务请求作为 JSON 字符串放入 `payload`。

## SDK 内容与发布

接口操作名、参数、返回值、事件、缓存行为和错误码见 [Zero Bus 协议及 API 文档](sdk/README.zh-CN.md)。GitHub Release 文件预先整理在 `dist/`，包含合并架构的 `.fb2k-component`、SDK 压缩包和中英文发布说明。GitHub 发布目录不包含项目源码。

Copyright (C) 2026 klyrics.cn
