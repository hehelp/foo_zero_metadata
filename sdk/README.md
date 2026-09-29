# foo_zero_metadata SDK

`foo_zero_metadata` is a metadata and media asset service component for the foobar2000 Zero ecosystem.

**SDK release:** 1.0.0 · **Maintainer:** klyrics.cn · Copyright (C) 2026 klyrics.cn  
[简体中文](README.zh-CN.md)

This SDK exposes a unified Zero Bus interface through `foo_zero_bus`. It supports searches across multiple sources, identity resolution, metadata aggregation, user-selected data sources, image asset discovery, and on-demand downloads.

For the complete development protocol, see:

The protocol reference is included as [Zero Bus Protocol V1.0](docs/zero_bus_protocol.zh-CN.md). The API reference below is the primary English interface documentation.

## 1. Versions and Requirements

| Item | Current Value |
|---|---|
| Component release | `1.0.0` |
| Intended target hosts | foobar2000 1.x/2.x on Windows; 2.x on macOS 11+ |
| Intended target architectures | Windows x86/x64/ARM64EC; macOS arm64/x86_64 |
| v1.0.0 build status | Windows x86, x64, ARM64EC, and macOS universal binaries built; combined installer and SDK archive prepared; host checks are pending |
| Maintainer | `klyrics.cn` |
| Copyright | `Copyright (C) 2026 klyrics.cn` |
| Zero Bus service name | `plugin.zero_metadata` |
| Zero Bus version | `foo_zero_bus 0.1.1 / ABI v1` |
| Application protocol | `schema_version: 1` |
| Default WebSocket endpoint | `ws://127.0.0.1:17890` |
| Node.js Demo | Node.js 24 or later |
| Encoding | UTF-8 |

Before running the client:

1. Install and start foobar2000.
2. Install `foo_zero_bus`.
3. Install `foo_zero_metadata`.
4. Ensure the client can connect to the Zero Bus WebSocket service.
5. To use Last.fm, configure an API key under `Preferences → Tools → Zero Metadata → Last.fm`.
6. To use Spotify, configure Client ID and Client Secret under `Preferences → Tools → Zero Metadata → Spotify`.

The Last.fm API key is not transmitted through Zero Bus and should not be included in example code, logs, or the repository.

## 2. Protocol Model

foo_zero_metadata uses a two-layer protocol:

~~~text
Zero Bus outer envelope
    └── payload: UTF-8 JSON string
            └── foo_zero_metadata application request or event
~~~

- `foo_zero_bus` handles routing and transport for the outer envelope.
- `foo_zero_metadata` parses the inner JSON.
- The outer `payload` must always be a string, not a JSON object.
- SQLite is an internal implementation detail; clients must not access it directly.

### 2.1 Service Name

The request's `receiver` must be:

~~~text
plugin.zero_metadata
~~~

### 2.2 Zero Bus Message Types

| `type` | Name | Direction | Purpose |
|---:|---|---|---|
| `1` | `REQUEST` | Client → Service | Application request |
| `2` | `RESPONSE` | Service → Client | Single acknowledgement that the request has been accepted |
| `4` | `NOTIFICATION` | Service → Client | Task completion, failure, or asset event |
| `5` | `ERROR` | Service → Client | Parsing or queueing failure |
| `6` | `CANCEL` | Client → Service | Cancel a transport-layer request |

### 2.3 Outer Envelope

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

| Field | Type | Required | Description |
|---|---|---:|---|
| `sender` | string | Yes | Client identifier; may be an empty string |
| `receiver` | string | Yes | Must be `plugin.zero_metadata` |
| `type` | number | Yes | Zero Bus message type |
| `msg_id` | string | Yes | Unique ID of the current message |
| `correlation_id` | string | No | References an existing message; usually empty for a new request |
| `payload` | string | Yes | UTF-8 application JSON string |

Clients must generate a unique `msg_id` for every request.

### 2.4 Requests and Asynchronous Tasks

