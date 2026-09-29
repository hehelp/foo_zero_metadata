# foo_zero_metadata SDK

`foo_zero_metadata` 是 foobar2000 Zero 生态中的元数据与媒体资产服务组件。

**SDK 版本：**1.0.0 · **维护者：**klyrics.cn · Copyright (C) 2026 klyrics.cn  
[English](README.md)

本 SDK 通过 `foo_zero_bus` 对外提供统一的 Zero Bus 接口，支持多源搜索、身份解析、元数据聚合、用户偏好数据源选择、图片资产发现以及按需下载。

完整开发协议见：

[04-foo_zero_metadata_Zero_Bus协议_V1.0.md](docs/zero_bus_protocol.zh-CN.md)

## 1. 版本与运行条件

| 项目 | 当前值 |
|---|---|
| 组件版本 | `1.0.0` |
| 计划目标播放器 | Windows 上的 foobar2000 1.x/2.x；macOS 11+ 上的 2.x |
| 计划目标架构 | Windows x86/x64/ARM64EC；macOS arm64/x86_64 |
| v1.0.0 构建状态 | Windows x86、x64、ARM64EC 和 macOS Universal 均已构建；合并安装包和 SDK 压缩包已整理；宿主检查待完成 |
| 维护者 | `klyrics.cn` |
| 版权 | `Copyright (C) 2026 klyrics.cn` |
| Zero Bus 服务名 | `plugin.zero_metadata` |
| Zero Bus 版本 | `foo_zero_bus 0.1.1 / ABI v1` |
| 业务协议 | `schema_version: 1` |
| 默认 WebSocket | `ws://127.0.0.1:17890` |
| Node.js Demo | Node.js 24 或更高版本 |
| 编码 | UTF-8 |

运行前需要：

1. 已安装并运行 foobar2000。
2. 已安装 `foo_zero_bus`。
3. 已安装 `foo_zero_metadata`。
4. 客户端可以连接 Zero Bus WebSocket。
5. 使用 Last.fm 时，在 `Preferences → Tools → Zero Metadata → Last.fm` 配置 API Key。
6. 使用 Spotify 时，在 `Preferences → Tools → Zero Metadata → Spotify` 配置 Client ID 和 Client Secret。

Last.fm API Key 不通过 Zero Bus 传输，也不应写入示例代码、日志或仓库。

## 2. 协议模型

foo_zero_metadata 使用两层协议：

~~~text
Zero Bus 外层信封
    └── payload：UTF-8 JSON 字符串
            └── foo_zero_metadata 业务请求或事件
~~~

- 外层信封由 `foo_zero_bus` 负责路由和传输。
- 内层 JSON 由 `foo_zero_metadata` 负责解析。
- 外层 `payload` 始终是字符串，不能直接放 JSON 对象。
- SQLite 是内部实现细节，客户端不得直接访问。

### 2.1 服务名

请求的 `receiver` 必须为：

~~~text
plugin.zero_metadata
~~~

### 2.2 Zero Bus 消息类型

| `type` | 名称 | 方向 | 用途 |
|---:|---|---|---|
| `1` | `REQUEST` | 客户端 → 服务 | 业务请求 |
| `2` | `RESPONSE` | 服务 → 客户端 | 请求已接受的单次确认 |
| `4` | `NOTIFICATION` | 服务 → 客户端 | 任务完成、失败或资产事件 |
| `5` | `ERROR` | 服务 → 客户端 | 无法解析或无法入队 |
| `6` | `CANCEL` | 客户端 → 服务 | 取消总线层请求 |

### 2.3 外层信封

