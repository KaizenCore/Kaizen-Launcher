use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use rand::RngCore;
use std::path::Path;
use tokio::fs;

use crate::error::{AppError, AppResult};

const KEY_FILE: &str = ".encryption_key";
const NONCE_SIZE: usize = 12;

/// Windows DPAPI protection for the encryption key
#[cfg(windows)]
mod windows_protection {
    use std::path::Path;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB,
    };
    use windows_sys::Win32::Foundation::LocalFree;

    // CRYPT_INTEGER_BLOB is the same structure as DATA_BLOB (alias)
    type DATA_BLOB = CRYPT_INTEGER_BLOB;

    /// Encrypt data using Windows DPAPI (tied to user account)
    pub fn dpapi_encrypt(data: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            let mut input_blob = DATA_BLOB {
                cbData: data.len() as u32,
                pbData: data.as_ptr() as *mut u8,
            };
            let mut output_blob = DATA_BLOB {
                cbData: 0,
                pbData: std::ptr::null_mut(),
            };

            let result = CryptProtectData(
                &mut input_blob,
                std::ptr::null(),      // description
                std::ptr::null_mut(),  // entropy (optional)
                std::ptr::null_mut(),  // reserved
                std::ptr::null_mut(),  // prompt struct
                0,                     // flags (0 = user-specific encryption)
                &mut output_blob,
            );

            if result == 0 {
                return Err("DPAPI encryption failed".to_string());
            }

            let encrypted = std::slice::from_raw_parts(
                output_blob.pbData,
                output_blob.cbData as usize,
            ).to_vec();

            LocalFree(output_blob.pbData as *mut _);
            Ok(encrypted)
        }
    }

    /// Decrypt data using Windows DPAPI
    pub fn dpapi_decrypt(data: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            let mut input_blob = DATA_BLOB {
                cbData: data.len() as u32,
                pbData: data.as_ptr() as *mut u8,
            };
            let mut output_blob = DATA_BLOB {
                cbData: 0,
                pbData: std::ptr::null_mut(),
            };

            let result = CryptUnprotectData(
                &mut input_blob,
                std::ptr::null_mut(),  // description
                std::ptr::null_mut(),  // entropy
                std::ptr::null_mut(),  // reserved
                std::ptr::null_mut(),  // prompt struct
                0,                     // flags
                &mut output_blob,
            );

            if result == 0 {
                return Err("DPAPI decryption failed".to_string());
            }

            let decrypted = std::slice::from_raw_parts(
                output_blob.pbData,
                output_blob.cbData as usize,
            ).to_vec();

            LocalFree(output_blob.pbData as *mut _);
            Ok(decrypted)
        }
    }

    /// Set file as hidden on Windows
    pub fn set_file_hidden(path: &Path) -> Result<(), String> {
        use windows_sys::Win32::Storage::FileSystem::{
            SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_SYSTEM,
        };
        use std::os::windows::ffi::OsStrExt;

        let wide_path: Vec<u16> = path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        unsafe {
            let result = SetFileAttributesW(
                wide_path.as_ptr(),
                FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM,
            );
            if result == 0 {
                return Err("Failed to set file attributes".to_string());
            }
        }
        Ok(())
    }
}

/// Get or create the encryption key
/// On Windows: Key is protected with DPAPI (user-specific encryption)
/// On Unix: Key file has 0600 permissions (owner read/write only)
pub async fn get_or_create_key(data_dir: &Path) -> AppResult<[u8; 32]> {
    let key_path = data_dir.join(KEY_FILE);

    if key_path.exists() {
        // Read the stored key
        #[cfg(windows)]
        {
            let raw_data = fs::read(&key_path)
                .await
                .map_err(|e| AppError::Io(format!("Failed to read encryption key: {}", e)))?;

            // Try DPAPI first (new format)
            if let Ok(key_bytes) = windows_protection::dpapi_decrypt(&raw_data) {
                if key_bytes.len() == 32 {
                    let mut key = [0u8; 32];
                    key.copy_from_slice(&key_bytes);
                    return Ok(key);
                }
            }

            // Fallback: try legacy hex format and migrate to DPAPI
            let key_hex = String::from_utf8_lossy(&raw_data);
            if let Ok(key_bytes) = hex::decode(key_hex.trim()) {
                if key_bytes.len() == 32 {
                    let mut key = [0u8; 32];
                    key.copy_from_slice(&key_bytes);

                    // Migrate: re-save with DPAPI protection
                    tracing::info!("Migrating encryption key to DPAPI format");
                    if let Ok(encrypted_key) = windows_protection::dpapi_encrypt(&key) {
                        let _ = fs::write(&key_path, &encrypted_key).await;
                        windows_protection::set_file_hidden(&key_path).ok();
                    }

                    return Ok(key);
                }
            }

            return Err(AppError::Io("Invalid encryption key format".to_string()));
        }

        #[cfg(not(windows))]
        {
            // On Unix, key is stored as hex with file permissions
            let key_hex = fs::read_to_string(&key_path)
                .await
                .map_err(|e| AppError::Io(format!("Failed to read encryption key: {}", e)))?;
            let key_bytes = hex::decode(key_hex.trim())
                .map_err(|e| AppError::Io(format!("Failed to decode encryption key: {}", e)))?;
            let mut key = [0u8; 32];
            if key_bytes.len() != 32 {
                return Err(AppError::Io("Invalid encryption key length".to_string()));
            }
            key.copy_from_slice(&key_bytes);
            return Ok(key);
        }
    } else {
        // Generate a new key
        let mut key = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut key);

        // Save the key with platform-specific protection
        #[cfg(windows)]
        {
            // Encrypt the key with DPAPI before saving
            let encrypted_key = windows_protection::dpapi_encrypt(&key)
                .map_err(|e| AppError::Io(format!("Failed to encrypt key with DPAPI: {}", e)))?;

            fs::write(&key_path, &encrypted_key)
                .await
                .map_err(|e| AppError::Io(format!("Failed to save encryption key: {}", e)))?;

            // Also set file as hidden + system
            windows_protection::set_file_hidden(&key_path).ok();
        }

        #[cfg(not(windows))]
        {
            // On Unix, save as hex and set restrictive permissions
            let key_hex = hex::encode(key);
            fs::write(&key_path, &key_hex)
                .await
                .map_err(|e| AppError::Io(format!("Failed to save encryption key: {}", e)))?;

            // Set restrictive permissions (owner read/write only)
            use std::os::unix::fs::PermissionsExt;
            let perms = std::fs::Permissions::from_mode(0o600);
            std::fs::set_permissions(&key_path, perms).ok();
        }

        Ok(key)
    }
}

