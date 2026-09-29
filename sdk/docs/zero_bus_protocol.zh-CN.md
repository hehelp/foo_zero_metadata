# foo_zero_metadata Zero Bus 协议 V1.0

**状态**：实施基线  
**适用总线**：foo_zero_bus 0.1.1 / ABI v1  
**依据**：产品设计 V1.2 第 9 节及本机 Zero Bus SDK 文档

## 1. 与产品设计示例的对应关系

V1.2 中的 `schema_version`、`message_type`、`message_id`、`correlation_id`、`sender` 和 `payload` 示例是概念结构。实际传输必须使用 Zero Bus 固定信封：`sender`、`receiver`、`type`、`msg_id`、`correlation_id`、`payload`。其中 `payload` **始终是 UTF-8 字符串**；业务对象序列化为此字符串，不在信封中放 JSON 对象。

本组件注册服务名 `plugin.zero_metadata`。WebSocket 客户端向该服务发送 `REQUEST`（`type: 1`）。总线的 `RESPONSE`/`ERROR` 会将 `correlation_id` 指向原请求的 `msg_id`；业务事件通过 `payload.request_id` 关联原请求。业务协议版本放在 payload 的 `schema_version` 字段。Zero Bus 自身的错误码与本组件的业务错误码分开处理。

总线一次请求只能回复一次，WebSocket 默认超时为 5 秒。因此当前实现对所有操作先回复 `accepted` 和 `task_id`，再向请求端点发送 `task.completed` 或 `task.failed` 通知。业务错误在任务事件中表达；入队失败等传输错误使用总线 `ERROR`。任何操作都不得先回复 `accepted` 再回复第二次。

## 2. 请求格式

外层信封示例：

```json
{
  "sender": "",
  "receiver": "plugin.zero_metadata",
  "type": 1,
  "msg_id": "req-001",
  "correlation_id": "",
  "payload": "{\"schema_version\":1,\"operation\":\"metadata.search\",\"params\":{\"artist\":{\"name\":\"周杰伦\"},\"album\":{\"title\":\"范特西\"}},\"options\":{\"image_mode\":\"ensure_local\"}}"
}
```

`payload` 反序列化后的业务结构：

```json
{
  "schema_version": 1,
  "operation": "metadata.search",
  "params": {
    "artist": {"name": "周杰伦"},
    "album": {"title": "范特西"}
  },
  "options": {
    "search_mode": "preferred_sources",
    "image_mode": "ensure_local",
    "force_update": false
  }
}
```

`schema_version` 和 `operation` 必填。未知版本返回 `UNSUPPORTED_SCHEMA_VERSION`；未知操作返回 `UNSUPPORTED_OPERATION`；字段类型错误返回 `INVALID_REQUEST`。请求中不得传入本地文件目标路径。

## 3. 响应与事件

耗时操作的第一次回复 payload：

```json
{
  "schema_version": 1,
  "status": "accepted",
  "request_id": "req-001",
  "task_id": "task-001"
}
```

完成事件 payload：

```json
{
  "schema_version": 1,
  "event": "task.completed",
  "request_id": "req-001",
  "task_id": "task-001",
  "status": "success",
  "result": {"artist": {}, "album": {}, "providers": {}}
}
```

图片完成事件 payload：

```json
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
```

只读操作的完成通知 payload 包含 `schema_version`、最终 `status`、`request_id` 和 `result`。部分数据可用时，结果 `status` 为 `partial`；后续通知可继续补足数据。通知发送失败或调用端已断开时，后台任务可继续完成并写入缓存，但不保留悬空调用端指针。

业务错误统一位于 payload 的 `error` 对象：`code`、`message`、可选 `provider`、`retryable`、`retry_at`。协议无法解析或服务无法接受任务时，优先使用总线 `ERROR` 单次应答；任务已接收后的失败用 `task.failed` 事件。

## 4. 操作及执行方式

| 操作 | 方式 | 用途 |
|---|---|---|
| `sources.list` | 任务 | 列出 Provider 能力、启用和认证状态 |
| `preferences.get` | 任务 | 读取当前偏好 |
| `preferences.set` | 任务 | 校验并保存偏好 |
| `metadata.search` | 任务 | 搜索候选与元数据 |
| `metadata.get` | 任务 | 按稳定身份获取元数据 |
| `metadata.refresh` | 任务 | 按策略刷新元数据 |
| `asset.ensure` | 任务 | 确保资产有可读的本地文件 |
| `asset.cancel` | 任务 | 取消图片任务订阅或下载 |
| `task.cancel` | 任务 | 请求协作式取消任务 |

