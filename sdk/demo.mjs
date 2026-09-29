#!/usr/bin/env node
/**
 * foo_zero_metadata / Zero Bus SDK Demo（Node.js 24+，无需安装依赖）
 *
 * 阅读顺序：main → runDemo → ZeroMetadataClient.request → handleMessage。
 * 执行流程：解析参数 → 连接 → sources.list → metadata.search → 关闭连接。
 *
 * 协议要点：
 * 1. 外层为 Zero Bus 信封，payload 是再次 JSON.stringify 后的字符串。
 * 2. RESPONSE(type=2) 仅确认 accepted，不是搜索结果。
 * 3. NOTIFICATION(type=4) 用 payload.request_id 关联原请求 msg_id。
 * 4. asset.ready 不是任务终点；task.completed / task.failed 才结束本次等待。
 * 5. ERROR(type=5) 属于总线层；payload.error 属于业务层，分别处理。
 *
 * 本 Demo 是一次性查询：首个 task.completed（含 partial）即返回。
 * partial 后可能还有补充通知；持续更新的 UI 应保持连接并另外管理订阅。
 * 本地超时/关闭连接不等于服务端任务已取消，本 Demo 不自动重试或取消。
 *
 * 示例（在此文件所在目录执行）：
 *   node demo.mjs --lang zh-CN
 *   node demo.mjs --artist "Radiohead" --album "OK Computer" --provider lastfm
 *   node demo.mjs --sources-only
 *   node demo.mjs --image-mode ensure_local --task-timeout-ms 120000
 *
 * 默认不下载图片、不修改偏好、不发送凭据。Last.fm API Key 在插件偏好页配置。
 */

import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

// ── 1. 协议常量与参数 ───────────────────────────────────────────

const SERVICE = "plugin.zero_metadata";
const SCHEMA_VERSION = 1;
const TYPE = Object.freeze({ REQUEST: 1, RESPONSE: 2, NOTIFICATION: 4, ERROR: 5 });
const MAX_PAYLOAD_BYTES = 1_000_000; // 保守遵守协议文档的 1 MB 上限
const DEFAULTS = Object.freeze({
  artist: "Radiohead",
  artistMbid: undefined,
  album: undefined,
  albumMbid: undefined,
  provider: undefined,
  imageMode: "none",
  forceUpdate: false,
  confirmIdentity: false,
  sourcesOnly: false,
  lang: "en",
  help: false,
  connectTimeoutMs: 10000,
  ackTimeoutMs: 5000,
  taskTimeoutMs: 60000,
});

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const isId = value => typeof value === "string" && value.length > 0;

