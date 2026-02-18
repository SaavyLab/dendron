//! Password encryption using AES-256-GCM

use crate::error::{AppError, Result};
use base64::{Engine as _, engine::general_purpose};
use ring::aead::{Aad, BoundKey, Nonce, NonceSequence, OpeningKey, SealingKey, UnboundKey, AES_256_GCM};
use ring::error::Unspecified;
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use std::fmt;

const NONCE_LEN: usize = 12;

#[derive(Clone, Serialize, Deserialize)]
pub struct EncryptedPassword {
    #[serde(rename = "enc")]
    encrypted_base64: String,
    #[serde(rename = "nonce")]
    nonce_base64: String,
}

impl EncryptedPassword {
    pub fn encrypt(plaintext: &str) -> Result<Self> {
        let rng = SystemRandom::new();
        let mut nonce_bytes = [0u8; NONCE_LEN];
        rng.fill(&mut nonce_bytes)
            .map_err(|_| AppError::EncryptionFailed("Failed to generate nonce".into()))?;

        let key = Self::get_or_create_key()?;
        let unbound_key = UnboundKey::new(&AES_256_GCM, &key)
            .map_err(|_| AppError::EncryptionFailed("Failed to create encryption key".into()))?;
        let mut sealing_key = SealingKey::new(unbound_key, SingleUseNonce(nonce_bytes));

        let mut in_out = plaintext.as_bytes().to_vec();
        sealing_key
            .seal_in_place_append_tag(Aad::empty(), &mut in_out)
            .map_err(|_| AppError::EncryptionFailed("Encryption operation failed".into()))?;

        Ok(EncryptedPassword {
            encrypted_base64: general_purpose::STANDARD.encode(&in_out),
            nonce_base64: general_purpose::STANDARD.encode(nonce_bytes),
        })
    }

    pub fn decrypt(&self) -> Result<String> {
        let encrypted_data = general_purpose::STANDARD
            .decode(&self.encrypted_base64)
            .map_err(|e| AppError::DecryptionFailed(format!("Invalid base64 encrypted data: {}", e)))?;
        let nonce_bytes = general_purpose::STANDARD
            .decode(&self.nonce_base64)
            .map_err(|e| AppError::DecryptionFailed(format!("Invalid base64 nonce: {}", e)))?;

        if nonce_bytes.len() != NONCE_LEN {
            return Err(AppError::DecryptionFailed("Invalid nonce length".into()));
        }

        let mut nonce_array = [0u8; NONCE_LEN];
        nonce_array.copy_from_slice(&nonce_bytes);

        let key = Self::get_or_create_key()?;
        let unbound_key = UnboundKey::new(&AES_256_GCM, &key)
            .map_err(|_| AppError::DecryptionFailed("Failed to create decryption key".into()))?;
        let mut opening_key = OpeningKey::new(unbound_key, SingleUseNonce(nonce_array));

        let mut in_out = encrypted_data;
        let plaintext = opening_key
            .open_in_place(Aad::empty(), &mut in_out)
            .map_err(|_| AppError::DecryptionFailed("Decryption operation failed".into()))?;

        String::from_utf8(plaintext.to_vec())
            .map_err(|_| AppError::DecryptionFailed("Decrypted data is not valid UTF-8".into()))
    }

    pub fn is_plaintext(&self) -> bool {
        self.encrypted_base64.is_empty() || self.nonce_base64.is_empty()
    }

    fn get_or_create_key() -> Result<Vec<u8>> {
        let key_path = directories::ProjectDirs::from("", "", "dendron")
            .ok_or_else(|| AppError::ConfigDirNotFound)?
            .data_dir()
            .join(".key");

        if key_path.exists() {
            let key = std::fs::read(&key_path)
                .map_err(|e| AppError::EncryptionFailed(format!("Failed to read encryption key: {}", e)))?;
            if key.len() == 32 {
                return Ok(key);
            }
        }

        let rng = SystemRandom::new();
        let mut key = vec![0u8; 32];
        rng.fill(&mut key)
            .map_err(|_| AppError::EncryptionFailed("Failed to generate key".into()))?;

        if let Some(parent) = key_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&key_path, &key)
            .map_err(|e| AppError::EncryptionFailed(format!("Failed to save encryption key: {}", e)))?;

        Ok(key)
    }
}

struct SingleUseNonce([u8; NONCE_LEN]);

impl NonceSequence for SingleUseNonce {
    fn advance(&mut self) -> std::result::Result<Nonce, Unspecified> {
        Nonce::try_assume_unique_for_key(&self.0)
    }
}

impl fmt::Display for EncryptedPassword {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[REDACTED]")
    }
}

impl fmt::Debug for EncryptedPassword {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("EncryptedPassword")
            .field("encrypted", &"[REDACTED]")
            .field("nonce", &"[REDACTED]")
            .finish()
    }
}

impl PartialEq for EncryptedPassword {
    fn eq(&self, other: &Self) -> bool {
        self.encrypted_base64 == other.encrypted_base64 &&
        self.nonce_base64 == other.nonce_base64
    }
}
