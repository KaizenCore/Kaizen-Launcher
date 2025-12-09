use crate::db::accounts::Account;
use crate::db::instances::Instance;
use crate::error::{AppError, AppResult};
use crate::launcher::java;
use crate::minecraft::installer::get_instance_classpath;
use crate::minecraft::versions::{ArgumentValue, StringOrArray, VersionDetails};
use crate::state::{RunningInstances, RunningTunnels, ServerStdinHandles};
use crate::tunnel::{manager as tunnel_manager, TunnelConfig, TunnelProvider};
use serde::Serialize;
use sqlx::SqlitePool;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::process::Command;
use tokio::sync::Mutex;

// Windows-specific: CREATE_NO_WINDOW flag to hide console window
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone, Serialize)]
pub struct InstanceStatusEvent {
    pub instance_id: String,
    pub status: String, // "running" or "stopped"
    pub exit_code: Option<i32>,
}

#[derive(Clone, Serialize)]
pub struct ServerLogEvent {
    pub instance_id: String,
    pub line: String,
    pub is_error: bool,
}

/// Launch Minecraft for the given instance
#[allow(clippy::too_many_arguments)]
pub async fn launch_minecraft(
    instance_dir: &Path,
    data_dir: &Path,
    instance: &Instance,
    version: &VersionDetails,
    account: &Account,
    java_path: Option<&str>,
    app: &AppHandle,
    running_instances: RunningInstances,
    db: SqlitePool,
) -> AppResult<()> {
    let natives_dir = instance_dir.join("natives");
    let assets_dir = instance_dir.join("assets");

    println!("[RUNNER] Launching instance from: {:?}", instance_dir);
    println!("[RUNNER] Assets dir: {:?}", assets_dir);

    // Create natives directory
    tokio::fs::create_dir_all(&natives_dir)
        .await
        .map_err(|e| AppError::Io(format!("Failed to create natives directory: {}", e)))?;

    // Get classpath from instance directory
    let classpath = get_instance_classpath(instance_dir, version, instance.loader.as_deref());
    println!("[RUNNER] Classpath has {} entries", classpath.len());
    let classpath_str = classpath
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(if cfg!(windows) { ";" } else { ":" });

    // Determine Java path - check bundled Java first
    let java = java_path
        .map(String::from)
        .or_else(|| instance.java_path.clone())
        .or_else(|| {
            // Check for bundled Java
            let bundled = java::get_bundled_java_path(data_dir);
            if bundled.exists() {
                Some(bundled.to_string_lossy().to_string())
            } else {
                None
            }
        })
        .or_else(find_system_java)
        .ok_or_else(|| {
            AppError::Launcher(
                "Java n'est pas installé. Cliquez sur 'Installer Java' dans les paramètres."
                    .to_string(),
            )
        })?;

    println!("[RUNNER] Using Java: {}", java);

    // Build JVM arguments
    let libraries_dir = instance_dir.join("libraries");
    let jvm_args = build_jvm_args(
        version,
        &natives_dir.to_string_lossy(),
        &libraries_dir.to_string_lossy(),
        &classpath_str,
        instance.memory_min_mb,
        instance.memory_max_mb,
        instance.loader.as_deref(),
    );

    // Build game arguments
    let mut game_args = build_game_args(
        version,
        account,
        instance_dir,
        &assets_dir,
        &version.asset_index.id,
    );

    // Add NeoForge/Forge specific arguments for production mode
    if let Some(ref loader) = instance.loader {
        if loader == "neoforge" {
            // Required FML arguments for BootstrapLauncher
            game_args.push("--launchTarget".to_string());
            game_args.push("forgeclient".to_string());
            game_args.push(format!("--fml.mcVersion={}", instance.mc_version));

            // Read neoform version from metadata file
            let neoform_version = read_neoform_version(instance_dir)
                .await
                .unwrap_or_else(|| instance.mc_version.clone());
            game_args.push(format!("--fml.neoFormVersion={}", neoform_version));

            if let Some(ref loader_ver) = instance.loader_version {
                game_args.push(format!("--fml.neoForgeVersion={}", loader_ver));
                // FML version is the fancymodloader version, not the NeoForge version
                let fml_version = read_fml_version(instance_dir)
                    .await
                    .unwrap_or_else(|| loader_ver.clone());
                game_args.push(format!("--fml.fmlVersion={}", fml_version));
            }
        } else if loader == "forge" {
            // Required FML arguments for BootstrapLauncher
            game_args.push("--launchTarget".to_string());
            game_args.push("forgeclient".to_string());
            game_args.push(format!("--fml.mcVersion={}", instance.mc_version));

            // Read neoform version from metadata file
            let neoform_version = read_neoform_version(instance_dir)
                .await
                .unwrap_or_else(|| instance.mc_version.clone());
            game_args.push(format!("--fml.neoFormVersion={}", neoform_version));

            if let Some(ref loader_ver) = instance.loader_version {
                game_args.push(format!("--fml.forgeVersion={}", loader_ver));
            }
        }
    }

    // Log the full command for debugging
    println!("[RUNNER] === FULL LAUNCH COMMAND ===");
    println!("[RUNNER] Java: {}", java);
    println!("[RUNNER] JVM args ({}):", jvm_args.len());
    for (i, arg) in jvm_args.iter().enumerate() {
        println!("[RUNNER]   JVM[{}]: {}", i, arg);
    }
    println!("[RUNNER] Main class: {}", version.main_class);
    println!("[RUNNER] Game args ({}):", game_args.len());
    for (i, arg) in game_args.iter().enumerate() {
        println!("[RUNNER]   Game[{}]: {}", i, arg);
    }
    println!("[RUNNER] === END COMMAND ===");

    // Build the command
    let mut cmd = Command::new(&java);
    cmd.current_dir(instance_dir);
    cmd.args(&jvm_args);
    cmd.arg(&version.main_class);
    cmd.args(&game_args);

    // Set environment for Minecraft data isolation
    // On Windows: APPDATA controls where Minecraft stores data
    // On macOS/Linux: Use environment variables to hint the game directory
    #[cfg(target_os = "windows")]
    {
        cmd.env("APPDATA", instance_dir);
    }
    #[cfg(target_os = "macos")]
    {
        // macOS uses ~/Library/Application Support/minecraft by default
        // Setting HOME can help redirect but --gameDir is the primary mechanism
        cmd.env("MINECRAFT_GAME_DIR", instance_dir);
    }
    #[cfg(target_os = "linux")]
    {
        // Linux uses ~/.minecraft by default
        // Setting HOME can help redirect but --gameDir is the primary mechanism
        cmd.env("MINECRAFT_GAME_DIR", instance_dir);
    }
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    // On Windows, hide the console window
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    // Spawn the process
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Launcher(format!("Failed to launch Minecraft: {}", e)))?;

    // Get PID and register as running
    let pid = child.id().unwrap_or(0);
    let instance_id = instance.id.clone();

    // Register instance as running
    {
        let mut running = running_instances.write().await;
        running.insert(instance_id.clone(), pid);
    }

    // Emit started event
    let _ = app.emit(
        "instance-status",
        InstanceStatusEvent {
            instance_id: instance_id.clone(),
            status: "running".to_string(),
            exit_code: None,
        },
    );

    println!("[RUNNER] Instance {} started with PID {}", instance_id, pid);

    // Record start time for playtime tracking
    let start_time = Instant::now();

    // Clone handles for the async task
    let app_handle = app.clone();
    let running_instances_clone = running_instances.clone();

    // Spawn a task to read and print stdout/stderr
    tokio::spawn(async move {
        use tokio::io::{AsyncBufReadExt, BufReader};

        if let Some(stdout) = child.stdout.take() {
            let mut stdout_reader = BufReader::new(stdout).lines();
            tokio::spawn(async move {
                while let Ok(Some(line)) = stdout_reader.next_line().await {
                    println!("[MC STDOUT] {}", line);
                }
            });
        }

        if let Some(stderr) = child.stderr.take() {
            let mut stderr_reader = BufReader::new(stderr).lines();
            tokio::spawn(async move {
                while let Ok(Some(line)) = stderr_reader.next_line().await {
                    eprintln!("[MC STDERR] {}", line);
                }
            });
        }

        // Wait for the process to complete
        let exit_code = match child.wait().await {
            Ok(status) => {
                println!("[RUNNER] Minecraft exited with status: {}", status);
                status.code()
            }
            Err(e) => {
                eprintln!("[RUNNER] Error waiting for Minecraft: {}", e);
                None
            }
        };

        // Calculate and save playtime
        let elapsed_seconds = start_time.elapsed().as_secs() as i64;
        if let Err(e) = Instance::add_playtime(&db, &instance_id, elapsed_seconds).await {
            eprintln!("[RUNNER] Failed to update playtime: {}", e);
        } else {
            println!(
                "[RUNNER] Added {} seconds of playtime to instance {}",
                elapsed_seconds, instance_id
            );
        }

        // Remove from running instances
        {
            let mut running = running_instances_clone.write().await;
            running.remove(&instance_id);
        }

        // Emit stopped event
        let _ = app_handle.emit(
            "instance-status",
            InstanceStatusEvent {
                instance_id: instance_id.clone(),
                status: "stopped".to_string(),
                exit_code,
            },
        );

        println!("[RUNNER] Instance {} stopped", instance_id);
    });

    Ok(())
}

