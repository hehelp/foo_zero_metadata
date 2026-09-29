# foo_zero_metadata SQLite 与缓存策略

**版本**：V1.0  
**状态**：已实现；宿主内故障验收待完成  
**依据**：产品设计文档 V1.2 第 10、11 节与开发计划 Phase 3

## 1. 数据库与迁移

数据库位于 foobar2000 Profile 的 `foo_zero_metadata/metadata-v1.sqlite3`。`schema_meta.version` 当前为 6。启动时在 `BEGIN IMMEDIATE` 事务中创建缺失表、将 v0–v4 的 `query_cache` 增加失败与重试字段，并为 v0–v5 的 `asset_records` 增加 Provider 资产 ID、实体关联、变体、MIME 类型和尺寸字段；所有步骤成功后才提交版本号。高于 v6 的数据库会被拒绝打开。SQLite 使用 WAL、外键检查和 3 秒 busy timeout。

| 表 | 职责 |
|---|---|
| `query_cache` | 按搜索计划保存聚合后的标准化 JSON、获取与过期时间、最后错误和下次刷新时间 |
| `provider_cache` | 按 Provider 与规范化查询输入保存该源的标准化 JSON、成功时间、过期时间、最后错误、重试时间与解析器版本 |
| `provider_records` | 单独保存 Provider 原始响应；不作为外部协议结构 |
| `identity_mappings` | 保存艺人及按艺人范围限定的专辑身份映射 |
| `user_preferences` | 保存用户偏好 |
| `asset_records` | 保存图片来源、相对路径、状态、大小和最近访问时间；图片本体不写入 SQLite |

## 2. 查询与刷新

搜索键包含协议实现版本、并行/顺序模式、启用的 Provider 及优先级、身份解析后的查询输入。相同有效请求可命中 `query_cache`。当前键前缀为 `search:v4:`，用于隔离旧格式缓存。

聚合缓存过期时，`metadata.search` 立即返回 `task.completed`，`status: partial`、`result.cache.metadata: stale`。`result.cache.refresh_pending: true` 表示同一请求的后台刷新已排入 Zero Bus 工作队列；完成后向原 `request_id` / `task_id` 发布 `metadata.refreshed`，其 `status`、`result` 或 `error` 与普通任务完成结果对应。队列中相同刷新只执行一次，多个调用端分别收到通知。刷新失败保留原聚合缓存，并在 60 秒重试时间内只返回旧快照、`refresh_pending: false` 和 `cache.retry_at`，不连续访问失败的 Provider。后台任务受既有 45 秒协作式超时和插件关闭取消约束。

未命中有效聚合缓存时，Coordinator 逐个读取 `provider_cache`：有效的来源结果直接参与字段合并；过期来源重新查询。单源查询失败时可用该源旧结果参与合并，但该 Provider 标记为 `failed`，并带有 `cache: stale`、`retryable` 和 `retry_at`。成功来源的缓存独立写回；部分失败不会覆盖之前成功的聚合快照。没有旧结果时仍记录失败及重试时间。当前 MusicBrainz TTL 为 30 天、Last.fm 为 7 天、Mock 为 1 天；聚合缓存以参与来源的最早过期时间为准。

`force_update: true` 跳过聚合缓存、Provider 有效缓存和本地身份映射，重新查询元数据，不删除既有缓存。显式 `options.cache_mode: "refresh"` 跳过聚合缓存，但保留有效的 Provider 缓存和身份映射；它也用于后台刷新。图片资产缓存独立于这两个元数据刷新选项，由 `image_mode` 和 `asset.ensure` 控制。

## 3. 持久化与恢复边界

原始 Provider 响应与标准化来源结果分别写入，不因一个来源失败而覆盖其他来源。SQLite 写入使用预编译语句；迁移失败会回滚并报告存储不可用。请求队列串行处理数据库读写，Provider 网络查询可以并行执行；并行网络线程不访问 SQLite。身份映射和偏好保持各自的表职责。

图片下载中的文件及数据库状态恢复由 Asset Manager 处理。数据库损坏、磁盘不可写、Profile 迁移、跨平台升级和实际宿主重启行为仍需按开发计划 Phase 6 逐项验收。