/** 只负责解析和校验参数，不连接网络；原有命令行参数保持兼容。 */
export function parseArgs(args, env = process.env) {
  const options = { ...DEFAULTS, url: env.ZERO_BUS_URL ?? "ws://127.0.0.1:17890" };
  const values = {
    "--url": "url", "--artist": "artist", "--artist-mbid": "artistMbid",
    "--album": "album", "--album-mbid": "albumMbid",
    "--provider": "provider", "--image-mode": "imageMode", "--lang": "lang",
    "--connect-timeout-ms": "connectTimeoutMs",
    "--ack-timeout-ms": "ackTimeoutMs", "--task-timeout-ms": "taskTimeoutMs",
  };
  const flags = {
    "--force-update": "forceUpdate", "--confirm-identity": "confirmIdentity",
    "--sources-only": "sourcesOnly",
    "--help": "help", "-h": "help",
  };
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (Object.hasOwn(flags, name)) {
      options[flags[name]] = true;
    } else if (Object.hasOwn(values, name)) {
      const value = args[++i];
      if (!value || value.startsWith("--") || value === "-h") {
        throw new Error(name + " requires a value / 缺少参数值");
      }
      options[values[name]] = value;
    } else {
      throw new Error("Unknown option / 未知参数: " + name);
    }
  }

  // 完整解析后再处理帮助，保证 --help --lang zh-CN 的顺序不影响语言。
  if (!["en", "zh-CN"].includes(options.lang)) throw new Error("--lang: en | zh-CN");
  if (options.help) return options;
  if (!["none", "discover", "ensure_local"].includes(options.imageMode)) {
    throw new Error("--image-mode: none | discover | ensure_local");
  }
  const url = new URL(options.url);
  if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error("Expected ws:// or wss:// URL without credentials/fragment / 连接地址无效");
  }
  for (const name of ["artist", "artistMbid", "album", "albumMbid"]) {
    const value = options[name];
    if (value !== undefined && (!value.trim() || Buffer.byteLength(value, "utf8") > 512)) {
      throw new Error(name + ": expected non-blank text, at most 512 UTF-8 bytes / 名称无效");
    }
  }
  if (options.confirmIdentity && !options.artistMbid && !options.albumMbid) {
    throw new Error("--confirm-identity requires --artist-mbid and/or --album-mbid");
  }
  if (options.confirmIdentity && options.albumMbid && !options.album) {
    throw new Error("--album-mbid confirmation requires --album TITLE");
  }
  if (options.confirmIdentity && options.provider && options.provider !== "musicbrainz") {
    throw new Error("--confirm-identity requires MusicBrainz; omit --provider or set it to musicbrainz");
  }
  for (const name of ["connectTimeoutMs", "ackTimeoutMs", "taskTimeoutMs"]) {
    const value = Number(options[name]);
    if (!Number.isInteger(value) || value < 1 || value > 2_147_483_647) {
      throw new Error(name + ": expected integer milliseconds in [1, 2147483647]");
    }
    options[name] = value;
  }
  return options;
}

function printUsage(lang) {
  const zh = lang === "zh-CN";
  console.log([
    zh ? "用法：node demo.mjs [选项]" : "Usage: node demo.mjs [options]",
    "",
    "--url URL                  " + (zh ? "地址；默认 ZERO_BUS_URL 或 ws://127.0.0.1:17890" : "URL; default ZERO_BUS_URL or ws://127.0.0.1:17890"),
    "--artist NAME              " + (zh ? "艺人名称，默认 Radiohead" : "Artist name, default Radiohead"),
    "--artist-mbid ID           " + (zh ? "艺人的 MusicBrainz ID" : "MusicBrainz artist ID"),
    "--album TITLE              " + (zh ? "可选专辑名称" : "Optional album title"),
    "--album-mbid ID            " + (zh ? "专辑发行组的 MusicBrainz ID" : "MusicBrainz release-group ID"),
    "--provider ID              " + (zh ? "限定数据源，例如 lastfm" : "Restrict provider, e.g. lastfm"),
    "--image-mode MODE          none | discover | ensure_local (default: none)",
    "--force-update             " + (zh ? "跳过有效元数据缓存" : "Bypass fresh metadata cache"),
    "--confirm-identity         " + (zh ? "验证并保存所选身份映射" : "Verify and save selected identity mapping"),
    "--sources-only             " + (zh ? "列出数据源后退出" : "List sources and exit"),
    "--lang LANG                en | zh-CN (default: en)",
    "--connect-timeout-ms N     " + (zh ? "连接超时，默认 10000" : "Connection timeout, default 10000"),
    "--ack-timeout-ms N         " + (zh ? "等待 accepted 超时，默认 5000" : "Acknowledgement timeout, default 5000"),
    "--task-timeout-ms N        " + (zh ? "发送至首次完成的总超时，默认 60000" : "Send-to-first-completion timeout, default 60000"),
    "-h, --help                 " + (zh ? "显示帮助" : "Show help"),
  ].join("\n"));
}

/** 构造业务层搜索输入。数据源省略时，由服务端按用户偏好选择。 */
export function buildSearchRequest(options) {
  const params = { artist: { name: options.artist } };
  if (options.artistMbid !== undefined) params.artist.mbid = options.artistMbid;
  if (options.album !== undefined) params.album = { title: options.album };
  if (options.albumMbid !== undefined) params.album.mbid = options.albumMbid;
  const requestOptions = {
    search_mode: "preferred_sources",
    image_mode: options.imageMode,
    force_update: options.forceUpdate,
  };
  if (options.confirmIdentity) requestOptions.confirm_identity = true;
  if (options.provider !== undefined) requestOptions.provider_id = options.provider;
  return { params, options: requestOptions };
}

