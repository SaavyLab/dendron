//! SSH tunnel — local port forwarding to a remote database host.
//!
//! No Tauri deps. No system `ssh` binary required.
//! Uses russh 0.57 which bundles its own key handling via `russh::keys`.

use std::sync::Arc;
use tokio::io::copy_bidirectional;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::config::{SshAuth, SshConfig};
use crate::error::{AppError, Result};

/// A live SSH tunnel that forwards `127.0.0.1:local_port` → `remote_host:remote_port`.
///
/// Dropping cancels the forwarder task; russh's built-in keepalive closes the SSH
/// session cleanly after the last channel drains.
pub struct SshTunnel {
    pub local_port: u16,
    shutdown: CancellationToken,
    _forwarder: tokio::task::JoinHandle<()>,
}

impl SshTunnel {
    /// Connect to the SSH host, authenticate, bind a random local port, and
    /// start a background forwarder that opens a `direct-tcpip` channel for
    /// every TCP connection sqlx makes to `127.0.0.1:local_port`.
    pub async fn establish(
        config: &SshConfig,
        remote_host: &str,
        remote_port: u16,
    ) -> Result<Self> {
        // russh handles keepalives natively via Config
        let russh_config = Arc::new(russh::client::Config {
            keepalive_interval: Some(std::time::Duration::from_secs(30)),
            keepalive_max: 3,
            ..Default::default()
        });

        let handler = ClientHandler {
            host_str: format!("{}:{}", config.host, config.port),
        };

        let mut session = russh::client::connect(
            russh_config,
            (config.host.as_str(), config.port),
            handler,
        )
        .await
        .map_err(|e| AppError::SshConnectionFailed(e.to_string()))?;

        let ok = authenticate(&mut session, &config.auth, &config.username).await?;
        if !ok {
            return Err(AppError::SshAuthFailed(
                "All authentication methods exhausted".to_string(),
            ));
        }

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| AppError::SshTunnelFailed(e.to_string()))?;
        let local_port = listener
            .local_addr()
            .map_err(|e| AppError::SshTunnelFailed(e.to_string()))?
            .port();

        let session = Arc::new(Mutex::new(session));
        let shutdown = CancellationToken::new();

        let remote_host = remote_host.to_string();
        let session_fwd = Arc::clone(&session);
        let shutdown_fwd = shutdown.clone();

        let _forwarder = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = shutdown_fwd.cancelled() => break,
                    res = listener.accept() => {
                        match res {
                            Ok((stream, _)) => {
                                let sess = Arc::clone(&session_fwd);
                                let rh = remote_host.clone();
                                tokio::spawn(async move {
                                    if let Err(e) = forward(sess, stream, &rh, remote_port).await {
                                        eprintln!("SSH tunnel forward error: {e}");
                                    }
                                });
                            }
                            Err(e) => {
                                eprintln!("SSH tunnel accept error: {e}");
                                break;
                            }
                        }
                    }
                }
            }
        });

        Ok(SshTunnel {
            local_port,
            shutdown,
            _forwarder,
        })
    }
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        self.shutdown.cancel();
    }
}

// ── Authentication ─────────────────────────────────────────────────────────────

async fn authenticate(
    session: &mut russh::client::Handle<ClientHandler>,
    auth: &SshAuth,
    username: &str,
) -> Result<bool> {
    match auth {
        SshAuth::Agent => authenticate_agent(session, username).await,
        SshAuth::Key { key_path, passphrase } => {
            authenticate_key(session, username, key_path, passphrase.as_ref()).await
        }
    }
}

async fn authenticate_agent(
    session: &mut russh::client::Handle<ClientHandler>,
    username: &str,
) -> Result<bool> {
    use russh::keys::agent::client::AgentClient;

    let mut agent = AgentClient::connect_env()
        .await
        .map_err(|e| AppError::SshAuthFailed(format!("SSH agent connect failed: {e}")))?;

    let identities = agent
        .request_identities()
        .await
        .map_err(|e| AppError::SshAuthFailed(format!("SSH agent list identities: {e}")))?;

    for pubkey in identities {
        let hash = session
            .best_supported_rsa_hash()
            .await
            .map_err(|e| AppError::SshAuthFailed(e.to_string()))?
            .flatten();

        // AgentClient implements russh::Signer, so it can sign the auth challenge
        let result = session
            .authenticate_publickey_with(username, pubkey, hash, &mut agent)
            .await
            .map_err(|e| AppError::SshAuthFailed(e.to_string()))?;

        if result.success() {
            return Ok(true);
        }
    }

    Ok(false)
}

