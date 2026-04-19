//! Local CA lifecycle: load an existing Reflex CA from disk, or generate one.
//!
//! The CA public cert is also written in a form ready for installation into
//! the macOS System keychain by `scripts/install-hooks.sh`.

use anyhow::{Context, Result};
use hudsucker::rcgen::{Issuer, KeyPair};
use rcgen::{
    BasicConstraints, CertificateParams, DistinguishedName, DnType, IsCa, KeyUsagePurpose,
};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};
use time::{Duration, OffsetDateTime};

pub struct LoadedCa {
    /// Issuer configured for hudsucker's `RcgenAuthority`.
    pub issuer: Issuer<'static, KeyPair>,
    /// On-disk path to the public PEM (for keychain install).
    pub cert_path: PathBuf,
    /// Hex SHA-256 fingerprint of the DER cert.
    pub fingerprint_sha256: String,
}

const CERT_FILE: &str = "reflex-ca.pem";
const KEY_FILE: &str = "reflex-ca.key";

/// Load CA from `dir`, generating + persisting one if missing.
pub fn ensure_ca(dir: &Path) -> Result<LoadedCa> {
    fs::create_dir_all(dir).with_context(|| format!("creating CA dir {dir:?}"))?;

    let cert_path = dir.join(CERT_FILE);
    let key_path = dir.join(KEY_FILE);

    let (cert_pem, key_pem) = if cert_path.exists() && key_path.exists() {
        tracing::info!("Loading existing CA from {}", dir.display());
        (
            fs::read_to_string(&cert_path)?,
            fs::read_to_string(&key_path)?,
        )
    } else {
        tracing::info!("Generating new Reflex CA in {}", dir.display());
        let (c, k) = generate_ca_pems()?;
        // Public cert: world-readable.
        fs::write(&cert_path, &c)?;
        // Private key: 0600 on unix.
        write_private(&key_path, &k)?;
        (c, k)
    };

    let key_pair = KeyPair::from_pem(&key_pem).context("parsing CA key")?;
    let issuer = Issuer::from_ca_cert_pem(&cert_pem, key_pair).context("parsing CA cert")?;

    let fingerprint = der_sha256_hex(&cert_pem)?;

    Ok(LoadedCa {
        issuer,
        cert_path,
        fingerprint_sha256: fingerprint,
    })
}

fn generate_ca_pems() -> Result<(String, String)> {
    let key_pair = KeyPair::generate().context("generating CA key")?;

    let mut params = CertificateParams::new(Vec::<String>::new())?;
    let mut dn = DistinguishedName::new();
    dn.push(DnType::CommonName, "Reflex Local MITM CA");
    dn.push(DnType::OrganizationName, "Reflex");
    dn.push(DnType::OrganizationalUnitName, "Capture Sidecar");
    params.distinguished_name = dn;
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
    params.not_before = OffsetDateTime::now_utc();
    params.not_after = params.not_before + Duration::days(365 * 5);

    let cert = params
        .self_signed(&key_pair)
        .context("self-signing CA cert")?;
    Ok((cert.pem(), key_pair.serialize_pem()))
}

fn der_sha256_hex(cert_pem: &str) -> Result<String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let der_b64: String = cert_pem
        .lines()
        .filter(|l| !l.starts_with("-----"))
        .collect::<Vec<_>>()
        .join("");
    let der = STANDARD
        .decode(der_b64.trim())
        .context("base64-decoding CA PEM")?;

    let digest = Sha256::digest(&der);
    let mut hex = String::with_capacity(digest.len() * 2);
    for b in digest {
        use std::fmt::Write;
        let _ = write!(hex, "{b:02x}");
    }
    Ok(hex)
}

#[cfg(unix)]
fn write_private(path: &Path, contents: &str) -> Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut f = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
        .with_context(|| format!("opening {path:?}"))?;
    f.write_all(contents.as_bytes())?;
    Ok(())
}

#[cfg(not(unix))]
fn write_private(path: &Path, contents: &str) -> Result<()> {
    fs::write(path, contents).map_err(Into::into)
}