/// Build JVM arguments
fn build_jvm_args(
    version: &VersionDetails,
    natives_dir: &str,
    libraries_dir: &str,
    classpath: &str,
    min_memory: i64,
    max_memory: i64,
    loader: Option<&str>,
) -> Vec<String> {
    let mut args = Vec::new();

    // Memory settings
    args.push(format!("-Xms{}M", min_memory));
    args.push(format!("-Xmx{}M", max_memory));

    // Add --add-opens for NeoForge/Forge (required for Java 16+ module system)
    if let Some(l) = loader {
        if l == "neoforge" || l == "forge" {
            // These are required for NeoForge/Forge to access internal Java APIs
            args.push("--add-opens".to_string());
            args.push("java.base/java.util.jar=ALL-UNNAMED".to_string());
            args.push("--add-opens".to_string());
            args.push("java.base/java.lang.invoke=ALL-UNNAMED".to_string());
            args.push("--add-opens".to_string());
            args.push("java.base/sun.security.ssl=ALL-UNNAMED".to_string());
            args.push("--add-opens".to_string());
            args.push("java.base/java.lang=ALL-UNNAMED".to_string());
            args.push("--add-opens".to_string());
            args.push("java.base/java.util=ALL-UNNAMED".to_string());
            args.push("--add-opens".to_string());
            args.push("java.base/java.nio.file=ALL-UNNAMED".to_string());
        }
    }

    // Modern JVM args from version manifest
    if let Some(ref arguments) = version.arguments {
        for arg in &arguments.jvm {
            match arg {
                ArgumentValue::Simple(s) => {
                    let resolved =
                        resolve_argument(s, natives_dir, libraries_dir, classpath, &version.id);
                    args.push(resolved);
                }
                ArgumentValue::Conditional { rules, value } => {
                    if evaluate_rules(rules) {
                        match value {
                            StringOrArray::String(s) => {
                                let resolved = resolve_argument(
                                    s,
                                    natives_dir,
                                    libraries_dir,
                                    classpath,
                                    &version.id,
                                );
                                args.push(resolved);
                            }
                            StringOrArray::Array(arr) => {
                                for s in arr {
                                    let resolved = resolve_argument(
                                        s,
                                        natives_dir,
                                        libraries_dir,
                                        classpath,
                                        &version.id,
                                    );
                                    args.push(resolved);
                                }
                            }
                        }
                    }
                }
            }
        }

        // Add libraryDirectory for NeoForge/Forge (required in production mode)
        args.push(format!("-DlibraryDirectory={}", libraries_dir));
    } else {
        // Legacy: use default JVM args
        args.push(format!("-Djava.library.path={}", natives_dir));
        args.push("-cp".to_string());
        args.push(classpath.to_string());
    }

    args
}