// ── 2. 传输层：连接、请求关联和资源清理 ───────────────────────────

/**
 * 小型单连接客户端。request() 返回“首次任务完成事件”的 Promise。
 * result 保持原样：不猜测 Provider 返回字段，不重新定义 SDK 输出结构。
 * WebSocketImpl 可注入，用于离线模拟测试；正式运行使用 Node 全局 WebSocket。
 */
export class ZeroMetadataClient {
  constructor(url, {
    WebSocketImpl = globalThis.WebSocket,
    connectTimeoutMs = 10000,
    ackTimeoutMs = 5000,
    taskTimeoutMs = 60000,
    onProgress = () => {},
  } = {}) {
    this.url = url;
    this.WebSocketImpl = WebSocketImpl;
    this.connectTimeoutMs = connectTimeoutMs;
    this.ackTimeoutMs = ackTimeoutMs;
    this.taskTimeoutMs = taskTimeoutMs;
    this.onProgress = onProgress;
    this.pending = new Map(); // msg_id → { operation, taskId, timers, resolve, reject }
    this.ws = null;
    this.closed = false;
    this.connectionReject = null;
  }

  /** 监听器在等待 open 前装好；连接失败/超时/提前 close 都会结束等待。 */
  async connect() {
    if (this.ws || this.closed) throw new Error("Client is single-use / 请创建新客户端");
    if (typeof this.WebSocketImpl !== "function") {
      throw new Error("Node.js 24+ with global WebSocket is required / 请使用 Node.js 24+");
    }
    const ws = this.ws = new this.WebSocketImpl(this.url);
    ws.addEventListener("message", event => this.handleMessage(event.data));
    ws.addEventListener("error", () => this.abort(new Error("WebSocket connection error / 连接错误")));
    ws.addEventListener("close", () => {
      this.abort(new Error("WebSocket closed before completion / 连接在完成前关闭"));
    });

    await new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        ws.removeEventListener("open", onOpen);
        this.connectionReject = null;
      };
      const onOpen = () => { cleanup(); resolve(); };
      this.connectionReject = error => { cleanup(); reject(error); };
      const timer = setTimeout(() => {
        this.abort(new Error("Connection timeout / 连接超时"));
      }, this.connectTimeoutMs);
      ws.addEventListener("open", onOpen, { once: true });
    });
  }

  /**
   * 输入：operation、params 对象、options 对象。
   * 输出：{schema_version, event, request_id, task_id, status, result} 完成事件。
   * accepted 只更新 taskId，不 resolve；业务失败/超时/断线则 reject。
   */
  request(operation, params = {}, options = {}) {
    if (this.closed || this.ws?.readyState !== 1) {
      return Promise.reject(new Error("WebSocket is not open / 尚未连接"));
    }
    const requestId = "sdk-" + randomUUID();
    const payload = JSON.stringify({ schema_version: SCHEMA_VERSION, operation, params, options });
    if (Buffer.byteLength(payload, "utf8") > MAX_PAYLOAD_BYTES) {
      return Promise.reject(new Error("Payload exceeds 1 MB / 请求过大"));
    }

    return new Promise((resolve, reject) => {
      const entry = { operation, taskId: null, resolve, reject };
      // 总超时从发送时开始，不因 accepted 或进度事件不断延长。
      entry.ackTimer = setTimeout(() => {
        this.settle(requestId, new Error(operation + ": accepted timeout / 接受确认超时"));
      }, this.ackTimeoutMs);
      entry.taskTimer = setTimeout(() => {
        this.settle(requestId, new Error(operation + ": task timeout; server may continue / 任务超时，服务端可能仍在执行"));
      }, this.taskTimeoutMs);
      this.pending.set(requestId, entry); // 先登记，避免极快回复无法关联
      try {
        this.ws.send(JSON.stringify({
          sender: "",
          receiver: SERVICE,
          type: TYPE.REQUEST,
          msg_id: requestId,
          correlation_id: "",
          payload, // 注意：字符串，不是对象
        }));
        this.onProgress({ kind: "sent", operation, requestId });
      } catch (error) {
        this.settle(requestId, error);
      }
    });
  }

  /** 完成/失败只处理一次；重复或已超时消息因为 Map 中无记录而被忽略。 */
  settle(requestId, error, result) {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    clearTimeout(entry.ackTimer);
    clearTimeout(entry.taskTimer);
    this.pending.delete(requestId);
    if (error) entry.reject(error);
    else entry.resolve(result);
  }

  /** 连接级错误使所有等待中的请求失败，并阻止之后继续发送。 */
  abort(error) {
    if (this.closed) return;
    this.closed = true;
    this.connectionReject?.(error);
    for (const requestId of this.pending.keys()) this.settle(requestId, error);
    try { this.ws?.close(); } catch { /* 连接可能已经关闭 */ }
  }

  close() {
    this.abort(new Error("Client closed / 客户端已关闭"));
  }

  // ── 3. 协议层：按类型、请求 ID 和 task_id 分发 ─────────────────

  handleMessage(raw) {
    if (this.closed) return;
    let envelope;
    try {
      envelope = JSON.parse(raw);
      if (!isObject(envelope)) throw new Error("Expected envelope object");
    } catch {
      // 无法判断损坏消息属于哪个请求，终止本连接，不能静默伪装成功。
      this.abort(new Error("Invalid Zero Bus envelope / 总线信封不是合法 JSON 对象"));
      return;
    }
    const type = envelope.type;
    if (![TYPE.RESPONSE, TYPE.NOTIFICATION, TYPE.ERROR].includes(type)) return;

    // RESPONSE/ERROR 使用外层 correlation_id；不属于本客户端的回复忽略。
    const directReply = type !== TYPE.NOTIFICATION;
    let requestId = directReply ? envelope.correlation_id : undefined;
    if (directReply && !this.pending.has(requestId)) return;

    // 总线 ERROR 的格式与业务 error 独立，不强制套业务 schema。
    if (type === TYPE.ERROR) {
      const error = new Error("Zero Bus transport error / 总线传输错误: " + String(envelope.payload));
      error.layer = "transport";
      error.details = envelope.payload;
      this.settle(requestId, error);
      return;
    }

    let payload;
    try {
      if (typeof envelope.payload !== "string") throw new Error("payload must be a string");
      payload = JSON.parse(envelope.payload);
      if (!isObject(payload)) throw new Error("payload must decode to an object");
    } catch {
      const error = new Error("Invalid business payload / 业务 payload 必须是 JSON 对象的字符串");
      if (directReply) this.settle(requestId, error);
      else this.abort(error); // 无法关联损坏通知，结束连接并清理全部等待
      return;
    }

    if (!directReply) requestId = payload.request_id;
    const entry = this.pending.get(requestId);
    if (!entry) return; // 过滤其他请求、迟到结果和重复完成通知

    try {
      if (payload.schema_version !== SCHEMA_VERSION) throw new Error("Unsupported schema_version");
      if (payload.request_id !== requestId) throw new Error("request_id mismatch");
      // 忽略未来增加的事件类型，不把未知事件误认为完成。
      if (!directReply && !["asset.ready", "task.completed", "task.failed"].includes(payload.event)) return;
      if (!isId(payload.task_id)) throw new Error("Missing task_id");
      if (entry.taskId && entry.taskId !== payload.task_id) throw new Error("task_id mismatch");
      entry.taskId = payload.task_id;

      if (type === TYPE.RESPONSE) {
        if (payload.status !== "accepted") throw new Error("Expected accepted response");
        clearTimeout(entry.ackTimer);
        this.onProgress({ kind: "accepted", operation: entry.operation, payload });
        return;
      }

      // 即使在 accepted 前看到关联的合法通知，也不丢弃它。
      clearTimeout(entry.ackTimer);
      if (payload.event === "asset.ready") {
        this.onProgress({ kind: "asset", operation: entry.operation, payload });
        return; // 图片就绪不是整个请求已完成
      }
      if (payload.event === "task.failed") {
        if (!isObject(payload.error)) throw new Error("Missing business error object");
        const error = new Error(entry.operation + ": " +
          (payload.error.code ?? "TASK_FAILED") + " / " + (payload.error.message ?? ""));
        error.layer = "business";
        error.details = payload.error; // 保留 provider/retryable/retry_at，供调用端判断
        this.settle(requestId, error);
        return;
      }
      if (!["success", "partial"].includes(payload.status) || !Object.hasOwn(payload, "result")) {
        throw new Error("Invalid task.completed status/result");
      }
      this.settle(requestId, null, payload);
    } catch (error) {
      this.settle(requestId, error);
    }
  }
}