~~~json
{
  "sender": "client.demo",
  "receiver": "plugin.zero_metadata",
  "type": 1,
  "msg_id": "req-001",
  "correlation_id": "",
  "payload": "{\"schema_version\":1,\"operation\":\"metadata.search\",\"params\":{},\"options\":{}}"
}
~~~

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `sender` | string | 是 | 客户端标识，可为空字符串 |
| `receiver` | string | 是 | 固定为 `plugin.zero_metadata` |
| `type` | number | 是 | Zero Bus 消息类型 |
| `msg_id` | string | 是 | 当前消息唯一 ID |
| `correlation_id` | string | 否 | 关联已有消息；新请求通常为空 |
| `payload` | string | 是 | UTF-8 业务 JSON 字符串 |

客户端必须为每次请求生成唯一的 `msg_id`。

### 2.4 请求和异步任务

Zero Bus WebSocket 请求默认超时为 5 秒。耗时操作遵循以下规则：

1. 服务先发送一次 `type: 2` 的 `RESPONSE`。
2. `RESPONSE` 中的 `status: "accepted"` 只表示任务已入队。
3. 最终结果通过 `type: 4` 的通知事件发送。
4. 已返回 `accepted` 后，不会再次发送第二个 `RESPONSE`。
5. 协议无法解析、服务不可用或任务无法入队时，使用一次 `type: 5` 的 `ERROR`。

任务事件通过 payload 中的 `request_id` 与原始请求的 `msg_id` 关联。

## 3. 业务请求结构

外层 `payload` 反序列化后必须符合：

~~~json
{
  "schema_version": 1,
  "operation": "metadata.search",
  "params": {},
  "options": {}
}
~~~

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `schema_version` | number | 是 | 当前必须为 `1` |
| `operation` | string | 是 | 操作名称 |
| `params` | object | 视操作而定 | 操作输入 |
| `options` | object | 否 | 搜索、缓存和图片策略 |

约束：

- 未知版本返回 `UNSUPPORTED_SCHEMA_VERSION`。
- 未知操作返回 `UNSUPPORTED_OPERATION`。
- 字段类型错误返回 `INVALID_REQUEST`。
- 外层 payload 最大为 1 MiB。
- `artist.name`、`artist.mbid`、`album.title`、`album.mbid` 各自最多 512 字节。
- 请求中不得指定本地文件保存路径。
- 大型 Provider 原始响应不通过 Zero Bus 返回。

## 4. 接口总览

### 4.1 当前支持

| 操作 | 输入 | 输出 |
|---|---|---|
| `sources.list` | 无 | Provider 能力、启用状态、认证状态 |
| `preferences.get` | 无 | 当前数据源、搜索和图片偏好 |
| `preferences.set` | 偏好补丁 | 保存后的偏好 |
| `metadata.search` | 歌手、专辑、查询选项 | 聚合元数据、候选项和 Provider 状态 |
| `asset.ensure` | `asset_id` | 资产状态和本地路径 |
| `asset.cancel` | `params.task_id` | 取消本调用端的 `asset.ensure` 订阅 |
| `task.cancel` | `params.task_id` | 取消本调用端的任务订阅；无人订阅时中止执行 |

### 4.2 协议已定义但当前版本未实现

以下操作调用时返回 `UNSUPPORTED_OPERATION`：

| 操作 | 规划用途 |
|---|---|
| `metadata.get` | 按稳定身份获取元数据 |
| `metadata.refresh` | 按策略刷新元数据 |

尚未完成的 Zero Bus 请求可以使用 `type: 6` 的总线 `CANCEL` 消息。

相同的在途 `metadata.search`、`asset.ensure` 请求共享一次执行；每个调用端仍分别收到接受响应和完成通知。接受后，可由同一发送方调用 `task.cancel`，`params.task_id` 填目标任务的 ID。取消请求返回 `target_task_id` 与 `cancelled`；目标已经结束或不属于当前发送方时为 `false`。被取消的目标收到 `task.failed`、`status: "cancelled"` 和 `error.code: "CANCELLED"`，共享任务的其他调用端继续等待。搜索和资产任务执行 45 秒后会收到协作式中止信号；执行停止后，若已有可用元数据则返回部分结果，否则返回 `PROVIDER_TIMEOUT`。

