#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]


use arti_client::{TorClient, TorClientConfig};
use std::collections::HashMap;
use std::sync::Mutex as StdMutex;
use futures_util::SinkExt;
use futures_util::StreamExt;
use std::sync::Arc;
use std::time::Duration;

use tokio_tungstenite::tungstenite::Message;

/// Shared runtime state: the arti Tor client (stream-per-connection, no SOCKS
/// hop needed — we hand arti streams to TLS ourselves).
/// Global handle to the bootstrapped Tor client — read by every transport
/// command (relay queries, media fetches) once bootstrap completes.
static APP_TOR: tokio::sync::RwLock<Option<Arc<TorClient<tor_rtcompat::PreferredRuntime>>>> =
    tokio::sync::RwLock::const_new(None);

/// Desktop is Tor by construction: arti either bootstrapped (app runs) or the
/// app never started. No probe, no check.
///
/// Tor routing toggle: on (default) = all egress through arti; off = direct
/// TCP (for users whose anonymity comes from a VPN and who want speed).
static TOR_ENABLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

#[tauri::command]
fn tor_status() -> bool {
    true
}

#[tauri::command]
fn get_tor_enabled() -> bool {
    TOR_ENABLED.load(std::sync::atomic::Ordering::SeqCst)
}

#[tauri::command]
fn set_tor_enabled(enabled: bool) {
    TOR_ENABLED.store(enabled, std::sync::atomic::Ordering::SeqCst);
    eprintln!("[nostr.black] tor routing {}", if enabled { "ON" } else { "OFF (direct)" });
}

/// Combined read+write stream trait so both arti streams and TcpStreams box
/// into one type (blanket impl — no manual impls needed).
trait AnyIo: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send {}
impl<T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send> AnyIo for T {}
type AnyStream = Box<dyn AnyIo>;

fn tor_routing_enabled() -> bool {
    TOR_ENABLED.load(std::sync::atomic::Ordering::SeqCst)
}

/// Wait for the bootstrapped Tor client (used when routing is on).
async fn tor_client() -> Arc<TorClient<tor_rtcompat::PreferredRuntime>> {
    loop {
        let guard = APP_TOR.read().await;
        if let Some(c) = guard.as_ref() {
            return c.clone();
        }
        drop(guard);
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
}

/// Open a TCP-ish stream to host:port — through Tor (no local DNS) or direct.
async fn connect_stream(host: &str, port: u16) -> Result<AnyStream, String> {
    if tor_routing_enabled() {
        let client = tor_client().await;
        let s = client
            .connect((host, port))
            .await
            .map_err(|e| format!("tor connect: {e}"))?;
        Ok(Box::new(s))
    } else {
        let s = tokio::net::TcpStream::connect((host, port))
            .await
            .map_err(|e| format!("direct connect: {e}"))?;
        Ok(Box::new(s))
    }
}

/// host:port parsing shared by relay queries and media fetches.
fn parse_host_port(host_port: &str) -> (String, u16) {
    match host_port.rsplit_once(':') {
        Some((h, p)) => (h.to_string(), p.parse::<u16>().unwrap_or(443)),
        None => (host_port.to_string(), 443),
    }
}

#[derive(serde::Serialize)]
struct MediaPayload {
    mime: String,
    /// Raw bytes, base64-encoded — the IPC bridge carries JSON.
    data: String,
}

/// Media fetch for the webview: bytes over the current route (Tor or
/// direct), returned as mime + base64. The JS side turns it into a blob
/// URL; the webview itself never makes a network request.
#[tauri::command]
async fn fetch_asset(url: String) -> Result<MediaPayload, String> {
    let bytes = match http_get_media(&url).await {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[fetch_asset] {} failed: {e}", &url[..url.len().min(80)]);
            return Err(e);
        }
    };
    use base64::Engine as _;
    Ok(MediaPayload {
        mime: guess_content_type(&url).to_string(),
        data: base64::engine::general_purpose::STANDARD.encode(&bytes),
    })
}