The default Zero Bus WebSocket request timeout is 5 seconds. Long-running operations follow these rules:

1. The service first sends a single `RESPONSE` with `type: 2`.
2. `status: "accepted"` in the `RESPONSE` only means that the task has been queued.
3. The final result is delivered through a notification with `type: 4`.
4. Once `accepted` has been returned, the service does not send a second `RESPONSE`.
5. If the protocol cannot be parsed, the service is unavailable, or the task cannot be queued, the request receives a single `ERROR` with `type: 5`.

Task events are correlated with the original request's `msg_id` through `request_id` in the event payload.

## 3. Application Request Structure

After deserialization, the outer `payload` must have the following structure:

~~~json
{
  "schema_version": 1,
  "operation": "metadata.search",
  "params": {},
  "options": {}
}
~~~

| Field | Type | Required | Description |
|---|---|---:|---|
| `schema_version` | number | Yes | Must currently be `1` |
| `operation` | string | Yes | Operation name |
| `params` | object | Depends on the operation | Operation input |
| `options` | object | No | Search, cache, and image policies |

Constraints:

- An unknown version returns `UNSUPPORTED_SCHEMA_VERSION`.
- An unknown operation returns `UNSUPPORTED_OPERATION`.
- An incorrect field type returns `INVALID_REQUEST`.
- The outer payload is limited to 1 MiB.
- `artist.name`, `artist.mbid`, `album.title`, and `album.mbid` are each limited to 512 bytes.
- Requests must not specify a local destination file path.
- Large raw Provider responses are not returned through Zero Bus.

## 4. API Overview

### 4.1 Currently Supported Operations

| Operation | Input | Output |
|---|---|---|
| `sources.list` | None | Provider capabilities, enabled state, and authentication status |
| `preferences.get` | None | Current data source, search, and image preferences |
| `preferences.set` | Preference patch | Saved preferences |
| `metadata.search` | Artist, album, and query options | Aggregated metadata, candidates, and Provider status |
| `asset.ensure` | `asset_id` | Asset state and local path |
| `asset.cancel` | `params.task_id` | Cancel this sender's `asset.ensure` subscription |
| `task.cancel` | `params.task_id` | Cancel this sender's task subscription; abort execution if no subscribers remain |

### 4.2 Defined by the Protocol but Not Yet Implemented

The following operations currently return `UNSUPPORTED_OPERATION`:

| Operation | Planned Purpose |
|---|---|
| `metadata.get` | Retrieve metadata by stable identity |
| `metadata.refresh` | Refresh metadata according to a policy |

A pending Zero Bus request can be cancelled using a transport-layer `CANCEL` message with `type: 6`.

Identical in-flight `metadata.search` and `asset.ensure` requests share one execution. Each caller receives its own accepted response and terminal event. After acceptance, the same sender can call `task.cancel` with the accepted task ID. The cancellation result contains `target_task_id` and `cancelled`; the target receives `task.failed` with `status: "cancelled"` and `error.code: "CANCELLED"`. Other subscribers continue waiting. Search and asset tasks receive a cooperative abort signal after 45 seconds; when execution stops, available metadata is returned as a partial result, or the task fails with `PROVIDER_TIMEOUT`.

`asset.cancel` uses the same request shape as `task.cancel`, but accepts only a task ID from `asset.ensure`.

## 5. Common Responses and Events

### 5.1 Acceptance Response

After successfully accepting a task, the service sends a single response with `type: 2`:

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

Inner payload:

~~~json
{
  "schema_version": 1,
  "status": "accepted",
  "request_id": "req-001",
  "task_id": "task-001"
}
~~~

### 5.2 Completion Event

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

Possible `status` values:

~~~text
success
partial
failed
cancelled
~~~

### 5.3 Failure Event

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

Application errors are carried in the payload's `error` object; transport errors use Zero Bus `ERROR` messages.

A single Provider failure does not necessarily make the entire task fail. If usable results are available, the task may complete with `partial` status.