/// Build game arguments
fn build_game_args(
    version: &VersionDetails,
    account: &Account,
    game_dir: &Path,
    assets_dir: &Path,
    asset_index: &str,
) -> Vec<String> {
    let mut args = Vec::new();

    // Check for modern arguments format
    if let Some(ref arguments) = version.arguments {
        for arg in &arguments.game {
            match arg {
                ArgumentValue::Simple(s) => {
                    let resolved = resolve_game_argument(
                        s,
                        account,
                        game_dir,
                        assets_dir,
                        asset_index,
                        &version.id,
                    );
                    args.push(resolved);
                }
                ArgumentValue::Conditional { rules, value } => {
                    if evaluate_rules(rules) {
                        match value {
                            StringOrArray::String(s) => {
                                let resolved = resolve_game_argument(
                                    s,
                                    account,
                                    game_dir,
                                    assets_dir,
                                    asset_index,
                                    &version.id,
                                );
                                args.push(resolved);
                            }
                            StringOrArray::Array(arr) => {
                                for s in arr {
                                    let resolved = resolve_game_argument(
                                        s,
                                        account,
                                        game_dir,
                                        assets_dir,
                                        asset_index,
                                        &version.id,
                                    );
                                    args.push(resolved);
                                }
                            }
                        }
                    }
                }
            }
        }
    } else if let Some(ref mc_args) = version.minecraft_arguments {
        // Legacy: parse minecraftArguments string
        for arg in mc_args.split_whitespace() {
            let resolved =
                resolve_game_argument(arg, account, game_dir, assets_dir, asset_index, &version.id);
            args.push(resolved);
        }
    }

    args
}