/// Streaming relay bridge: JS owns the protocol (REQ/AUTH/EVENT/CLOSE, and
/// NIP-46) over a long-lived socket; Rust owns the bytes. One bridge instead
/// of per-feature commands — the same stream serves queries (with NIP-42
/// AUTH), publishes, and bunker connections.
#[derive(serde::Serialize, Clone)]
#[serde(tag = "type")]
enum StreamEvent {
    Frame { data: String },
    Closed { reason: Option<String> },
}

static STREAM_SEQ: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);
static STREAMS: std::sync::OnceLock<StdMutex<HashMap<u32, tokio::sync::mpsc::UnboundedSender<String>>>> =
    std::sync::OnceLock::new();

#[derive(serde::Serialize)]
struct StreamStart {
    id: u32,
    /// Route this stream actually uses — JS stamps per-event provenance.
    route: &'static str,
}

fn streams() -> &'static StdMutex<HashMap<u32, tokio::sync::mpsc::UnboundedSender<String>>> {
    STREAMS.get_or_init(|| StdMutex::new(HashMap::new()))
}

#[tauri::command]
async fn relay_stream_start(app: tauri::AppHandle, url: String) -> Result<StreamStart, String> {
    use tauri::Emitter;
    use tokio::sync::mpsc;

    let host_port = url
        .trim_start_matches("wss://")
        .trim_end_matches('/')
        .to_string();
    let (host, port) = parse_host_port(&host_port);
    let stream = connect_stream(&host, port).await?;
    let (mut ws, _resp) = tokio_tungstenite::client_async_tls_with_config(
        format!("wss://{host_port}/"),
        stream,
        None,
        None,
    )
    .await
    .map_err(|e| format!("ws handshake: {e}"))?;

    let id = STREAM_SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    streams().lock().unwrap().insert(id, tx);

    let map = streams();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                out = rx.recv() => match out {
                    Some(text) => {
                        if ws.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    None => break, // JS dropped the stream — close the socket
                },
                msg = ws.next() => match msg {
                    Some(Ok(Message::Text(text))) => {
                        let _ = app.emit(
                            &format!("relay://{id}"),
                            StreamEvent::Frame { data: text.to_string() },
                        );
                    }
                    Some(Ok(_)) => {}
                    Some(Err(e)) => {
                        let _ = app.emit(
                            &format!("relay://{id}"),
                            StreamEvent::Closed { reason: Some(e.to_string()) },
                        );
                        break;
                    }
                    None => {
                        let _ = app.emit(&format!("relay://{id}"), StreamEvent::Closed { reason: None });
                        break;
                    }
                },
            }
        }
        let _ = ws.close(None).await;
        map.lock().unwrap().remove(&id);
    });

    Ok(StreamStart { id, route: if tor_routing_enabled() { "tor" } else { "direct" } })
}