## 6. API Reference

### 6.1 `sources.list`

Lists registered Providers, their capabilities, enabled state, and authentication status.

#### Input

~~~json
{
  "schema_version": 1,
  "operation": "sources.list",
  "params": {},
  "options": {}
}
~~~

#### Output

Example `result` from a `task.completed` event:

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

Possible `auth_status` values:

~~~text
not_required
missing_api_key
configured
expired
invalid
~~~

### 6.2 `preferences.get`

Reads the current user's data source, search, and image preferences.

#### Input

~~~json
{
  "schema_version": 1,
  "operation": "preferences.get",
  "params": {},
  "options": {}
}
~~~

#### Output

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

Credentials, API keys, and shared secrets are never included in the response.

### 6.3 `preferences.set`

Updates preferences using a patch. Submit only the fields that need to change.

#### Input

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

Supported fields:

| Path | Type | Description |
|---|---|---|
| `providers.<id>.enabled` | boolean | Whether the Provider may be called |
| `providers.<id>.priority` | number | Provider priority |
| `providers.<id>.capabilities.identity` | boolean | Whether to use the Provider for identity resolution |
| `providers.<id>.capabilities.metadata` | boolean | Whether to use the Provider for metadata |
| `providers.<id>.capabilities.images` | boolean | Whether to use the Provider for images |
| `search.parallel` | boolean | Whether to search in parallel |
| `search.allow_partial_result` | boolean | Whether to accept partial results |
| `images.download_mode` | string | Currently supports `on_demand` |
| `images.max_cache_size_mb` | integer | Image cache limit, 64–16384 MiB; default 1024 MiB |

#### Output

After the preferences have been saved successfully, the `result` of `task.completed` contains the effective saved preferences:

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

Providers disabled by the user are not called by the search planner.

### 6.4 `metadata.search`

Searches for artists and albums using the supplied input and user preferences, then aggregates results from multiple Providers.

#### Input

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

Supported `params` structure:

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

Rules:

- To search for an artist, provide at least one of `artist.name` or `artist.mbid`.
- To search for an album, provide at least one of `album.title` or `album.mbid`.
- You may provide only `artist` or only `album`.
- When both a stable ID and a name are provided, the stable ID takes precedence. `album.mbid` is a MusicBrainz release-group ID.
- Do not supply a local file path.

`options` fields:

| Field | Type | Default | Description |
|---|---|---|---|
| `provider_id` | string | Unspecified | Restricts the search to one Provider; when omitted, multiple Providers are selected according to preferences |
| `search_mode` | string | `preferred_sources` | Currently supports `preferred_sources` |
| `image_mode` | string | `discover` | `none`, `discover`, or `ensure_local` |
| `force_update` | boolean | `false` | Bypasses valid metadata cache entries and saved identity mappings |
| `cache_mode` | string | `default` | `refresh` skips the aggregate cache while retaining fresh per-Provider cache entries and identity mappings |
| `confirm_identity` | boolean | `false` | Rechecks and saves a user-selected MusicBrainz identity |

Image modes:

| Value | Behavior |
|---|---|
| `none` | Does not discover or download images |
| `discover` | Returns image asset descriptions and URLs without initiating downloads |
| `ensure_local` | Discovers images and submits tasks to download them locally |

#### Output

Example `result` from a `task.completed` event:

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

`cached` is a top-level boolean. It is `true` when the result uses aggregate-cache data or data from any Provider cache, and `false` when all data came from live Provider queries. A stale aggregate-cache snapshot is also `true`; a later `metadata.refreshed` event sets this field based on its own result.

Possible `match_status` values:

~~~text
resolved
ambiguous
not_found
partial
~~~

When `provider_id` is omitted, the component plans queries based on each Provider's enabled state, authentication status, capabilities, user priority, parallel execution policy, and partial-result policy.