// ── 4. 业务流程：顺序清楚，不在 message 回调中启动下一步 ───────────

/** 本 Demo 不修改偏好，也不把 sources.list 当成认证或安装 Provider 的入口。 */
export async function runDemo(client, options, log = console.log) {
  const tr = (en, zh) => options.lang === "zh-CN" ? zh : en;
  const showResult = (title, event) => {
    log(title + " [" + event.status + "]");
    log(JSON.stringify(event.result, null, 2)); // 原样显示来源、署名等信息
    if (event.status === "partial") {
      log(tr(
        "Partial snapshot received; this one-shot demo does not wait for later updates.",
        "已收到部分结果快照；本次查询不继续等待后续补充通知。"
      ));
    }
  };

  try {
    await client.connect();
    log(tr("Connected", "已连接"));

    // 第一步：列出数据源。request() 等待 task.completed，而非只等待 accepted。
    const sources = await client.request("sources.list");
    showResult(tr("Sources", "数据源列表"), sources);
    if (options.sourcesOnly) return;

    // 第二步：提交搜索。默认 image_mode=none，不下载图片。
    const query = buildSearchRequest(options);
    const search = await client.request("metadata.search", query.params, query.options);
    showResult(tr("Search result", "搜索结果"), search);
  } finally {
    // 无论成功、业务错误、解析失败还是超时，都执行清理。
    // 图片事件可能早于完成事件；完成后关闭连接，不保证接收迟到的图片通知。
    client.close();
  }
}

