# Spider Monkey Panel 示例

`metadata-panel.js` 使用现有 SMP WebSocket 桥接，以 Zero Bus 标准 WebSocket 信封接入。它展示了业务请求封装，以及 `task.completed`、`metadata.refreshed`、候选身份和 `asset.ready` 的事件处理方式。

## 运行条件

请先在 SMP 中启用现有 WebSocket 桥接，使脚本可用标准 `WebSocket` 客户端 API。示例直接连接本机 Zero Bus 的 WebSocket 端口，不使用 SMP 专有的业务协议，也不需要额外的转换服务。浏览器端示例见 `../zero_ui_panel/index.html`。

在 SMP 脚本控制台调用 `connectZeroBus(17890)`，然后调用：

~~~js
request("metadata.search", {
  artist: { name: "Radiohead" },
  album: { title: "OK Computer" }
}, { search_mode: "preferred_sources", image_mode: "discover" });
~~~

收到 `asset.ready` 后示例通过 `window.NotifyOthers` 广播资产信息；宿主可以按 `asset_id` 刷新对应图片。异步聚合刷新持续到 `metadata.refreshed` 才结束关联记录。