`asset.cancel` 的请求格式与 `task.cancel` 相同，但只接受 `asset.ensure` 的任务 ID。

~~~json
{ "schema_version": 1, "operation": "task.cancel", "params": { "task_id": "task-17" } }
~~~

## 5. 通用响应和事件

### 5.1 接受响应

服务成功接收任务后返回一次 `type: 2`：

~~~json
{
  "sender": "plugin.zero_metadata",
  "receiver": "client.demo",
  "type": 2,
  "msg_id": "resp-001",
  "correlation_id": "req-001",
  "payload": "{\"schema_version\":1,\"status\":\"accepted\",\"request_id\":\"req-001\",\"task_id\":\"task-001\"}"
}
~~~

内层 payload：

~~~json
{
  "schema_version": 1,
  "status": "accepted",
  "request_id": "req-001",
  "task_id": "task-001"
}
~~~

### 5.2 完成事件

~~~json
{
  "schema_version": 1,
  "event": "task.completed",
  "request_id": "req-001",
  "task_id": "task-001",
  "status": "success",
  "result": {}
}
~~~

`status` 可能为：

~~~text
success
partial
failed
cancelled
~~~

### 5.3 失败事件

~~~json
{
  "schema_version": 1,
  "event": "task.failed",
  "request_id": "req-001",
  "task_id": "task-001",
  "status": "failed",
  "error": {
    "code": "PROVIDER_NETWORK_ERROR",
    "message": "provider request failed",
    "provider": "lastfm",
    "retryable": true,
    "retry_at": 1695579000
  }
}
~~~

业务错误位于 payload 的 `error` 对象中；传输层错误使用 Zero Bus `ERROR`。

单个 Provider 失败不一定导致整体失败。只要存在可用结果，任务可以以 `partial` 完成。

## 6. 接口详细说明

### 6.1 `sources.list`

列出已注册 Provider、能力、启用状态和认证状态。

#### 输入

~~~json
{
  "schema_version": 1,
  "operation": "sources.list",
  "params": {},
  "options": {}
}
~~~

#### 输出

`task.completed` 的 `result` 示例：

~~~json
{
  "sources": [
    {
      "provider_id": "musicbrainz",
      "display_name": "MusicBrainz",
      "enabled": true,
      "priority": 10,
      "capabilities": [
        "search_artist",
        "search_album",
        "resolve_artist",
        "resolve_album"
      ],
      "auth_status": "not_required"
    },
    {
      "provider_id": "lastfm",
      "display_name": "Last.fm",
      "enabled": true,
      "priority": 20,
      "capabilities": [
        "search_artist",
        "fetch_biography",
        "fetch_similar_artists"
      ],
      "auth_status": "configured"
    }
  ]
}
~~~

`auth_status` 可能为：

~~~text
not_required
missing_api_key
configured
expired
invalid
~~~

### 6.2 `preferences.get`

读取当前用户的数据源、搜索和图片偏好。

#### 输入

~~~json
{
  "schema_version": 1,
  "operation": "preferences.get",
  "params": {},
  "options": {}
}
~~~

#### 输出

~~~json
{
  "preferences": {
    "providers": {
      "musicbrainz": {
        "enabled": true,
        "priority": 10,
        "capabilities": {
          "identity": true,
          "metadata": true,
          "images": false
        }
      },
      "lastfm": {
        "enabled": true,
        "priority": 20,
        "capabilities": {
          "identity": true,
          "metadata": true,
          "images": false
        }
      }
    },
    "search": {
      "parallel": true,
      "allow_partial_result": true
    },
    "images": {
      "download_mode": "on_demand",
      "max_cache_size_mb": 1024
    }
  }
}
~~~

凭据、API Key 和 Shared Secret 不会出现在返回值中。

### 6.3 `preferences.set`

使用补丁方式更新偏好，只提交需要修改的字段。