An expired aggregate cache returns immediately as `task.completed` with `status: "partial"` and `result.cache.metadata: "stale"`. When `result.cache.refresh_pending` is `true`, keep listening on the same `request_id` and `task_id` for `metadata.refreshed`, which carries the refreshed `result` or an `error`. When it is `false`, `cache.retry_at` indicates the next eligible refresh. The component merges identical background refreshes and waits 60 seconds before retrying a failed refresh. Per-Provider cache entries have separate expiry times; a failing Provider may contribute stale data while its status reports `failed` and `retry_at`. See [SQLite cache policy](docs/cache_policy.zh-CN.md). The CLI demo exits after the first `task.completed` snapshot, so it does not display the later refresh notification.

`field_sources` records the winning Provider for a scalar field, or `multiple` for a combined field. `field_contributors` lists the sources that supplied a selected value or contributed to a combined field. Stable IDs and canonical names favor MusicBrainz; biography favors Last.fm. Tags and images are merged in Provider priority order. The full rules are in [the field merge document](docs/field_merge.zh-CN.md).

#### Confirm a candidate identity

When `match_status` is `ambiguous`, show `candidates.artists` or `candidates.albums` to the user. A candidate contains `mbid` and `score`; an album candidate also contains `artists` and `first_release_date`. After selection, repeat `metadata.search` with the original name/title, the selected ID, and `options.confirm_identity: true`:

~~~json
{
  "schema_version": 1,
  "operation": "metadata.search",
  "params": {
    "artist": { "name": "Radiohead", "mbid": "<selected-artist-mbid>" },
    "album": { "title": "OK Computer", "mbid": "<selected-release-group-mbid>" }
  },
  "options": { "confirm_identity": true, "image_mode": "none" }
}
~~~

MusicBrainz must be enabled; omit `provider_id` or set it to `musicbrainz`. The component rechecks the IDs before saving. A successful response includes `result.identity_confirmation` with `artist: "saved"` and/or `album: "saved"`. Album confirmation needs an artist identity. A mismatch returns `IDENTITY_NOT_FOUND`; an unresolved artist returns `IDENTITY_AMBIGUOUS`. The confirmation request bypasses the query cache.

### 6.5 `asset.ensure`

Ensures that a previously discovered image asset is downloaded to the local cache directory.

#### Input

~~~json
{
  "schema_version": 1,
  "operation": "asset.ensure",
  "params": {
    "asset_id": "<64-character asset_id from metadata.search>"
  },
  "options": {}
}
~~~

#### Output

~~~json
{
  "asset": {
    "asset_id": "<64-character asset_id>",
    "provider": "coverartarchive",
    "provider_asset_id": "<release-group-mbid>",
    "entity_type": "album",
    "entity_id": "<release-group-mbid>",
    "variant": "500",
    "role": "album_cover",
    "state": "ready",
    "local_path": "<absolute Profile path>/foo_zero_metadata/images/v1/ab/cd/<asset_id>.jpg",
    "mime_type": "image/jpeg",
    "width": 500,
    "height": 500
  }
}
~~~

If the asset already exists and its file is valid, the component returns the existing local path without downloading it again.

## 7. Image Asset Events

When `metadata.search` uses `image_mode: "ensure_local"`, or when `asset.ensure` is called, an `asset.ready` notification is sent after the image is ready.

~~~json
{
  "schema_version": 1,
  "event": "asset.ready",
  "request_id": "req-001",
  "task_id": "task-001",
  "asset_id": "<64-character asset_id>",
  "entity_type": "artist",
  "entity_id": "artist-001",
  "role": "artist_avatar",
  "local_path": "<absolute Profile path>/foo_zero_metadata/images/v1/ab/cd/<asset_id>.jpg"
}
~~~

On receiving `asset.ready`, the client can refresh only the corresponding image without requesting all metadata again.

Possible image states:

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

Local paths are generated by the component. Clients must not construct or specify image cache filenames themselves.

## 8. Data Sources and User Preferences

### 8.1 Source Selection