#[tauri::command]
fn relay_stream_send(id: u32, message: String) -> Result<(), String> {
    streams()
        .lock()
        .unwrap()
        .get(&id)
        .ok_or("stream not found")?
        .send(message)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn relay_stream_stop(id: u32) {
    // Dropping the sender closes the channel; the task closes the socket.
    streams().lock().unwrap().remove(&id);
}

async fn relay_query_inner(
    url: &str,
    filters: &serde_json::Value,
    timeout_ms: u64,
) -> Result<serde_json::Value, String> {
    let timeout = Duration::from_millis(timeout_ms);
    let url = url.to_string();
    // host:port from wss://host[:port]/
    let host_port = url
        .trim_start_matches("wss://")
        .trim_end_matches('/')
        .to_string();
    let (host, _port) = parse_host_port(&host_port);

    let stream = connect_stream(&host, _port).await?;

    // TLS + WebSocket over the arti stream.
    let ws_url = format!("wss://{host_port}/");
    let (mut ws, _resp) = tokio_tungstenite::client_async_tls_with_config(
        ws_url,
        stream,
        None,
        None,
    )
    .await
    .map_err(|e| format!("ws handshake: {e}"))?;

    // NIP-01 REQ: filters are spread as individual params, not nested.
    let mut req = serde_json::json!(["REQ", "q"]);
    if let Some(arr) = filters.as_array() {
        if let Some(params) = req.as_array_mut() {
            params.extend(arr.iter().cloned());
        }
    }
    if std::env::var("NB_DEBUG_FRAMES").is_ok() {
        eprintln!("[send] {req}");
    }
    ws.send(Message::Text(req.to_string().into())).await.map_err(|e| e.to_string())?;

    let mut events: Vec<serde_json::Value> = Vec::new();
    let deadline = tokio::time::sleep(timeout);
    tokio::pin!(deadline);

    loop {
        tokio::select! {
            _ = &mut deadline => break,
            msg = ws.next() => match msg {
                Some(Ok(Message::Text(text))) => {
                    if std::env::var("NB_DEBUG_FRAMES").is_ok() {
                        eprintln!("[frame] {}", &text[..text.len().min(300)]);
                    }
                    let frame: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
                    match frame.get(0).and_then(|v| v.as_str()) {
                        Some("EVENT") => {
                            if let Some(ev) = frame.get(2) {
                                events.push(ev.clone());
                            }
                        }
                        Some("EOSE") | Some("CLOSED") => break,
                        _ => {}
                    }
                }
                Some(Ok(_)) => {}
                Some(Err(e)) => return Err(format!("ws: {e}")),
                None => break,
            }
        }
    }

    let _ = ws.close(None).await;
    Ok(serde_json::Value::Array(events))
}

/// Extension-based content-type guess for fetched media bytes.
fn guess_content_type(url: &str) -> &'static str {
    let lower = url.to_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".avif") {
        "image/avif"
    } else if lower.ends_with(".mp4") {
        "video/mp4"
    } else if lower.ends_with(".webm") {
        "video/webm"
    } else {
        "image/jpeg"
    }
}

/// Media fetch over the current route (Tor or direct): TLS + minimal HTTP/1.1
/// GET, hard-capped at 30s — a stalled Tor stream must fail visibly, not
/// hang the caller forever.
async fn http_get_media(url: &str) -> Result<Vec<u8>, String> {
    tokio::time::timeout(
        std::time::Duration::from_secs(30),
        http_get_media_inner(url),
    )
    .await
    .map_err(|_| "media fetch timeout (30s)".to_string())?
}

async fn http_get_media_inner(url: &str) -> Result<Vec<u8>, String> {
    let stripped = url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .to_string();
    let (host, path) = match stripped.split_once('/') {
        Some((h, p)) => (h.to_string(), format!("/{p}")),
        None => (stripped, "/".to_string()),
    };
    let (host, port) = parse_host_port(&host);

    let stream = connect_stream(&host, port).await?;
    // TLS over the stream, then a minimal HTTP/1.0 GET — 1.0 so servers
    // can't use chunked transfer-encoding (we don't de-chunk; chunks would
    // corrupt image bytes). Connection: close lets read_to_end find the end.
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let connector = tokio_native_tls::TlsConnector::from(
        native_tls::TlsConnector::new().map_err(|e| e.to_string())?,
    );
    let mut tls = connector
        .connect(&host, stream)
        .await
        .map_err(|e| format!("tls: {e}"))?;
    let request = format!(
        "GET {path} HTTP/1.0\r\nHost: {host}\r\nUser-Agent: nostr-black\r\nConnection: close\r\n\r\n"
    );
    tls.write_all(request.as_bytes()).await.map_err(|e| e.to_string())?;

    let mut body = Vec::new();
    tls.read_to_end(&mut body).await.map_err(|e| e.to_string())?;
    // Split headers from body; reject non-2xx so broken images don't cache.
    if let Some(pos) = body.windows(4).position(|w| w == b"\r\n\r\n") {
        let head = String::from_utf8_lossy(&body[..pos]).to_string();
        let status = head.lines().next().unwrap_or_default().to_string();
        if !status.contains("200") {
            return Err(format!("http status: {status}"));
        }
        body.drain(..pos + 4);
        Ok(body)
    } else {
        Err("http response had no header terminator".into())
    }
}