async fn authenticate_key(
    session: &mut russh::client::Handle<ClientHandler>,
    username: &str,
    key_path: &str,
    passphrase: Option<&crate::security::EncryptedPassword>,
) -> Result<bool> {
    let passphrase_str = passphrase
        .map(|p| p.decrypt())
        .transpose()
        .map_err(|e| AppError::SshAuthFailed(format!("Could not decrypt SSH passphrase: {e}")))?;

    let key = russh::keys::load_secret_key(
        std::path::Path::new(key_path),
        passphrase_str.as_deref(),
    )
    .map_err(|e| AppError::SshAuthFailed(format!("Could not load key {key_path}: {e}")))?;

    let hash = session
        .best_supported_rsa_hash()
        .await
        .map_err(|e| AppError::SshAuthFailed(e.to_string()))?
        .flatten();

    let key_with_hash = russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key), hash);

    let result = session
        .authenticate_publickey(username, key_with_hash)
        .await
        .map_err(|e| AppError::SshAuthFailed(e.to_string()))?;

    Ok(result.success())
}

// ── Forwarding ─────────────────────────────────────────────────────────────────

async fn forward(
    session: Arc<Mutex<russh::client::Handle<ClientHandler>>>,
    mut tcp: TcpStream,
    remote_host: &str,
    remote_port: u16,
) -> Result<()> {
    // Lock only long enough to open the channel; release before copying.
    let channel = {
        let s = session.lock().await;
        s.channel_open_direct_tcpip(remote_host, remote_port as u32, "127.0.0.1", 0)
            .await
            .map_err(|e| AppError::SshTunnelFailed(e.to_string()))?
    };

    let mut chan_stream = channel.into_stream();
    copy_bidirectional(&mut tcp, &mut chan_stream)
        .await
        .map_err(|e| AppError::SshTunnelFailed(e.to_string()))?;

    Ok(())
}

// ── Host-key verification (AcceptNew policy) ───────────────────────────────────

struct ClientHandler {
    /// `"host:port"` string used as the key in `known_hosts`.
    host_str: String,
}

impl russh::client::Handler for ClientHandler {
    type Error = AppError;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKey,
    ) -> std::result::Result<bool, Self::Error> {
        check_known_hosts(&self.host_str, server_public_key)
    }
}

/// AcceptNew host-key policy:
/// - Unknown host → write key to `known_hosts`, accept.
/// - Known host, matching key → accept.
/// - Known host, different key → `SshHostKeyMismatch` error.
fn check_known_hosts(host_str: &str, server_key: &russh::keys::PublicKey) -> Result<bool> {
    use std::io::{BufRead, Write};

    let known_hosts_path = crate::config::Config::config_dir()
        .ok_or(AppError::ConfigDirNotFound)?
        .join("known_hosts");

    // to_openssh() → "ssh-ed25519 AAAA... comment" — we use the first two fields.
    let openssh = server_key
        .to_openssh()
        .map_err(|e| AppError::SshConnectionFailed(format!("Failed to encode server key: {e}")))?;
    let mut parts = openssh.splitn(3, ' ');
    let key_type = parts.next().unwrap_or("");
    let key_b64 = parts.next().unwrap_or("");

    if known_hosts_path.exists() {
        let f = std::fs::File::open(&known_hosts_path)?;
        for line in std::io::BufReader::new(f).lines() {
            let line = line?;
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let mut parts = line.splitn(3, ' ');
            let stored_host = parts.next().unwrap_or("");
            if stored_host != host_str {
                continue;
            }
            let stored_type = parts.next().unwrap_or("");
            let stored_key = parts.next().unwrap_or("");
            if stored_type == key_type && stored_key == key_b64 {
                return Ok(true);
            } else {
                return Err(AppError::SshHostKeyMismatch(host_str.to_string()));
            }
        }
    }

    // First time seeing this host — AcceptNew: persist and approve.
    if let Some(parent) = known_hosts_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&known_hosts_path)?;
    writeln!(f, "{host_str} {key_type} {key_b64}")?;

    Ok(true)
}