// ── 5. CLI 入口：日志、退出码和 Ctrl+C ─────────────────────────────

async function main() {
  let client;
  let interrupted = false;
  let shutdownTimer;
  const armShutdownGuard = () => {
    if (shutdownTimer) return;
    // 正常情况下 close 后自然退出。若底层连接握手挂住，最多再等 2 秒。
    // unref 使此保护定时器本身不阻止正常退出。
    shutdownTimer = setTimeout(() => process.exit(process.exitCode ?? 0), 2000);
    shutdownTimer.unref();
  };
  const onInterrupt = () => {
    interrupted = true;
    process.exitCode = 130;
    client?.close(); // 仅本地清理，不宣称取消了服务端任务
    armShutdownGuard();
  };
  process.once("SIGINT", onInterrupt);
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) { printUsage(options.lang); return; }
    const tr = (en, zh) => options.lang === "zh-CN" ? zh : en;
    client = new ZeroMetadataClient(options.url, {
      ...options,
      onProgress(event) {
        if (event.kind === "sent") console.log("> " + event.operation + " (" + event.requestId + ")");
        if (event.kind === "accepted") {
          console.log("< " + tr("accepted task", "已接收任务") + " " + event.payload.task_id);
        }
        if (event.kind === "asset") {
          console.log("< asset.ready");
          console.log(JSON.stringify(event.payload, null, 2));
        }
      },
    });
    await runDemo(client, options);
  } catch (error) {
    if (!interrupted) {
      console.error("Zero Bus demo failed / Demo 失败: " + error.message);
      if (error.details !== undefined) console.error(JSON.stringify(error.details, null, 2));
      process.exitCode = 1;
    }
  } finally {
    client?.close();
    process.removeListener("SIGINT", onInterrupt);
    if (client) armShutdownGuard();
  }
}

// 被测试或其他 .mjs 导入时不自动连接；只有直接执行文件才运行 CLI。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
