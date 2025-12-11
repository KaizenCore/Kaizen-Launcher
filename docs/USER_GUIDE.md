# Kaizen Launcher - User Guide

A modern, feature-rich Minecraft launcher built with Tauri, React, and Rust.

## Table of Contents

- [Getting Started](#getting-started)
- [Creating Instances](#creating-instances)
- [Managing Mods](#managing-mods)
- [Server Hosting](#server-hosting)
- [Cloud Backups](#cloud-backups)
- [Discord Integration](#discord-integration)
- [Settings](#settings)

---

## Getting Started

### First Launch

When you first open Kaizen Launcher, the **Onboarding Wizard** guides you through:

1. **Language Selection** - Choose English or French
2. **Microsoft Account** - Sign in with your Microsoft account (optional)
3. **Theme Selection** - Pick a color theme or create a custom one
4. **First Instance** - Create your first Minecraft instance

### System Requirements

- **Java**: Java 21 (can be installed automatically)
- **RAM**: 4GB minimum, 8GB+ recommended
- **OS**: Windows 10+, macOS 11+, Linux (Debian/Fedora)

---

## Creating Instances

### Instance Types

| Type | Description | Examples |
|------|-------------|----------|
| **Client** | Play Minecraft with mods | Fabric, Forge, Quilt, NeoForge |
| **Server** | Host a Minecraft server | Paper, Purpur, Fabric Server |
| **Proxy** | Network multiple servers | Velocity, BungeeCord, Waterfall |

### Supported Modloaders

**Clients:**
- Vanilla (no mods)
- Fabric
- Quilt
- Forge
- NeoForge

**Servers:**
- Vanilla
- Paper
- Purpur
- Folia
- Pufferfish
- Fabric Server
- Forge Server

**Proxies:**
- Velocity
- BungeeCord
- Waterfall

### Creating a New Instance

1. Go to **Instances** page
2. Click **New Instance**
3. Select instance type (Client/Server/Proxy)
4. Choose Minecraft version
5. Select modloader (optional)
6. Name your instance
7. Click **Create**

### Instance Settings

Each instance can be configured with:

- **Memory**: Min/Max RAM allocation
- **Java Version**: Select which Java to use
- **JVM Arguments**: Custom launch arguments
- **Auto-Backup**: Backup worlds before launching

---

## Managing Mods

### Installing Mods

1. Open an instance
2. Go to **Browse** tab
3. Search for mods on Modrinth
4. Click **Install** on desired mod
5. Dependencies are handled automatically

### Mod Management

In the **Mods** tab:

- **Enable/Disable** individual mods
- **Delete** mods you no longer need
- **Check for Updates** to find newer versions
- **Batch Operations**: Select multiple mods for bulk actions

### Installing Modpacks

1. Go to **Browse** page (main navigation)
2. Search for modpacks
3. Select version
4. Click **Install**
5. A new instance is created with all mods

---

## Server Hosting

### Setting Up a Server

1. Create a **Server** instance
2. Configure server properties in **Settings** tab
3. Set memory allocation (4GB+ recommended)
4. Click **Install** then **Start**

### Server Console

The **Console** tab provides:

- Real-time server output
- Command input field
- Server statistics (players, TPS, memory)

### Port Forwarding with Tunnels

Share your server without port forwarding using tunnels:

1. Go to **Tunnel** tab
2. Select a provider:
   - **Playit.gg** - Easy setup, free
   - **Cloudflare Tunnel** - Zero Trust network
   - **Ngrok** - Secure tunnels
   - **Bore** - Simple CLI tunneling
3. Enable tunnel
4. Copy the generated address to share

**Auto-Start**: Enable to automatically start tunnel with server.

---

## Cloud Backups

### Supported Providers

- **Google Drive** - OAuth authentication
- **Dropbox** - OAuth authentication
- **Nextcloud** - WebDAV (self-hosted)
- **S3-Compatible** - AWS, MinIO, etc.

### Configuration

1. Go to **Settings** > **Cloud**
2. Select your provider
3. Authenticate or enter credentials
4. Enable **Auto-Upload** for automatic backups

### Managing Backups

**Per-Instance** (Worlds tab):
- Create manual backups
- Restore from backup
- Upload to cloud
- View sync status

**Global** (Backups page):
- View all backups across instances
- Search and filter
- Bulk management

---

## Discord Integration

### Rich Presence

Show your Minecraft activity on Discord:

1. Go to **Settings** > **Discord**
2. Enable **Rich Presence**
3. Configure what to display:
   - Instance name
   - Minecraft version
   - Modloader
   - Playtime

**Status Types:**
- **Idle** - Browsing the launcher
- **Playing** - In-game (client)
- **Hosting** - Running a server

### Webhooks

Get Discord notifications for server events:

1. Create a webhook in your Discord server
2. Go to **Settings** > **Discord**
3. Paste webhook URL
4. Select events to notify:
   - Server Start/Stop
   - Player Join/Leave
   - Backup Created

---

## Settings

### Appearance

- **Theme**: Light, Dark, or System
- **Custom Colors**: Create your own theme
- **Presets**: Modern, Cyberpunk, Ocean, Forest, Sunset

### Java

- View installed Java versions
- Install Java 21 automatically
- Select default Java for instances

### Storage

- View storage breakdown by category
- Clear cache
- Set custom instances directory
- Per-instance storage info

### Language

- English
- French

### About

- Current version
- Check for updates
- View changelog

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + Shift + D` | Open Developer Monitor |

---

## Troubleshooting

### Game Won't Launch

1. Check Java is installed (Settings > Java)
2. Verify memory settings aren't too high
3. Check logs in the **Logs** tab

### Mods Not Working

1. Ensure mod is for correct Minecraft version
2. Check mod is enabled in Mods tab
3. Verify modloader matches (Fabric mods need Fabric)

### Server Not Accessible

1. Check server is running (green status)
2. Use tunnel if behind firewall
3. Verify port in server properties

### High CPU Usage

Update to v0.4.0+ which includes major performance optimizations.

---

## Support

- **GitHub Issues**: [Report bugs](https://github.com/KaizenCore/Kaizen-Launcher/issues)
- **Changelog**: View in Settings > About

---

*Kaizen Launcher v0.4.0*
