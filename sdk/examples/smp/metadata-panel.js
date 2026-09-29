// Spider Monkey Panel example using the existing SMP WebSocket bridge and
// the same Zero Bus envelope protocol as browser and Node.js clients.
window.DefineScript("foo_zero_metadata SDK example", { author: "foo_zero_metadata", version: "1.0" });

var ws = null;
var requestMap = {};
var logLines = ["foo_zero_metadata SMP example", "Transport: Zero Bus WebSocket · ws://127.0.0.1:17890"];

function log(value) {
    logLines.push(typeof value === "string" ? value : JSON.stringify(value, null, 2));
    window.Repaint();
}

function request(operation, params, options) {
    if (!ws || ws.readyState !== 1) return log("Connect to Zero Bus first.");
    var id = "smp-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    var business = { schema_version: 1, operation: operation, params: params || {}, options: options || {} };
    requestMap[id] = { operation: operation, taskId: "", keepForRefresh: false };
    ws.send(JSON.stringify({ sender: "sdk.smp", receiver: "plugin.zero_metadata", type: 1,
        msg_id: id, correlation_id: "", payload: JSON.stringify(business) }));
    log({ request_id: id, request: business });
}

function connectZeroBus(port) {
    if (typeof WebSocket !== "function") {
        log("SMP WebSocket bridge is unavailable. Enable the existing bridge and expose its standard WebSocket client API.");
        return;
    }
    ws = new WebSocket("ws://127.0.0.1:" + (port || 17890));
    ws.onopen = function () { log("Connected to Zero Bus"); request("sources.list", {}, {}); };
    ws.onmessage = function (event) {
        var envelope = JSON.parse(event.data);
        var payload = typeof envelope.payload === "string" ? JSON.parse(envelope.payload) : envelope.payload;
        log({ envelope: envelope, payload: payload });
        if (envelope.type === 2 && payload.request_id && requestMap[payload.request_id])
            requestMap[payload.request_id].taskId = payload.task_id;
        if (envelope.type !== 4 || !payload) return;
        var entry = requestMap[payload.request_id];
        if (payload.event === "asset.ready") {
            // Refresh only the artwork identified by payload.asset_id, then repaint this panel.
            window.NotifyOthers("foo_zero_metadata.asset.ready", payload);
        } else if (payload.event === "task.completed") {
            log(payload.result);
            if (entry && payload.result && payload.result.cache && payload.result.cache.refresh_pending === true)
                entry.keepForRefresh = true;
            else delete requestMap[payload.request_id];
            if (payload.result && payload.result.match_status === "ambiguous")
                log("Present candidates.artists/albums and repeat metadata.search with the chosen MBID and confirm_identity=true.");
        } else if (payload.event === "metadata.refreshed") {
            log(payload.result || payload.error);
            delete requestMap[payload.request_id];
        } else if (payload.event === "task.failed") delete requestMap[payload.request_id];
    };
    ws.onerror = function (error) { log("WebSocket error: " + error); };
    ws.onclose = function () { log("Disconnected"); ws = null; };
}

function on_paint(gr) {
    var y = 8;
    gr.GdiDrawText("foo_zero_metadata · SMP WebSocket demo", window.GetFontDUI(0), window.GetColourDUI(0), 8, y, window.Width - 16, 24, 0); y += 28;
    gr.GdiDrawText("Call connectZeroBus(17890) from the SMP console. Add your UI controls to call request().", window.GetFontDUI(0), window.GetColourDUI(0), 8, y, window.Width - 16, 40, 0); y += 44;
    for (var i = Math.max(0, logLines.length - 14); i < logLines.length; i++) {
        gr.GdiDrawText(logLines[i], window.GetFontDUI(0), window.GetColourDUI(0), 8, y, window.Width - 16, 38, 0);
        y += 40;
    }
}

function on_script_unload() { if (ws) ws.close(); }