#### 输入

~~~json
{
  "schema_version": 1,
  "operation": "preferences.set",
  "params": {
    "providers": {
      "lastfm": {
        "enabled": true,
        "priority": 20
      },
      "spotify": {
        "enabled": false
      }
    },
    "search": {
      "parallel": true,
      "allow_partial_result": true
    },
    "images": {
      "download_mode": "on_demand",
      "max_cache_size_mb": 1024
    }
  }
}
~~~

支持的字段：

| 路径 | 类型 | 说明 |
|---|---|---|
| `providers.<id>.enabled` | boolean | 是否允许调用 Provider |
| `providers.<id>.priority` | number | Provider 优先级 |
| `providers.<id>.capabilities.identity` | boolean | 是否用于身份解析 |
| `providers.<id>.capabilities.metadata` | boolean | 是否用于元数据 |
| `providers.<id>.capabilities.images` | boolean | 是否用于图片 |
| `search.parallel` | boolean | 是否并行搜索 |
| `search.allow_partial_result` | boolean | 是否接受部分结果 |
| `images.download_mode` | string | 当前支持 `on_demand` |
| `images.max_cache_size_mb` | integer | 图片缓存上限，64–16384 MiB；默认 1024 MiB |

#### 输出

成功保存后，`task.completed` 的 `result` 返回保存后的有效偏好：

~~~json
{
  "preferences": {
    "providers": {},
    "search": {
      "parallel": true,
      "allow_partial_result": true
    },
    "images": {
      "download_mode": "on_demand",
      "max_cache_size_mb": 1024
    }
  }
}
~~~

用户禁用的 Provider 不会被搜索计划调用。

### 6.4 `metadata.search`

根据输入和用户偏好搜索歌手、专辑，并聚合多个 Provider 的结果。

#### 输入

~~~json
{
  "schema_version": 1,
  "operation": "metadata.search",
  "params": {
    "artist": {
      "name": "Radiohead"
    },
    "album": {
      "title": "OK Computer"
    }
  },
  "options": {
    "provider_id": "lastfm",
    "search_mode": "preferred_sources",
    "image_mode": "none",
    "force_update": false
  }
}
~~~

`params` 支持：

~~~json
{
  "artist": {
    "name": "Radiohead",
    "mbid": "optional-musicbrainz-artist-mbid"
  },
  "album": {
    "title": "OK Computer",
    "mbid": "optional-musicbrainz-release-group-mbid"
  }
}
~~~

规则：

- `artist.name` 和 `artist.mbid` 至少提供一个时，可以搜索歌手。
- `album.title` 和 `album.mbid` 至少提供一个时，可以搜索专辑。
- `artist` 和 `album` 可以只提供其中一项。
- 同时提供稳定 ID 和名称时，稳定 ID 优先；`album.mbid` 是 MusicBrainz 发行组 ID。
- 不得传入本地文件路径。

`options` 字段：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `provider_id` | string | 未指定 | 限定单个 Provider；省略则按偏好选择多个 |
| `search_mode` | string | `preferred_sources` | 当前支持 `preferred_sources` |
| `image_mode` | string | `discover` | `none`、`discover` 或 `ensure_local` |
| `force_update` | boolean | `false` | 跳过仍有效的元数据缓存和已保存的身份映射 |
| `cache_mode` | string | `default` | `refresh` 跳过聚合缓存，但保留有效的单源缓存和身份映射 |
| `confirm_identity` | boolean | `false` | 验证并保存用户选中的 MusicBrainz 身份 |

图片模式：

| 值 | 行为 |
|---|---|
| `none` | 不发现或下载图片 |
| `discover` | 返回图片资产描述和 URL，不主动下载 |
| `ensure_local` | 发现图片并提交本地下载任务 |

#### 输出

`task.completed` 的 `result` 示例：