/// Resolve a JVM argument template
fn resolve_argument(
    arg: &str,
    natives_dir: &str,
    libraries_dir: &str,
    classpath: &str,
    version_name: &str,
) -> String {
    // Determine classpath separator based on OS
    let classpath_separator = if cfg!(windows) { ";" } else { ":" };

    arg.replace("${natives_directory}", natives_dir)
        .replace("${library_directory}", libraries_dir)
        .replace("${classpath}", classpath)
        .replace("${classpath_separator}", classpath_separator)
        .replace("${version_name}", version_name)
        .replace("${launcher_name}", "Kaizen")
        .replace("${launcher_version}", "0.1.0")
}

/// Resolve a game argument template
fn resolve_game_argument(
    arg: &str,
    account: &Account,
    game_dir: &Path,
    assets_dir: &Path,
    asset_index: &str,
    version_name: &str,
) -> String {
    arg.replace("${auth_player_name}", &account.username)
        .replace("${version_name}", version_name)
        .replace("${game_directory}", &game_dir.to_string_lossy())
        .replace("${assets_root}", &assets_dir.to_string_lossy())
        .replace("${assets_index_name}", asset_index)
        .replace("${auth_uuid}", &account.uuid)
        .replace("${auth_access_token}", &account.access_token)
        .replace("${clientid}", "0")
        .replace("${auth_xuid}", "0")
        .replace(
            "${user_type}",
            if account.access_token == "offline" {
                "legacy"
            } else {
                "msa"
            },
        )
        .replace("${version_type}", "release")
        .replace("${user_properties}", "{}")
}

/// Evaluate rules to determine if an argument should be included
fn evaluate_rules(rules: &[crate::minecraft::versions::Rule]) -> bool {
    for rule in rules {
        let action_allow = rule.action == "allow";

        if let Some(ref os) = rule.os {
            let os_matches = match os.name.as_deref() {
                Some("osx") | Some("macos") => cfg!(target_os = "macos"),
                Some("windows") => cfg!(target_os = "windows"),
                Some("linux") => cfg!(target_os = "linux"),
                _ => true,
            };

            if os_matches != action_allow {
                return false;
            }
        }

        // Skip feature-based rules (demo, custom resolution, etc.)
        if rule.features.is_some() {
            if !action_allow {
                return true;
            }
            return false;
        }
    }

    true
}