/// Encrypt a string value
pub fn encrypt(key: &[u8; 32], plaintext: &str) -> AppResult<String> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| AppError::Io(format!("Failed to create cipher: {}", e)))?;

    // Generate random nonce
    let mut nonce_bytes = [0u8; NONCE_SIZE];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Encrypt
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| AppError::Io(format!("Failed to encrypt: {}", e)))?;

    // Combine nonce + ciphertext and encode as hex
    let mut combined = nonce_bytes.to_vec();
    combined.extend(ciphertext);
    Ok(hex::encode(combined))
}

/// Decrypt a string value
pub fn decrypt(key: &[u8; 32], encrypted: &str) -> AppResult<String> {
    let combined = hex::decode(encrypted)
        .map_err(|e| AppError::Io(format!("Failed to decode encrypted data: {}", e)))?;

    if combined.len() < NONCE_SIZE {
        return Err(AppError::Io("Invalid encrypted data".to_string()));
    }

    let (nonce_bytes, ciphertext) = combined.split_at(NONCE_SIZE);
    let nonce = Nonce::from_slice(nonce_bytes);

    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| AppError::Io(format!("Failed to create cipher: {}", e)))?;

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| AppError::Io(format!("Failed to decrypt: {}", e)))?;

    String::from_utf8(plaintext)
        .map_err(|e| AppError::Io(format!("Failed to decode decrypted data: {}", e)))
}

/// Check if a value is encrypted (hex encoded with proper length)
pub fn is_encrypted(value: &str) -> bool {
    // Encrypted values are hex encoded and at least nonce_size * 2 + some ciphertext
    value.len() > NONCE_SIZE * 2 && hex::decode(value).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt() {
        let key = [0u8; 32];
        let plaintext = "test_token_12345";

        let encrypted = encrypt(&key, plaintext).unwrap();
        assert_ne!(encrypted, plaintext);

        let decrypted = decrypt(&key, &encrypted).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_different_encryptions() {
        let key = [0u8; 32];
        let plaintext = "test_token";

        let encrypted1 = encrypt(&key, plaintext).unwrap();
        let encrypted2 = encrypt(&key, plaintext).unwrap();

        // Different nonces should produce different ciphertexts
        assert_ne!(encrypted1, encrypted2);

        // But both should decrypt to the same value
        assert_eq!(decrypt(&key, &encrypted1).unwrap(), plaintext);
        assert_eq!(decrypt(&key, &encrypted2).unwrap(), plaintext);
    }

    #[test]
    fn test_is_encrypted() {
        let key = [0u8; 32];
        let plaintext = "test_token";

        let encrypted = encrypt(&key, plaintext).unwrap();

        assert!(is_encrypted(&encrypted));
        assert!(!is_encrypted(plaintext));
        assert!(!is_encrypted("short"));
        assert!(!is_encrypted("not-hex-encoded-value!!!"));
    }

    #[test]
    fn test_empty_string() {
        let key = [0u8; 32];
        let plaintext = "";

        let encrypted = encrypt(&key, plaintext).unwrap();
        let decrypted = decrypt(&key, &encrypted).unwrap();

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_unicode() {
        let key = [0u8; 32];
        let plaintext = "Hello, World!";

        let encrypted = encrypt(&key, plaintext).unwrap();
        let decrypted = decrypt(&key, &encrypted).unwrap();

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_long_string() {
        let key = [0u8; 32];
        let plaintext = "a".repeat(10000);

        let encrypted = encrypt(&key, &plaintext).unwrap();
        let decrypted = decrypt(&key, &encrypted).unwrap();

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_wrong_key_fails() {
        let key1 = [0u8; 32];
        let mut key2 = [0u8; 32];
        key2[0] = 1;

        let plaintext = "secret";
        let encrypted = encrypt(&key1, plaintext).unwrap();

        // Decrypting with wrong key should fail
        assert!(decrypt(&key2, &encrypted).is_err());
    }

    #[test]
    fn test_tampered_ciphertext_fails() {
        let key = [0u8; 32];
        let plaintext = "secret";

        let mut encrypted = encrypt(&key, plaintext).unwrap();

        // Tamper with the ciphertext
        let mut bytes = hex::decode(&encrypted).unwrap();
        let last_idx = bytes.len() - 1;
        bytes[last_idx] ^= 0xFF;
        encrypted = hex::encode(bytes);

        // Should fail authentication
        assert!(decrypt(&key, &encrypted).is_err());
    }
}