~~~json
{
  "artist": {
    "name": "Radiohead",
    "mbid": "...",
    "biography": {"text": "...", "source": "lastfm"},
    "source": "musicbrainz",
    "sources": ["musicbrainz", "lastfm"],
    "images": []
  },
  "album": null,
  "candidates": {
    "artists": [],
    "albums": []
  },
  "providers": {
    "musicbrainz": {
      "status": "success"
    },
    "lastfm": {
      "status": "success"
    }
  },
  "field_sources": {
    "artist": {
      "name": "musicbrainz",
      "mbid": "musicbrainz",
      "biography": "lastfm"
    },
    "album": {}
  },
  "field_contributors": {
    "artist": {
      "name": ["musicbrainz"],
      "mbid": ["musicbrainz"],
      "biography": ["lastfm"]
    },
    "album": {}
  },
  "match_status": "resolved",
  "cached": false,
  "cache": {
    "metadata": "fresh",
    "images": "none"
  }
}
~~~

`cached` 是结果顶层的布尔值：本次结果使用了聚合缓存或任一 Provider 缓存数据时为 `true`，全部由 Provider 实时查询生成时为 `false`。过期聚合缓存返回的旧结果也为 `true`；后续 `metadata.refreshed` 事件会根据刷新结果单独设置该值。

`match_status` 可能为：

~~~text
resolved
ambiguous
not_found
partial
~~~

省略 `provider_id` 时，组件根据 Provider 启用状态、认证状态、能力、用户优先级、并行策略和部分结果策略规划查询。

聚合缓存过期时，服务立即返回 `task.completed`、`status: "partial"` 与 `result.cache.metadata: "stale"`。当 `result.cache.refresh_pending` 为 `true` 时，调用端应继续按同一 `request_id` 和 `task_id` 等待 `metadata.refreshed`：刷新成功时包含新 `result`，失败时包含 `error`。为 `false` 时，`cache.retry_at` 表示下次可刷新时间。相同后台刷新只执行一次，失败后等待 60 秒再重试。各 Provider 缓存有独立过期时间；单源失败时可使用该源旧数据，同时在 Provider 状态中报告 `failed` 和 `retry_at`。详见 [SQLite 缓存策略](docs/cache_policy.zh-CN.md)。命令行 Demo 在首次 `task.completed` 后退出，不展示后续刷新通知。

`field_sources` 对标量字段记录最终采用的 Provider；合并字段有多个来源时为 `multiple`。`field_contributors` 列出实际来源。稳定 ID 和规范名称优先采用 MusicBrainz，传记优先采用 Last.fm；标签与图片按 Provider 优先级合并。完整规则见 [字段合并规则](docs/field_merge.zh-CN.md)。

#### 确认候选身份

当 `match_status` 为 `ambiguous`，向用户展示 `candidates.artists` 或 `candidates.albums`。候选项包含 `mbid`、`score`；专辑候选还包含 `artists` 和 `first_release_date`。用户选定后，使用原始名称、所选 ID 再次调用 `metadata.search`：

~~~json
{
  "schema_version": 1,
  "operation": "metadata.search",
  "params": {
    "artist": { "name": "Radiohead", "mbid": "<所选艺人 MBID>" },
    "album": { "title": "OK Computer", "mbid": "<所选发行组 MBID>" }
  },
  "options": { "confirm_identity": true, "image_mode": "none" }
}
~~~

组件会向 MusicBrainz 重新验证 ID，成功写入映射后才在 `result.identity_confirmation` 返回 `artist: "saved"` 和/或 `album: "saved"`。MusicBrainz 必须启用，`provider_id` 应省略或设为 `musicbrainz`。确认专辑需要艺人身份；同时确认艺人和专辑时应提交两个选中的 ID。ID 不匹配时返回 `IDENTITY_NOT_FOUND`，艺人身份未解析时返回 `IDENTITY_AMBIGUOUS`。后续按名称普通搜索会使用保存的艺人映射，以及以该艺人为范围的专辑映射。确认请求会跳过查询缓存。