/// Headless transport self-test: `nostr-black --selftest <wss-url>`
/// Runs one relay query through arti and prints the event count — no GUI.
/// Used to verify Tor routing end-to-end and for the kill-tor offline test.
async fn selftest(url: &str) -> Result<(), String> {
    let config = TorClientConfig::default();
    eprintln!("[selftest] bootstrapping tor…");
    let client = TorClient::create_bootstrapped(config)
        .await
        .map_err(|e| format!("bootstrap: {e}"))?;
    *APP_TOR.write().await = Some(Arc::new(client));
    eprintln!("[selftest] tor up; querying {url}");
    let filters = serde_json::json!([{ "kinds": [1], "limit": 5 }]);
    let events = relay_query_inner(url, &filters, 30_000).await?;
    eprintln!("[selftest] got {} events through tor", events.as_array().map(|a| a.len()).unwrap_or(0));
    for e in events.as_array().unwrap_or(&vec![]).iter().take(3) {
        eprintln!("[selftest]   kind={} pubkey={}", e["kind"], e["pubkey"].as_str().unwrap_or("?")[..8.min(70)].to_string());
    }
    Ok(())
}

/// Headless media-fetch test: `nostr-black --fetchtest <https-url>`
/// Verifies the torasset pipeline (TLS + HTTP GET over arti) end-to-end.
async fn fetchtest(url: &str) -> Result<(), String> {
    let config = TorClientConfig::default();
    eprintln!("[fetchtest] bootstrapping tor…");
    let client = TorClient::create_bootstrapped(config)
        .await
        .map_err(|e| format!("bootstrap: {e}"))?;
    *APP_TOR.write().await = Some(Arc::new(client));
    eprintln!("[fetchtest] tor up; fetching {url}");
    let body = http_get_media(url).await?;
    eprintln!("[fetchtest] got {} bytes, head: {:?}",
        body.len(),
        String::from_utf8_lossy(&body[..body.len().min(80)]));
    Ok(())
}

fn main() {
    // Debug override (like NB_DEBUG_FRAMES): NB_DIRECT=1 boots with Tor
    // routing off — headless way to exercise the direct transport.
    if std::env::var("NB_DIRECT").is_ok() {
        TOR_ENABLED.store(false, std::sync::atomic::Ordering::SeqCst);
        eprintln!("[nostr.black] NB_DIRECT: routing without tor");
    }
    // Headless self-test: `--selftest wss://…`
    let args: Vec<String> = std::env::args().collect();
    if let Some(idx) = args.iter().position(|a| a == "--selftest") {
        let url = args.get(idx + 1).cloned().unwrap_or_else(|| "wss://relay.damus.io/".into());
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(selftest(&url));
        std::process::exit(match result {
            Ok(()) => 0,
            Err(e) => {
                eprintln!("[selftest] FAILED: {e}");
                1
            }
        });
    }
    // Headless media test: `--fetchtest https://…`
    if let Some(idx) = args.iter().position(|a| a == "--fetchtest") {
        let url = args.get(idx + 1).cloned().unwrap_or_else(|| "https://example.com/".into());
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(fetchtest(&url));
        std::process::exit(match result {
            Ok(()) => 0,
            Err(e) => {
                eprintln!("[fetchtest] FAILED: {e}");
                1
            }
        });
    }

    // Panics in the bootstrap thread must be visible, not silent thread death.
    std::panic::set_hook(Box::new(|info| {
        eprintln!("[nostr.black] panic: {info}");
    }));
    eprintln!("[nostr.black] starting, bootstrapping tor…");
    tauri::Builder::default()
        // Remember window position/size across restarts (official plugin).
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .setup(|_app| {
            // Bootstrap on tauri's async runtime — it must outlive the client.
            // A thread-local runtime would be dropped when the thread exits,
            // killing arti's background tasks and leaving a dead client.
            tauri::async_runtime::spawn(async move {
                let config = arti_client::TorClientConfig::default();
                eprintln!("[nostr.black] arti config ready, bootstrapping…");
                match TorClient::create_bootstrapped(config).await {
                    Ok(client) => {
                        eprintln!("[nostr.black] tor bootstrapped");
                        *APP_TOR.write().await = Some(Arc::new(client));
                    }
                    Err(e) => {
                        eprintln!("[nostr.black] tor bootstrap FAILED: {e}");
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tor_status,
            get_tor_enabled,
            set_tor_enabled,
            fetch_asset,
            relay_stream_start,
            relay_stream_send,
            relay_stream_stop
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
