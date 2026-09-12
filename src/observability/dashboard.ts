export function diagnosticsDashboard(websocketPort: number): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>DataBridge diagnostics</title>
  <style>
    :root { color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; background:#0d1117; color:#d7e0ea }
    * { box-sizing:border-box } body { margin:0; padding:24px; max-width:1500px; margin-inline:auto }
    h1,h2 { margin:0 0 14px; font-weight:650 } h1 { font-size:24px } h2 { font-size:16px }
    .muted { color:#8b98a8 } .banner { padding:10px 14px; margin:16px 0; border:1px solid #303b49; border-radius:8px }
    .banner.active { color:#ffcc66; border-color:#8b6214; background:#251c08 }
    .metrics,.layout { display:grid; gap:12px } .metrics { grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); margin:16px 0 }
    .layout { grid-template-columns:repeat(auto-fit,minmax(360px,1fr)) }
    .card { background:#151b23; border:1px solid #29313d; border-radius:10px; padding:16px; overflow:auto }
    .metric strong { display:block; font-size:25px; color:#7ee787; margin-top:6px }
    label { display:grid; gap:5px; margin:9px 0; color:#aeb9c5 } input,select,textarea,button {
      font:inherit; color:inherit; background:#0d1117; border:1px solid #3a4655; border-radius:6px; padding:8px
    }
    textarea { width:100%; min-height:110px; resize:vertical } button { cursor:pointer; background:#1f6feb; border-color:#1f6feb }
    button.secondary { background:#30363d; border-color:#484f58 } .row { display:flex; gap:8px; align-items:end; flex-wrap:wrap }
    .row label { flex:1; min-width:110px } table { width:100%; border-collapse:collapse; font-size:12px }
    th,td { text-align:left; padding:8px; border-bottom:1px solid #29313d; vertical-align:top } th { color:#8b98a8 }
    pre { white-space:pre-wrap; word-break:break-word; background:#0d1117; padding:10px; border-radius:6px; min-height:42px }
    .state { font-weight:700 } .ONLINE { color:#7ee787 } .ERROR,.TIMEOUT { color:#ff7b72 } .RETRYING,.CONNECTING { color:#ffcc66 }
    details { margin-top:5px } summary { cursor:pointer } @media(max-width:600px){body{padding:12px}.layout{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <h1>DataBridge diagnostics</h1>
  <div class="muted">live connection state, events, messages and controlled failure simulation</div>
  <div id="sandbox-banner" class="banner">simulation disabled</div>
  <section id="metrics" class="metrics"></section>
  <div class="layout">
    <section class="card">
      <h2>connections</h2>
      <div id="connections"></div>
    </section>
    <section class="card">
      <h2>protocol sandbox</h2>
      <label><span><input id="sandbox-enabled" type="checkbox"> simulation enabled</span></label>
      <div class="row">
        <label>latency ms<input id="latency" type="number" min="0" max="60000"></label>
        <label>timeout ms<input id="timeout" type="number" min="0" max="60000"></label>
        <label>loss %<input id="loss" type="number" min="0" max="100" step="1"></label>
      </div>
      <label><span><input id="interrupt" type="checkbox"> interrupt next message</span></label>
      <div class="row"><button id="save-sandbox">apply</button><button id="reset-sandbox" class="secondary">disable / reset</button></div>
      <pre id="sandbox-result"></pre>
    </section>
    <section class="card">
      <h2>WebSocket debugger</h2>
      <label>type<input id="message-type" value="temperature"></label>
      <label>payload<textarea id="payload">{ "value": 24.8, "humidity": 41 }</textarea></label>
      <button id="send-message">send test message</button>
      <pre id="debug-result">ready</pre>
    </section>
  </div>
  <section class="card" style="margin-top:12px">
    <h2>events</h2>
    <div class="row">
      <label>category<select id="category"><option value="all">all</option><option>connection</option><option>message</option><option>error</option><option>retry</option><option>sandbox</option><option>system</option></select></label>
      <label>search<input id="search" placeholder="client, event, details"></label>
    </div>
    <div id="events"></div>
  </section>
<script>
const wsPort = ${JSON.stringify(websocketPort)};
const byId = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
let initializedSandbox = false;

async function request(path, options) {
  const response = await fetch(path, options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'request failed');
  return value;
}
function renderMetrics(metrics) {
  const labels = { connectedDevices:'connected devices', activeConnections:'active connections', messagesReceived:'messages received',
    messagesSent:'messages sent', errors:'errors', reconnects:'reconnects', averageLatencyMs:'average latency ms' };
  byId('metrics').innerHTML = Object.entries(labels).map(([key,label]) =>
    '<div class="card metric"><span class="muted">'+esc(label)+'</span><strong>'+esc(metrics[key] ?? 'n/a')+'</strong></div>'
  ).join('');
}
function renderConnections(connections) {
  if (!connections.length) { byId('connections').innerHTML = '<span class="muted">no connections observed</span>'; return; }
  byId('connections').innerHTML = '<table><thead><tr><th>client</th><th>protocol</th><th>state</th><th>history</th></tr></thead><tbody>' +
    connections.map((connection) => '<tr><td>'+esc(connection.id)+'</td><td>'+esc(connection.protocol)+'</td><td class="state '+esc(connection.state)+'">'+esc(connection.state)+'</td><td><details><summary>'+connection.transitions.length+' transitions</summary>'+
      connection.transitions.slice().reverse().map((item) => '<div>'+esc(item.timestamp.slice(11,19))+' '+esc(item.from || 'UNKNOWN')+' -> '+esc(item.to)+' · '+esc(item.trigger)+'</div>').join('')+
      '</details></td></tr>').join('') + '</tbody></table>';
}
function renderEvents(events) {
  if (!events.length) { byId('events').innerHTML = '<span class="muted">no matching events</span>'; return; }
  byId('events').innerHTML = '<table><thead><tr><th>time</th><th>category</th><th>client</th><th>protocol</th><th>event</th><th>details</th></tr></thead><tbody>' +
    events.map((event) => '<tr><td>'+esc(event.timestamp.slice(11,23))+'</td><td>'+esc(event.category)+'</td><td>'+esc(event.clientId || '—')+'</td><td>'+esc(event.protocol)+'</td><td>'+esc(event.message)+'</td><td><details><summary>'+esc(event.type)+'</summary><pre>'+esc(event.details === undefined ? '' : JSON.stringify(event.details,null,2))+'</pre></details></td></tr>').join('') +
    '</tbody></table>';
}
function renderSandbox(sandbox) {
  const banner = byId('sandbox-banner');
  banner.className = sandbox.enabled ? 'banner active' : 'banner';
  banner.textContent = sandbox.enabled
    ? 'simulation active · latency '+sandbox.latencyMs+' ms · loss '+Math.round(sandbox.lossRate*100)+'% · timeout '+sandbox.timeoutMs+' ms'+(sandbox.interruptNext?' · interruption armed':'')
    : 'simulation disabled';
  if (!initializedSandbox) {
    byId('sandbox-enabled').checked = sandbox.enabled;
    byId('latency').value = sandbox.latencyMs;
    byId('timeout').value = sandbox.timeoutMs;
    byId('loss').value = sandbox.lossRate * 100;
    byId('interrupt').checked = sandbox.interruptNext;
    initializedSandbox = true;
  }
}
async function refresh() {
  try {
    const category = byId('category').value;
    const search = byId('search').value;
    const snapshot = await request('/diagnostics/api/snapshot?category='+encodeURIComponent(category)+'&search='+encodeURIComponent(search)+'&limit=200');
    renderMetrics(snapshot.metrics); renderConnections(snapshot.connections); renderEvents(snapshot.events); renderSandbox(snapshot.sandbox);
  } catch (error) { byId('sandbox-banner').textContent = error.message; }
}
byId('save-sandbox').onclick = async () => {
  try {
    const sandbox = await request('/diagnostics/api/sandbox', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
      enabled:byId('sandbox-enabled').checked, latencyMs:Number(byId('latency').value), timeoutMs:Number(byId('timeout').value),
      lossRate:Number(byId('loss').value)/100, interruptNext:byId('interrupt').checked
    })});
    initializedSandbox = false; renderSandbox(sandbox); byId('sandbox-result').textContent='saved'; await refresh();
  } catch (error) { byId('sandbox-result').textContent=error.message; }
};
byId('reset-sandbox').onclick = async () => {
  try { await request('/diagnostics/api/sandbox/reset',{method:'POST'}); initializedSandbox=false; byId('sandbox-result').textContent='reset'; await refresh(); }
  catch (error) { byId('sandbox-result').textContent=error.message; }
};
byId('send-message').onclick = () => {
  let payload;
  try { payload=JSON.parse(byId('payload').value); } catch (error) { byId('debug-result').textContent='invalid JSON: '+error.message; return; }
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(scheme+'//'+location.hostname+':'+wsPort+'/?clientId=diagnostics-debugger');
  byId('debug-result').textContent='connecting';
  socket.onopen = () => { byId('debug-result').textContent='sent'; socket.send(JSON.stringify({type:byId('message-type').value,payload,test:true})); };
  socket.onmessage = (event) => { byId('debug-result').textContent=event.data; socket.close(); refresh(); };
  socket.onerror = () => { byId('debug-result').textContent='WebSocket error'; };
  socket.onclose = (event) => { if (!event.wasClean) byId('debug-result').textContent='closed: '+event.code+' '+event.reason; };
};
byId('category').onchange=refresh;
let searchTimer;
byId('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(refresh,250)};
refresh(); setInterval(refresh,1500);
</script>
</body>
</html>`;
}