### 6.5 `asset.ensure`

确保已经发现的图片资产下载到本地缓存目录。

#### 输入

~~~json
{
  "schema_version": 1,
  "operation": "asset.ensure",
  "params": {
    "asset_id": "<metadata.search 返回的 64 位 asset_id>"
  },
  "options": {}
}
~~~

#### 输出

~~~json
{
  "asset": {
    "asset_id": "<64 位 asset_id>",
    "provider": "coverartarchive",
    "provider_asset_id": "<发行组 MBID>",
    "entity_type": "album",
    "entity_id": "<发行组 MBID>",
    "variant": "500",
    "role": "album_cover",
    "state": "ready",
    "local_path": "<Profile 绝对路径>/foo_zero_metadata/images/v1/ab/cd/<asset_id>.jpg",
    "mime_type": "image/jpeg",
    "width": 500,
    "height": 500
  }
}
~~~

如果资产已经存在且文件有效，组件直接返回现有本地路径，不会重复下载。

## 7. 图片资产事件

当 `metadata.search` 使用 `image_mode: "ensure_local"`，或调用 `asset.ensure` 时，图片完成后会发送 `asset.ready` 通知。

~~~json
{
  "schema_version": 1,
  "event": "asset.ready",
  "request_id": "req-001",
  "task_id": "task-001",
  "asset_id": "<64 位 asset_id>",
  "entity_type": "artist",
  "entity_id": "artist-001",
  "role": "artist_avatar",
  "local_path": "<Profile 绝对路径>/foo_zero_metadata/images/v1/ab/cd/<asset_id>.jpg"
}
~~~

客户端可以在收到 `asset.ready` 后只刷新对应图片，不需要重新请求全部元数据。

图片状态可能为：

~~~text
discovered
queued
downloading
ready
failed
expired
missing
cancelled
~~~

本地路径由组件生成。客户端不得自行拼接或指定图片缓存文件名。

## 8. 数据源和用户偏好

### 8.1 数据源选择

用户可以在 foobar2000 偏好页选择：

- 是否启用某个 Provider。
- Provider 优先级。
- 是否用于身份匹配。
- 是否用于元数据。
- 是否用于图片。
- 是否允许部分结果。
- 是否允许按需下载图片。

用户禁用的数据源不会被后台静默调用。

### 8.2 当前数据源示例

| Provider | 典型用途 | 认证 |
|---|---|---|
| MusicBrainz | Artist/Album 身份和基础信息 | 通常不需要用户 API Key |
| Last.fm | 歌手传记、相似艺术家 | 需要 API Key |
| Spotify | 歌手图片、专辑封面等视觉资产 | 按 Provider 配置要求认证 |

Provider 是可扩展的。后续新增数据源不应改变客户端的 Zero Bus 请求结构，客户端通过 `sources.list` 获取其能力。

### 8.3 Last.fm 配置

Last.fm API Key 可以在以下位置配置：

~~~text
Preferences → Tools → Zero Metadata → Last.fm
~~~

也可以通过环境变量提供：

~~~text
FOO_ZERO_METADATA_LASTFM_API_KEY
~~~

偏好页配置优先于环境变量。展示 Last.fm 返回的内容时，应保留 Last.fm 的署名和链接信息。

## 9. 错误处理

### 9.1 业务错误结构

~~~json
{
  "error": {
    "code": "PROVIDER_RATE_LIMITED",
    "message": "provider request is temporarily limited",
    "provider": "lastfm",
    "retryable": true,
    "retry_at": 1695579000
  }
}
~~~

### 9.2 常见错误码