/// Find system Java installation
fn find_system_java() -> Option<String> {
    use std::path::PathBuf;

    #[cfg(target_os = "macos")]
    {
        // Check for Homebrew Java (Apple Silicon and Intel)
        let homebrew_paths = [
            PathBuf::from("/opt/homebrew/opt/openjdk/bin/java"),
            PathBuf::from("/opt/homebrew/opt/openjdk@21/bin/java"),
            PathBuf::from("/opt/homebrew/opt/openjdk@17/bin/java"),
            PathBuf::from("/usr/local/opt/openjdk/bin/java"),
        ];
        for path in homebrew_paths {
            if path.exists() {
                return Some(path.to_string_lossy().to_string());
            }
        }

        // Check for Temurin/other JDKs in /Library/Java
        let library_java = PathBuf::from("/Library/Java/JavaVirtualMachines");
        if let Ok(entries) = std::fs::read_dir(&library_java) {
            for entry in entries.flatten() {
                let java_path = entry
                    .path()
                    .join("Contents")
                    .join("Home")
                    .join("bin")
                    .join("java");
                if java_path.exists() {
                    return Some(java_path.to_string_lossy().to_string());
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(java_home) = std::env::var("JAVA_HOME") {
            let java = PathBuf::from(&java_home).join("bin").join("java.exe");
            if java.exists() {
                return Some(java.to_string_lossy().to_string());
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Check common Linux Java locations
        let linux_paths = [
            PathBuf::from("/usr/bin/java"),
            PathBuf::from("/usr/lib/jvm/default/bin/java"),
            PathBuf::from("/usr/lib/jvm/java-21-openjdk/bin/java"),
            PathBuf::from("/usr/lib/jvm/java-17-openjdk/bin/java"),
        ];
        for path in linux_paths {
            if path.exists() {
                return Some(path.to_string_lossy().to_string());
            }
        }

        // Check JAVA_HOME on Linux too
        if let Ok(java_home) = std::env::var("JAVA_HOME") {
            let java = PathBuf::from(&java_home).join("bin").join("java");
            if java.exists() {
                return Some(java.to_string_lossy().to_string());
            }
        }
    }

    None
}

/// Read neoform version from instance metadata file
async fn read_neoform_version(instance_dir: &Path) -> Option<String> {
    let meta_path = instance_dir.join("neoforge_meta.json");
    if let Ok(contents) = tokio::fs::read_to_string(&meta_path).await {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&contents) {
            return json
                .get("neoform_version")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
        }
    }
    None
}

/// Read FML version from instance metadata file
async fn read_fml_version(instance_dir: &Path) -> Option<String> {
    let meta_path = instance_dir.join("neoforge_meta.json");
    if let Ok(contents) = tokio::fs::read_to_string(&meta_path).await {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&contents) {
            return json
                .get("fml_version")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
        }
    }
    None
}

/// Launch a server instance (Vanilla, Paper, Fabric, Forge, NeoForge, Velocity, BungeeCord, Waterfall)
pub async fn launch_server(
    instance_dir: &Path,
    data_dir: &Path,
    instance: &Instance,
    app: &AppHandle,
    running_instances: RunningInstances,
    stdin_handles: ServerStdinHandles,
    db: SqlitePool,
    running_tunnels: RunningTunnels,
) -> AppResult<()> {
    println!("[RUNNER] Launching server from: {:?}", instance_dir);

    // Find Java
    let java_path = java::check_java_installed(data_dir)
        .map(|j| j.path)
        .or_else(find_system_java)
        .ok_or_else(|| AppError::Instance("Java not found".to_string()))?;

    println!("[RUNNER] Using Java: {}", java_path);

    // Build JVM args
    let min_memory = instance.memory_min_mb;
    let max_memory = instance.memory_max_mb;

    // Check if this is a modern Forge/NeoForge server with @libraries style
    let forge_modern = instance_dir.join(".forge_modern").exists();
    let neoforge_modern = instance_dir.join(".neoforge_modern").exists();

    let mut args: Vec<String> = Vec::new();

    if forge_modern || neoforge_modern {
        // Modern Forge/NeoForge - parse run.sh/run.bat to get the java arguments
        let run_script = if cfg!(windows) {
            instance_dir.join("run.bat")
        } else {
            instance_dir.join("run.sh")
        };

        if run_script.exists() {
            let script_content = std::fs::read_to_string(&run_script)
                .map_err(|e| AppError::Io(format!("Failed to read run script: {}", e)))?;

            // Parse the script to extract @ arguments
            // Format: java @user_jvm_args.txt @libraries/.../unix_args.txt "$@"
            for line in script_content.lines() {
                let line = line.trim();
                // Skip comments and empty lines
                if line.is_empty()
                    || line.starts_with('#')
                    || line.starts_with("rem")
                    || line.starts_with("REM")
                {
                    continue;
                }

                // Look for java command line
                if line.contains("java ") || line.starts_with("java") {
                    // Extract @file arguments
                    for part in line.split_whitespace() {
                        if part.starts_with('@') && !part.contains("$") && !part.contains("%") {
                            // This is a @file argument, keep it
                            args.push(part.to_string());
                        }
                    }
                    break;
                }
            }

            // Add memory args at the beginning
            args.insert(0, format!("-Xmx{}M", max_memory));
            args.insert(0, format!("-Xms{}M", min_memory));

            // Add nogui at the end (only for servers that support it, not proxies)
            let loader_lower = instance.loader.as_ref().map(|l| l.to_lowercase());
            let is_proxy = matches!(
                loader_lower.as_deref(),
                Some("velocity") | Some("bungeecord") | Some("waterfall")
            );
            if !is_proxy {
                args.push("--nogui".to_string());
            }

            println!(
                "[RUNNER] Modern Forge/NeoForge server detected, args: {:?}",
                args
            );
        } else {
            return Err(AppError::Instance(
                "Modern Forge/NeoForge server detected but run script not found".to_string(),
            ));
        }
    } else {
        // Standard server - use simple -jar approach
        let server_jar = instance_dir.join("server.jar");
        if !server_jar.exists() {
            return Err(AppError::Instance("Server JAR not found".to_string()));
        }

        args.push(format!("-Xms{}M", min_memory));
        args.push(format!("-Xmx{}M", max_memory));
        args.push("-jar".to_string());
        args.push(server_jar.to_string_lossy().to_string());

        // Add nogui only for servers that support it (not proxies like Velocity, BungeeCord, Waterfall)
        let loader_lower = instance.loader.as_ref().map(|l| l.to_lowercase());
        let is_proxy = matches!(
            loader_lower.as_deref(),
            Some("velocity") | Some("bungeecord") | Some("waterfall")
        );
        if !is_proxy {
            args.push("--nogui".to_string());
        }
    }

    println!("[RUNNER] Server args: {:?}", args);

    // Spawn the server process
    let mut cmd = Command::new(&java_path);
    cmd.args(&args)
        .current_dir(instance_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::piped());

    // On Windows, hide the console window
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Io(format!("Failed to start server: {}", e)))?;

    let pid = child.id().unwrap_or(0);
    println!("[RUNNER] Server started with PID: {}", pid);

    // Track running instance
    {
        let mut running = running_instances.write().await;
        running.insert(instance.id.clone(), pid);
    }

    // Emit status event
    let _ = app.emit(
        "instance-status",
        InstanceStatusEvent {
            instance_id: instance.id.clone(),
            status: "running".to_string(),
            exit_code: None,
        },
    );

    // Check for auto-start tunnel
    let tunnel_config = get_tunnel_config_if_autostart(&db, &instance.id).await;
    if let Some(config) = tunnel_config {
        let data_dir_clone = data_dir.to_path_buf();
        let app_clone = app.clone();
        let running_tunnels_clone = running_tunnels.clone();

        // Start tunnel after a short delay to let the server start
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            println!("[RUNNER] Auto-starting {} tunnel...", config.provider);
            if let Err(e) = tunnel_manager::start_tunnel(
                &data_dir_clone,
                &config,
                &app_clone,
                running_tunnels_clone,
            )
            .await
            {
                eprintln!("[RUNNER] Failed to auto-start tunnel: {}", e);
            }
        });
    }

    // Get stdout, stderr, and stdin for streaming and commands
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdin = child.stdin.take();

    // Store stdin handle for sending commands
    if let Some(stdin) = stdin {
        let mut handles = stdin_handles.write().await;
        handles.insert(instance.id.clone(), Arc::new(Mutex::new(stdin)));
    }

    // Spawn task to stream stdout
    let instance_id_stdout = instance.id.clone();
    let app_stdout = app.clone();
    if let Some(stdout) = stdout {
        tokio::spawn(async move {
            use tokio::io::{AsyncBufReadExt, BufReader};
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app_stdout.emit(
                    "server-log",
                    ServerLogEvent {
                        instance_id: instance_id_stdout.clone(),
                        line,
                        is_error: false,
                    },
                );
            }
        });
    }

    // Spawn task to stream stderr
    let instance_id_stderr = instance.id.clone();
    let app_stderr = app.clone();
    if let Some(stderr) = stderr {
        tokio::spawn(async move {
            use tokio::io::{AsyncBufReadExt, BufReader};
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app_stderr.emit(
                    "server-log",
                    ServerLogEvent {
                        instance_id: instance_id_stderr.clone(),
                        line,
                        is_error: true,
                    },
                );
            }
        });
    }

    // Record start time for playtime tracking
    let start_time = Instant::now();

    // Spawn task to wait for server exit
    let instance_id = instance.id.clone();
    let app_handle = app.clone();
    let running_clone = running_instances.clone();
    let stdin_handles_clone = stdin_handles.clone();
    let running_tunnels_clone = running_tunnels.clone();

    tokio::spawn(async move {
        let status = child.wait().await;

        // Calculate and save playtime
        let elapsed_seconds = start_time.elapsed().as_secs() as i64;
        if let Err(e) = Instance::add_playtime(&db, &instance_id, elapsed_seconds).await {
            eprintln!("[RUNNER] Failed to update server playtime: {}", e);
        } else {
            println!(
                "[RUNNER] Added {} seconds of playtime to server {}",
                elapsed_seconds, instance_id
            );
        }

        // Remove from running instances
        {
            let mut running = running_clone.write().await;
            running.remove(&instance_id);
        }

        // Remove stdin handle
        {
            let mut handles = stdin_handles_clone.write().await;
            handles.remove(&instance_id);
        }

        // Stop tunnel if running
        let _ = tunnel_manager::stop_tunnel(&instance_id, running_tunnels_clone, &app_handle).await;

        let exit_code = status.ok().and_then(|s| s.code());

        // Emit stopped status
        let _ = app_handle.emit(
            "instance-status",
            InstanceStatusEvent {
                instance_id,
                status: "stopped".to_string(),
                exit_code,
            },
        );
    });

    Ok(())
}

/// Helper function to get tunnel config if enabled and auto_start is true
async fn get_tunnel_config_if_autostart(
    db: &SqlitePool,
    instance_id: &str,
) -> Option<TunnelConfig> {
    let row = sqlx::query_as::<_, (String, String, String, i64, i64, Option<String>, Option<String>, i64, Option<String>)>(
        r#"
        SELECT id, instance_id, provider, enabled, auto_start, playit_secret_key, ngrok_authtoken, target_port, tunnel_url
        FROM tunnel_configs
        WHERE instance_id = ? AND enabled = 1 AND auto_start = 1
        "#,
    )
    .bind(instance_id)
    .fetch_optional(db)
    .await
    .ok()?;

    row.map(
        |(
            id,
            instance_id,
            provider,
            enabled,
            auto_start,
            playit_secret_key,
            ngrok_authtoken,
            target_port,
            tunnel_url,
        )| {
            TunnelConfig {
                id,
                instance_id,
                provider: provider.parse().unwrap_or(TunnelProvider::Cloudflare),
                enabled: enabled != 0,
                auto_start: auto_start != 0,
                playit_secret_key,
                ngrok_authtoken,
                target_port: target_port as i32,
                tunnel_url,
            }
        },
    )
}
