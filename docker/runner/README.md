# GitHub Actions Self-Hosted Runners

Docker images for self-hosted GitHub Actions runners with everything pre-installed for Tauri builds.

## Features

- Ubuntu 22.04 base
- Node.js 20 pre-installed
- Rust stable pre-installed with `x86_64-unknown-linux-gnu` target
- All Tauri system dependencies (webkit2gtk, etc.)
- Tauri CLI pre-installed
- Cargo cache persistence between runs
- Auto-registration with GitHub

## Quick Start

1. **Create a `.env` file:**

```bash
cd docker/runner
cp .env.example .env
```

Edit `.env` with your values:
```
GITHUB_REPOSITORY=KaizenCore/Kaizen-Launcher
GITHUB_TOKEN=ghp_your_personal_access_token_here
```

> Note: The GitHub token needs `repo` scope for private repos or `public_repo` for public repos.

2. **Build the image:**

```bash
docker-compose build
```

3. **Start runners:**

```bash
docker-compose up -d
```

4. **Check logs:**

```bash
docker-compose logs -f
```

## Scaling

To run multiple runners:

```bash
# Scale to 3 runners
docker-compose up -d --scale linux-runner=3
```

Or use the predefined `linux-runner-2` service:

```bash
docker-compose up -d linux-runner linux-runner-2
```

## Labels

The runners are automatically labeled with:
- `self-hosted`
- `Linux`
- `X64`
- `docker`
- `tauri-ready`

## Cargo Cache

Cargo registry and git caches are persisted in Docker volumes to speed up subsequent builds:
- `cargo-cache`: Registry cache
- `cargo-git`: Git dependencies

## Customization

### Adding more dependencies

Edit `Dockerfile.linux` and add packages to the `apt-get install` line.

### Changing Rust version

Modify the rustup installation line in `Dockerfile.linux`:
```dockerfile
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain 1.75.0
```

### Resource limits

Adjust CPU and memory limits in `docker-compose.yml`:
```yaml
deploy:
  resources:
    limits:
      cpus: '8'
      memory: 16G
```
