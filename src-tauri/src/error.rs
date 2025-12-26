use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("IO error: {0}")]
    Io(String),

    #[error("HTTP request error: {0}")]
    Request(#[from] reqwest::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Authentication error: {0}")]
    Auth(String),

    #[error("Instance error: {0}")]
    Instance(String),

    #[error("Download error: {0}")]
    Download(String),

    #[error("Launcher error: {0}")]
    Launcher(String),

    #[error("Network error: {0}")]
    Network(String),

    #[error("Encryption error: {0}")]
    Encryption(String),

    #[error("Initialization error: {0}")]
    Initialization(String),

    #[error("Cloud storage error: {0}")]
    CloudStorage(String),

    #[error("Discord error: {0}")]
    Discord(String),

    #[error("Sharing error: {0}")]
    Sharing(String),

    #[error("Skin error: {0}")]
    Skin(String),

    #[error("Security error: {0}")]
    Security(String),

    #[error("DevTools error: {0}")]
    DevTools(String),

    #[error("Schematic error: {0}")]
    Schematic(String),

    #[error("External import error: {0}")]
    ExternalImport(String),

    #[error("{0}")]
    Custom(String),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

pub type AppResult<T> = Result<T, AppError>;