`metadata.search` 默认按 Provider 启用状态、认证状态、能力和优先级规划查询。可用 `options.provider_id` 限定一个数据源；省略时使用符合请求能力的所有数据源。偏好 `search.parallel` 控制并行或顺序执行，`search.allow_partial_result` 控制部分 Provider 失败时是否接受已有结果。顺序模式在请求字段已解析、且计划中的 MusicBrainz 身份查询已执行后停止后续查询，并将未执行的数据源标记为 `skipped`。

有效聚合缓存直接返回，过期缓存立即以 `status: partial` 和 `result.cache.metadata: stale` 返回。`result.cache.refresh_pending: true` 表示刷新已排队，随后同一 `request_id` / `task_id` 会收到 `metadata.refreshed` 通知：成功时含新 `result`，失败时含 `error`。刷新退避期间 `refresh_pending: false`，并返回 `cache.retry_at`；同一刷新只执行一次。`options.cache_mode: "refresh"` 可跳过聚合缓存，继续使用有效 Provider 缓存；`force_update: true` 还会跳过 Provider 缓存和本地身份映射。存储与 TTL 见 [06-foo_zero_metadata_SQLite缓存策略_V1.0.md](06-foo_zero_metadata_SQLite缓存策略_V1.0.md)。

同时在队列中或正在执行的相同 `metadata.search`、`asset.ensure` 请求会共享一次执行。每个调用端仍收到自己的 `accepted`、`task_id`、`request_id` 及完成通知。偏好变更等其他请求会隔开前后两批请求，不跨变更共享执行。超过 8 KiB 的业务请求不参与去重，仍可正常执行。

`metadata.search` 的结果对象包含顶层布尔字段 `cached`：结果使用了聚合缓存或任一 Provider 缓存数据时为 `true`，全部由 Provider 实时查询生成时为 `false`；过期聚合缓存快照为 `true`。后续 `metadata.refreshed` 通知中的结果会独立设置此值。

`task.cancel` 的 `params.task_id` 指向先前接受响应中的任务 ID。只有同一发送方可以取消该订阅；若共享任务仍有其他订阅者，底层执行继续。取消请求返回 `result.cancelled`，目标任务收到 `status: "cancelled"`、错误码 `CANCELLED`。搜索与资产任务执行 45 秒后触发协作式中止；停止后，已有可用元数据时保留部分结果，否则使用 `PROVIDER_TIMEOUT` 结束任务。

`asset.cancel` 使用相同的 `params.task_id` 格式，仅能取消本调用端的 `asset.ensure` 任务。图片资产键、下载限制、恢复和容量清理见 [07-foo_zero_metadata_图片资产设计_V1.0.md](07-foo_zero_metadata_图片资产设计_V1.0.md)。

搜索结果中的 `candidates.artists` 和 `candidates.albums` 供调用端展示给用户。用户选定后，调用端把原名称及候选 `mbid` 一并传给 `metadata.search`，并设置 `options.confirm_identity: true`。`album.mbid` 表示 MusicBrainz 发行组 ID。确认时组件只调用 MusicBrainz 重新验证 ID，不使用查询缓存；成功写入映射后返回 `result.identity_confirmation`。专辑映射以艺人 MBID 和专辑标题为范围，避免同名专辑串联。`force_update: true` 会跳过查询缓存及本地身份映射。

聚合结果同时返回 `field_sources` 和 `field_contributors`；字段优先级、数组去重及图片来源的具体规则见 [05-foo_zero_metadata_字段合并规则_V1.0.md](05-foo_zero_metadata_字段合并规则_V1.0.md)。

Last.fm 的只读查询需要 API Key，可在 foobar2000 的 Preferences → Tools → Zero Metadata → Last.fm 页面配置；也可通过进程环境变量 `FOO_ZERO_METADATA_LASTFM_API_KEY` 提供，偏好页中的配置优先。不需要用户账号会话。未配置时 `sources.list` 返回 `auth_status: missing_api_key`，该 Provider 会被搜索计划跳过。Last.fm 返回值带有来源和署名链接信息，前端应展示并链接 Last.fm 署名。

调用端亦可使用总线的 `CANCEL`（`type: 6`），`correlation_id` 填原请求 `msg_id`。对于已返回 `accepted` 的长任务，调用 `task.cancel` 更明确，因为总线请求本身已经完成。

## 5. 约束与兼容

- `on_message` 只复制信封字段、做轻量校验和投递；超过 10 ms 总线会警告，超过 50 ms 可能隔离服务。
- 异步应答须在回调中 `retain` 回复句柄，使用完毕后 `release`；C++ 异常不能越过 ABI 边界。
- WebSocket payload 上限为 1 MB。大型原始 Provider 响应不通过协议发送。
- 增加可选字段保持版本 1；删除、改名或修改字段语义需提升 `schema_version`。
- 本地路径由运行时生成；SQLite 仅持久化相对路径。