Users can configure the following in foobar2000's preferences:

- Whether a Provider is enabled.
- Provider priority.
- Whether it is used for identity matching.
- Whether it is used for metadata.
- Whether it is used for images.
- Whether partial results are allowed.
- Whether on-demand image downloads are allowed.

Sources disabled by the user are not silently called in the background.

### 8.2 Examples of Current Data Sources

| Provider | Typical Use | Authentication |
|---|---|---|
| MusicBrainz | Artist/album identity and basic information | Usually does not require a user API key |
| Last.fm | Artist biographies and similar artists | Requires an API key |
| Spotify | Visual assets such as artist images and album covers | Authentication as required by the Provider configuration |

Providers are extensible. Adding a data source should not change the client's Zero Bus request structure; clients obtain its capabilities through `sources.list`.

### 8.3 Last.fm Configuration

Configure the Last.fm API key under:

~~~text
Preferences → Tools → Zero Metadata → Last.fm
~~~

Alternatively, supply it through this environment variable:

~~~text
FOO_ZERO_METADATA_LASTFM_API_KEY
~~~

The setting on the preferences page takes precedence over the environment variable. When displaying content returned by Last.fm, retain the Last.fm attribution and links.

## 9. Error Handling

### 9.1 Application Error Structure

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

### 9.2 Common Error Codes

| Error Code | Description |
|---|---|
| `INVALID_REQUEST` | Invalid request field or type |
| `UNSUPPORTED_SCHEMA_VERSION` | Unsupported application protocol version |
| `UNSUPPORTED_OPERATION` | Operation not implemented in the current version |
| `NO_PROVIDER_ENABLED` | No available data source |
| `PROVIDER_AUTH_REQUIRED` | Provider credentials have not been configured |
| `PROVIDER_RATE_LIMITED` | Provider rate limit reached |
| `PROVIDER_NETWORK_ERROR` | Provider network request failed |
| `PROVIDER_PARSE_ERROR` | Provider response could not be parsed |
| `IDENTITY_AMBIGUOUS` | Multiple matching candidates |
| `IDENTITY_NOT_FOUND` | No matching entity |
| `IMAGE_TOO_LARGE` | Image exceeds the size limit |
| `IMAGE_INVALID_FORMAT` | Returned content is not a valid image |
| `IMAGE_DOWNLOAD_FAILED` | Image download failed |
| `STORAGE_ERROR` | Local cache or database error |
| `CANCELLED` | Task cancelled |

### 9.3 Transport Errors vs. Application Errors

| Situation | Response |
|---|---|
| JSON cannot be parsed | Zero Bus `ERROR` |
| Incorrect service name | Zero Bus `ERROR` |
| Task cannot be queued | Zero Bus `ERROR` |
| Provider timeout | `task.failed`, or `task.completed` with `partial` status |
| Image download failure | Failure recorded in the task result, or `partial` status |
| Application failure after task acceptance | `task.failed` notification |

## 10. Node.js Demo

### 10.1 Command-Line Demo

Demo path in the repository:

~~~text
github/sdk/demo.mjs
~~~

Run a query with the default arguments:

~~~sh
node github/sdk/demo.mjs
~~~

Query a specific artist and album:

~~~sh
node github/sdk/demo.mjs \
  --artist "Radiohead" \
  --album "OK Computer"
~~~

Restrict the search to Last.fm:

~~~sh
node github/sdk/demo.mjs \
  --artist "Radiohead" \
  --album "OK Computer" \
  --provider lastfm
~~~

List sources only:

~~~sh
node github/sdk/demo.mjs --sources-only
~~~

Use Simplified Chinese output:

~~~sh
node github/sdk/demo.mjs --lang zh-CN --sources-only
~~~

Command-line arguments:

