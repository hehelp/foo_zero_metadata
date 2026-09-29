# foo_zero_metadata 字段合并与来源规则

**版本**：V1.0  
**状态**：已实现  
**依据**：产品设计文档 V1.2 第 7.4 节

## 1. 合并顺序

Merge Engine 在 `src/search_aggregator.cpp` 的 `kFieldRules` 中集中维护字段策略。它先使用字段专属来源顺序，再用偏好页中的 Provider 优先级（数字越小越优先）决定同级来源；最后以 Provider ID 保证结果稳定。未列出的标量字段直接使用 Provider 优先级。网络响应到达顺序不影响结果。

| 字段 | 策略 |
|---|---|
| `artist.mbid`、`album.release_group_mbid`、`album.release_mbid` | MusicBrainz 优先 |
| `artist.name`、`album.title` | MusicBrainz → Spotify → Last.fm |
| `artist.sort_name`、`artist.disambiguation`、`album.first_release_date`、`album.release_year` | MusicBrainz 优先 |
| `artist.biography`、`artist.similar_artists`、`artist.listeners`、`artist.url` | Last.fm 优先 |
| `album.mbid`、`album.release_date`、`album.artist`、`album.url` | Last.fm 优先；`album.mbid` 与发行组 ID 是不同字段 |
| `artist.tags`、`artist.aliases`、`album.tags` | 按 Provider 优先级合并、去重，保留首个文本形式 |
| `artist.images`、`album.images` | 按 Provider 优先级合并资产，按 `asset_id` 或来源 URL 与用途去重 |

空值、空白字符串、空数组和只有 `source` 的对象不会覆盖有效值。候选项以 MBID（缺失时用规范化名称）去重，保留较高分数，并记录所有提供该候选的来源。MusicBrainz 返回未决候选时，其他来源的文本元数据不会把身份状态改为 `resolved`。

## 2. 返回结果中的来源

- `artist.source` / `album.source`：名称或标题最终采用的来源；没有名称或标题时使用首个提供有效内容的来源。
- `artist.sources` / `album.sources`：提供过有效实体字段的 Provider。它们不表示每个字段都来自这些 Provider。
- `field_sources.<entity>.<field>`：选中标量字段的来源；合并字段有多个来源时为 `multiple`。
- `field_contributors.<entity>.<field>`：该字段的贡献来源列表。标量字段只有胜出的来源；标签、别名和图片可有多个来源。
- `candidates.*[].source` / `sources`：候选项的当前最佳来源及所有来源。
- `images[].provider`：单张图片的来源。Cover Art Archive 的资产由图片发现流程加入，同时更新 `field_sources.album.images`、`field_contributors.album.images` 和 `cache.images`。
- Spotify 搜索返回的艺人头像和专辑封面作为临时来源 URL 附在 `artist.images` / `album.images` 中；每个图片对象和 `providers.spotify.attribution` 都带有 Spotify 来源及回链信息，并标记需要展示 Spotify 品牌署名。Spotify 图片不进入本地 `asset.ensure` 下载/持久化流程。
- `providers.<id>.attribution`：Provider 要求前端展示的署名，例如 Last.fm。

`field_contributors` 是协议 V1 的新增可选字段。`field_sources` 仍保持字符串值，旧调用端可以继续按原方式读取。查询缓存键已升级，旧合并结果不会冒充新格式的有效缓存。

## 3. 示例

```json
{
  "artist": {
    "name": "Radiohead",
    "mbid": "<artist-mbid>",
    "tags": ["alternative", "rock"],
    "source": "musicbrainz",
    "sources": ["musicbrainz", "lastfm"],
    "images": []
  },
  "field_sources": {
    "artist": {"name": "musicbrainz", "mbid": "musicbrainz", "tags": "lastfm"},
    "album": {}
  },
  "field_contributors": {
    "artist": {"name": ["musicbrainz"], "mbid": ["musicbrainz"], "tags": ["lastfm"]},
    "album": {}
  }
}
```

示例只展示与合并规则有关的字段；完整 `metadata.search` 响应还包含候选、Provider 状态、缓存状态和匹配状态。
