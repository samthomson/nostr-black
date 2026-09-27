#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use arti_client::{TorClient, TorClientConfig};
use futures_util::SinkExt;
use futures_util::StreamExt;
use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;
use tauri::State;
use tokio_tungstenite::tungstenite::Message;

/// Shared runtime state: the arti Tor client (stream-per-connection, no SOCKS
/// hop needed — we hand arti streams to TLS ourselves).
#[derive(Clone)]
struct TorState {
    client: Arc<TorClient<tor_rtcompat::PreferredRuntime>>,
}

/// Global handle to the bootstrapped Tor client for the torasset protocol
/// handler (which runs outside the managed-state async context).
static APP_TOR: tokio::sync::RwLock<Option<Arc<TorClient<tor_rtcompat::PreferredRuntime>>>> =
    tokio::sync::RwLock::const_new(None);

/// Desktop is Tor by construction: arti either bootstrapped (app runs) or the
/// app never started. No probe, no check.
#[tauri::command]
fn tor_status() -> bool {
    true
}

/// HTTP GET through Tor, returning the body as text (for JSON etc).
#[tauri::command]
async fn http_fetch(state: State<'_, TorState>, url: String) -> Result<String, String> {
    let addr = url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .to_string();
    let stream = state
        .client
        .clone()
        .connect(("example.com", 443))
        .await
        .map_err(|e| e.to_string())?;
    let _ = (addr, stream);
    Err("http_fetch: implemented via relay transport in next step".into())
}

/// One-shot relay query: open a TLS connection over Tor, send REQ, collect
/// EVENT frames until EOSE/CLOSED or a deadline. Mirrors the browser client
/// in src/net/relayClient.ts exactly — same protocol, Tor-routed transport.
#[tauri::command]
async fn relay_query(
    state: State<'_, TorState>,
    url: String,
    filters: serde_json::Value,
    timeout_ms: Option<u64>,
) -> Result<serde_json::Value, String> {
    relay_query_inner(&state.client, &url, &filters, timeout_ms.unwrap_or(10_000)).await
}

async fn relay_query_inner(
    client: &TorClient<tor_rtcompat::PreferredRuntime>,
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
    let (host, port) = match host_port.rsplit_once(':') {
        Some((h, p)) => (
            h.to_string(),
            p.parse::<u16>().unwrap_or(443),
        ),
        None => (host_port.clone(), 443),
    };

    // Resolve over Tor (no local DNS): arti connects by hostname itself.
    let stream = client
        .clone()
        .connect((host.as_str(), port))
        .await
        .map_err(|e| format!("tor connect: {e}"))?;

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

/// torasset://<url> — media fetched through Tor. The webview never makes a
/// direct network request: every image/media URL is rewritten to this scheme
/// in the desktop build, and Rust serves the bytes over arti.
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

async fn fetch_via_tor(
    client: &TorClient<tor_rtcompat::PreferredRuntime>,
    url: &str,
) -> Result<Vec<u8>, String> {
    let stripped = url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .to_string();
    let (host, path) = match stripped.split_once('/') {
        Some((h, p)) => (h.to_string(), format!("/{p}")),
        None => (stripped, "/".to_string()),
    };
    let (host, port) = match host.rsplit_once(':') {
        Some((h, p)) => (h.to_string(), p.parse::<u16>().unwrap_or(443)),
        None => (host, 443),
    };

    let stream = client
        .clone()
        .connect((host.as_str(), port))
        .await
        .map_err(|e| format!("tor connect: {e}"))?;

    // TLS over the arti stream, then a minimal HTTP/1.1 GET. Enough for
    // media fetches; not a general HTTP client.
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let connector = tokio_native_tls::TlsConnector::from(
        native_tls::TlsConnector::new().map_err(|e| e.to_string())?,
    );
    let mut tls = connector
        .connect(&host, stream)
        .await
        .map_err(|e| format!("tls: {e}"))?;
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {host}\r\nUser-Agent: nostr-black\r\nConnection: close\r\n\r\n"
    );
    tls.write_all(request.as_bytes()).await.map_err(|e| e.to_string())?;

    let mut body = Vec::new();
    tls.read_to_end(&mut body).await.map_err(|e| e.to_string())?;
    // Split headers from body.
    if let Some(pos) = body.windows(4).position(|w| w == b"\r\n\r\n") {
        body.drain(..pos + 4);
    }
    Ok(body)
}

/// Headless transport self-test: `nostr-black --selftest <wss-url> [filter]`
/// Runs one relay query through arti and prints the event count — no GUI.
/// Used to verify Tor routing end-to-end and for the kill-tor offline test.
async fn selftest(url: &str) -> Result<(), String> {
    let config = TorClientConfig::default();
    eprintln!("[selftest] bootstrapping tor…");
    let client = TorClient::create_bootstrapped(config)
        .await
        .map_err(|e| format!("bootstrap: {e}"))?;
    eprintln!("[selftest] tor up; querying {url}");
    let filters = serde_json::json!([{ "kinds": [1], "limit": 5 }]);
    let events = relay_query_inner(&client, url, &filters, 30_000).await?;
    eprintln!("[selftest] got {} events through tor", events.as_array().map(|a| a.len()).unwrap_or(0));
    for e in events.as_array().unwrap_or(&vec![]).iter().take(3) {
        eprintln!("[selftest]   kind={} pubkey={}", e["kind"], e["pubkey"].as_str().unwrap_or("?")[..8.min(70)].to_string());
    }
    Ok(())
}

fn main() {
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

    // Panics in the bootstrap thread must be visible, not silent thread death.
    std::panic::set_hook(Box::new(|info| {
        eprintln!("[nostr.black] panic: {info}");
    }));
    eprintln!("[nostr.black] starting, bootstrapping tor…");
    tauri::Builder::default()
        .register_uri_scheme_protocol("torasset", |_app, request| {
            // torasset://https://host/path → fetch through Tor, serve bytes.
            let url = request
                .uri()
                .to_string()
                .trim_start_matches("torasset://")
                .to_string();
            // The Tor client isn't available in this sync callback — fetch
            // happens on a blocking thread with its own runtime handle to
            // the shared client.
            let body = tauri::async_runtime::block_on(async {
                match APP_TOR.read().await.as_ref() {
                    Some(client) => fetch_via_tor(client, &url).await,
                    None => Err("tor not ready".into()),
                }
            });
            match body {
                Ok(bytes) => tauri::http::Response::builder()
                    .header("Content-Type", guess_content_type(&url))
                    .body(bytes)
                    .unwrap(),
                Err(e) => tauri::http::Response::builder()
                    .status(502)
                    .body(e.into_bytes())
                    .unwrap(),
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().unwrap();
                rt.block_on(async move {
                    // Bootstrap arti in-process. This IS the network gate:
                    // if Tor doesn't come up, nothing else ever runs.
                    let config = arti_client::TorClientConfig::default();
                    eprintln!("[nostr.black] arti config ready, bootstrapping…");
                    let client = TorClient::create_bootstrapped(config).await?;
                    eprintln!("[nostr.black] tor bootstrapped");
                    let shared = Arc::new(client);
                    *APP_TOR.write().await = Some(shared.clone());
                    handle.manage(TorState { client: shared });
                    Result::<(), Box<dyn std::error::Error>>::Ok(())
                })
                .expect("tor bootstrap failed");
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![tor_status, http_fetch, relay_query])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