| Argument | Description |
|---|---|
| `--url` | Zero Bus WebSocket URL |
| `--artist` | Artist name |
| `--artist-mbid` | Selected MusicBrainz artist ID |
| `--album` | Album title |
| `--album-mbid` | Selected MusicBrainz release-group ID |
| `--confirm-identity` | Verify and save the selected identity mapping |
| `--provider` | Restrict the Provider |
| `--image-mode` | `none`, `discover`, or `ensure_local` |
| `--force-update` | Bypass valid metadata cache entries and saved identity mappings |
| `--sources-only` | Query source status only |
| `--lang zh-CN` | Use Simplified Chinese output |

Regular queries default to `image_mode: "none"`, so querying metadata does not trigger image downloads.

### 10.2 Minimal Node.js Example

The following example only requires the global `WebSocket` API provided by Node.js 24:

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
    console.log("Task accepted:", accepted.task_id);
    return;
  }

  if (message.type === 4) {
    const eventPayload = JSON.parse(message.payload);

    if (eventPayload.event === "asset.ready") {
      console.log("Image ready:", eventPayload.local_path);
      return;
    }

    if (eventPayload.event === "task.completed") {
      console.dir(eventPayload.result, { depth: null });
      if (eventPayload.result?.cache?.refresh_pending !== true) ws.close();
      return;
    }

    if (eventPayload.event === "metadata.refreshed") {
      if (eventPayload.result) console.dir(eventPayload.result, { depth: null });
      else console.error("Refresh failed:", eventPayload.error);
      ws.close();
      return;
    }

    if (eventPayload.event === "task.failed") {
      console.error("Task failed:", eventPayload.error);
      ws.close();
    }
    return;
  }

  if (message.type === 5) {
    console.error("Zero Bus error:", message.payload);
    ws.close();
  }
});

ws.addEventListener("error", (error) => {
  console.error("WebSocket error:", error);
});
~~~

### 10.3 Request Sequence

~~~text
WebSocket open
    ↓
Send type: 1 REQUEST
    ↓
Receive type: 2 RESPONSE / accepted
    ↓
Wait for type: 4 NOTIFICATION
    ├── asset.ready
    ├── task.completed or task.failed
    └── metadata.refreshed (after a stale task.completed)
~~~

Clients must not treat `accepted` as an indication that the query has completed.

## 11. Client Integration Guidelines

1. Use a unique `msg_id` for every request.
2. Keep a `msg_id → task_id` mapping.
3. Use `request_id` in application events to filter out notifications for other tasks.
4. Handle `success`, `partial`, `failed`, and `cancelled` correctly.
5. Do not assume that all Providers will succeed.
6. Do not assume that both `artist` and `album` will be present.
7. Handle `ambiguous` candidate results.
8. On receiving `asset.ready`, refresh only the corresponding UI resource.
9. Do not include local image paths in requests.
10. Do not depend on SQLite table names or the local cache directory layout.

The runnable browser UI example is [`examples/zero_ui_panel/index.html`](examples/zero_ui_panel/index.html). The SMP sample at [`examples/smp/metadata-panel.js`](examples/smp/metadata-panel.js) uses the standard Zero Bus WebSocket envelope over the existing SMP WebSocket bridge. See that directory's README for setup and usage.
11. Do not include API keys, tokens, or shared secrets in Zero Bus payloads.
12. Remain compatible with unknown fields in responses.

## 12. Protocol Compatibility and Versioning

Current application protocol version:

~~~text
schema_version = 1
~~~

Version 1 allows new optional fields; clients should ignore optional fields they do not recognize. Removing or renaming a field, or changing its meaning, is a breaking change and requires an increment to `schema_version`.

The Zero Bus ABI/transport version is managed independently of the application `schema_version`. Clients should check all of the following:

1. Zero Bus transport errors.
2. The application payload's `schema_version`.
3. The application event's `status`.
4. The application error's `error.code`.

## 13. Directory Layout and Related Documents

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

Related documents:

- [Zero Bus Protocol V1.0](docs/zero_bus_protocol.zh-CN.md)
- [Simplified Chinese README](./README.zh-CN.md)