| 错误码 | 说明 |
|---|---|
| `INVALID_REQUEST` | 请求字段或类型错误 |
| `UNSUPPORTED_SCHEMA_VERSION` | 不支持的业务协议版本 |
| `UNSUPPORTED_OPERATION` | 当前版本未实现该操作 |
| `NO_PROVIDER_ENABLED` | 没有可用数据源 |
| `PROVIDER_AUTH_REQUIRED` | Provider 尚未配置认证信息 |
| `PROVIDER_RATE_LIMITED` | Provider 触发访问限制 |
| `PROVIDER_NETWORK_ERROR` | Provider 网络请求失败 |
| `PROVIDER_TIMEOUT` | 搜索或资产任务执行超时，且没有可用的部分结果 |
| `PROVIDER_PARSE_ERROR` | Provider 返回数据无法解析 |
| `IDENTITY_AMBIGUOUS` | 存在多个匹配候选 |
| `IDENTITY_NOT_FOUND` | 没有匹配实体 |
| `IMAGE_TOO_LARGE` | 图片超过大小限制 |
| `IMAGE_INVALID_FORMAT` | 返回内容不是有效图片 |
| `IMAGE_DOWNLOAD_FAILED` | 图片下载失败 |
| `STORAGE_ERROR` | 本地缓存或数据库错误 |
| `CANCELLED` | 任务已取消 |

### 9.3 传输错误与业务错误

| 情况 | 返回方式 |
|---|---|
| JSON 无法解析 | Zero Bus `ERROR` |
| 服务名错误 | Zero Bus `ERROR` |
| 任务无法入队 | Zero Bus `ERROR` |
| Provider 超时 | `task.failed` 或 `task.completed` 的 `partial` |
| 图片下载失败 | 任务结果记录失败，或返回 `partial` |
| 已接受任务的业务失败 | `task.failed` 通知 |

## 10. Node.js Demo

### 10.1 命令行 Demo

仓库中的 Demo 路径：

~~~text
github/sdk/demo.mjs
~~~

使用默认参数查询：

~~~sh
node github/sdk/demo.mjs
~~~

查询指定歌手和专辑：

~~~sh
node github/sdk/demo.mjs \
  --artist "Radiohead" \
  --album "OK Computer"
~~~

限制使用 Last.fm：

~~~sh
node github/sdk/demo.mjs \
  --artist "Radiohead" \
  --album "OK Computer" \
  --provider lastfm
~~~

只列出数据源：

~~~sh
node github/sdk/demo.mjs --sources-only
~~~

使用中文输出：

~~~sh
node github/sdk/demo.mjs --lang zh-CN --sources-only
~~~

命令行参数：

| 参数 | 说明 |
|---|---|
| `--url` | Zero Bus WebSocket 地址 |
| `--artist` | 歌手名称 |
| `--artist-mbid` | 所选艺人的 MusicBrainz ID |
| `--album` | 专辑名称 |
| `--album-mbid` | 所选专辑发行组的 MusicBrainz ID |
| `--confirm-identity` | 验证并保存所选身份映射 |
| `--provider` | 限定 Provider |
| `--image-mode` | `none`、`discover` 或 `ensure_local` |
| `--force-update` | 跳过有效元数据缓存 |
| `--sources-only` | 只查询数据源状态 |
| `--lang zh-CN` | 使用简体中文输出 |

普通查询默认使用 `image_mode: "none"`，不会因查询元数据而下载图片。

### 10.2 最小 Node.js 调用示例

以下示例只依赖 Node.js 24 的全局 `WebSocket` API：

~~~js
const url = "ws://127.0.0.1:17890";
const requestId = "demo-" + Date.now();

const task = {
  schema_version: 1,
  operation: "metadata.search",
  params: {
    artist: { name: "Radiohead" },
    album: { title: "OK Computer" }
  },
  options: {
    search_mode: "preferred_sources",
    image_mode: "none",
    force_update: false
  }
};

const ws = new WebSocket(url);

