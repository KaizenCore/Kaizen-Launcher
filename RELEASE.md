# Release Guide for AI Assistants

This document explains how to release a new version of Kaizen Launcher.

## Prerequisites

- GitHub CLI (`gh`) authenticated with push access to the repository
- Access to self-hosted runners (Linux Docker, macOS, Windows)

## Release Process

### 1. Update Version Numbers

Update the version in **3 files** (all must match):

```bash
# package.json
"version": "X.Y.Z"

# src-tauri/Cargo.toml
version = "X.Y.Z"

# src-tauri/tauri.conf.json
"version": "X.Y.Z"
```

### 2. Commit Changes

```bash
git add -A
git commit -m "chore: bump version to vX.Y.Z

- [List changes here]

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

### 3. Push to Main

```bash
git push origin main
```

### 4. Trigger Release Workflow

Use GitHub CLI to trigger the release workflow with self-hosted runners:

```bash
gh workflow run release.yml --repo KaizenCore/Kaizen-Launcher -f version=vX.Y.Z -f use_self_hosted=true
```

**Important:**
- The version MUST start with `v` (e.g., `v0.2.6`, not `0.2.6`)
- Use `use_self_hosted=true` for faster builds on self-hosted runners

### 5. Monitor Build Progress

```bash
# List recent runs
gh run list --repo KaizenCore/Kaizen-Launcher --limit 5

# View specific run status
gh run view <RUN_ID> --repo KaizenCore/Kaizen-Launcher

# View failed logs if needed
gh run view <RUN_ID> --repo KaizenCore/Kaizen-Launcher --log-failed
```

### 6. Verify Release

Once all jobs succeed, the release will be published automatically at:
https://github.com/KaizenCore/Kaizen-Launcher/releases

## Workflow Details

The release workflow (`release.yml`) does the following:

1. **Create Release** - Creates a draft GitHub release with the version tag
2. **Build** - Builds for all platforms in parallel:
   - Linux (x86_64) - Docker self-hosted runner
   - macOS ARM (aarch64) - macOS self-hosted runner
   - macOS x86 (cross-compiled) - macOS self-hosted runner
   - Windows (x86_64) - Windows self-hosted runner
3. **Publish Release** - Publishes the draft release with all artifacts

## Self-Hosted vs GitHub-Hosted Runners

| Feature | Self-hosted (`use_self_hosted=true`) | GitHub-hosted |
|---------|--------------------------------------|---------------|
| Speed | Faster (cached dependencies) | Slower |
| Node.js | Pre-installed, no download | Downloads ~3GB cache |
| Rust | Pre-installed, no update | Downloads/updates |
| npm | Uses local cache | Fresh install each time |

**Always prefer self-hosted runners** for releases.

## Troubleshooting

### Build Failed - Check Logs

```bash
gh run view <RUN_ID> --repo KaizenCore/Kaizen-Launcher --log-failed
```

### Cancel a Running Build

```bash
gh run cancel <RUN_ID> --repo KaizenCore/Kaizen-Launcher
```

### Re-run Failed Jobs

Just trigger a new release with the same version - it will create a new release.

### Common Issues

1. **"refs/heads/main is not allowed"** - You forgot the `v` prefix in version
2. **npm ci fails** - Stale lockfile on runner, workflow uses `npm install` for self-hosted
3. **Rust not found** - Workflow auto-installs Rust if missing
4. **DMG bundling fails on macOS** - Restart the macOS runner service

## Auto-Update System

The app uses Tauri's updater plugin. When a new release is published:

1. The app checks `https://github.com/KaizenCore/Kaizen-Launcher/releases/latest/download/latest.json`
2. If a newer version exists, it shows an update notification
3. User can click "Install Update" in Settings > About
4. The app downloads, installs, and relaunches automatically

For auto-update to trigger, the new version number must be **higher** than the currently installed version.