ws.addEventListener("open", () => {
  ws.send(JSON.stringify({
    sender: "node.demo",
    receiver: "plugin.zero_metadata",
    type: 1,
    msg_id: requestId,
    correlation_id: "",
    payload: JSON.stringify(task)
  }));
});

ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);

  if (message.type === 2) {
    const accepted = JSON.parse(message.payload);
    console.log("任务已接受：", accepted.task_id);
    return;
  }

  if (message.type === 4) {
    const eventPayload = JSON.parse(message.payload);

    if (eventPayload.event === "asset.ready") {
      console.log("图片已就绪：", eventPayload.local_path);
      return;
    }

    if (eventPayload.event === "task.completed") {
      console.dir(eventPayload.result, { depth: null });
      if (eventPayload.result?.cache?.refresh_pending !== true) ws.close();
      return;
    }

    if (eventPayload.event === "metadata.refreshed") {
      if (eventPayload.result) console.dir(eventPayload.result, { depth: null });
      else console.error("刷新失败：", eventPayload.error);
      ws.close();
      return;
    }

    if (eventPayload.event === "task.failed") {
      console.error("任务失败：", eventPayload.error);
      ws.close();
    }
    return;
  }

  if (message.type === 5) {
    console.error("Zero Bus 错误：", message.payload);
    ws.close();
  }
});

ws.addEventListener("error", (error) => {
  console.error("WebSocket 错误：", error);
});
~~~

### 10.3 调用时序

~~~text
WebSocket open
    ↓
发送 type: 1 REQUEST
    ↓
收到 type: 2 RESPONSE / accepted
    ↓
等待 type: 4 NOTIFICATION
    ├── asset.ready
    ├── task.completed 或 task.failed
    └── metadata.refreshed（过期快照之后）
~~~

客户端不能在收到 `accepted` 后立即认为查询已经完成。

## 11. 客户端集成建议

1. 每个请求使用唯一 `msg_id`。
2. 保存 `msg_id → task_id` 的关联关系。
3. 通过业务事件中的 `request_id` 过滤其他任务的通知。
4. 正确处理 `success`、`partial`、`failed` 和 `cancelled`。
5. 不要假设所有 Provider 都会成功。
6. 不要假设 `artist` 和 `album` 一定同时存在。
7. 处理 `ambiguous` 候选结果。
8. 收到 `asset.ready` 后只刷新对应 UI 资源。
9. 不要向请求中传入本地图片路径。
10. 不要依赖 SQLite 表名或本地缓存目录结构。

可运行的浏览器 UI 示例见 [`examples/zero_ui_panel/index.html`](examples/zero_ui_panel/index.html)。SMP 示例 [`examples/smp/metadata-panel.js`](examples/smp/metadata-panel.js) 通过现有 SMP WebSocket 桥接和标准 Zero Bus WebSocket 信封通信；启用方式和调用说明见该目录 README。
11. 不要把 API Key、Token 或 Shared Secret 放进 Zero Bus payload。
12. 对响应中的未知字段保持兼容。

## 12. 协议兼容与版本升级

当前业务协议版本：

~~~text
schema_version = 1
~~~

版本 1 允许增加可选字段；客户端应忽略无法识别的可选字段。删除字段、改名或改变已有字段语义属于破坏性变化，需要提升 `schema_version`。

Zero Bus 自身的 ABI/传输版本与业务 `schema_version` 独立管理。客户端应同时检查：

1. Zero Bus 传输层错误。
2. 业务 payload 的 `schema_version`。
3. 业务事件的 `status`。
4. 业务错误的 `error.code`。

## 13. 目录与相关文档

~~~text
foo_zero_metadata/
├── README.zh-CN.md
├── README.md
├── github/
│   └── sdk/
│       ├── demo.mjs
│       ├── test.html
│       └── examples/
│           ├── zero_ui_panel/
│           └── smp/
└── docs/
    └── 04-foo_zero_metadata_Zero_Bus协议_V1.0.md
~~~

相关文档：

- [Zero Bus 协议 V1.0](docs/zero_bus_protocol.zh-CN.md)
- [English README](./README.md)
