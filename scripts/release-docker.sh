#!/bin/bash
# Docker-based release script for Kaizen Launcher
# Builds all platforms and optionally pushes to GitHub
#
# Usage:
#   ./scripts/release-docker.sh              # Build all platforms
#   ./scripts/release-docker.sh --push       # Build and push to GitHub
#   ./scripts/release-docker.sh linux        # Build Linux only
#   ./scripts/release-docker.sh windows      # Build Windows only
#   ./scripts/release-docker.sh macos        # Build macOS only (native)
#   ./scripts/release-docker.sh --parallel   # Build Linux/Windows in parallel

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DOCKER_DIR="$PROJECT_DIR/docker"
OUTPUT_DIR="$PROJECT_DIR/dist-release"

# Get version
VERSION=$(grep '"version"' "$PROJECT_DIR/package.json" | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')

# Arguments
PUSH_RELEASE=false
BUILD_LINUX=false
BUILD_WINDOWS=false
BUILD_MACOS=false
PARALLEL=false

# Parse arguments
if [ $# -eq 0 ]; then
    BUILD_LINUX=true
    BUILD_WINDOWS=true
    BUILD_MACOS=true
fi

for arg in "$@"; do
    case $arg in
        --push)
            PUSH_RELEASE=true
            ;;
        --parallel)
            PARALLEL=true
            ;;
        linux)
            BUILD_LINUX=true
            ;;
        windows)
            BUILD_WINDOWS=true
            ;;
        macos)
            BUILD_MACOS=true
            ;;
        all)
            BUILD_LINUX=true
            BUILD_WINDOWS=true
            BUILD_MACOS=true
            ;;
        *)
            ;;
    esac
done

# Header
echo -e "${CYAN}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     Kaizen Launcher - Docker Release Builder          ║${NC}"
echo -e "${CYAN}║                   Version $VERSION                       ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════════╝${NC}"
echo ""

# Check Docker
check_docker() {
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}✗ Docker not found. Please install Docker.${NC}"
        exit 1
    fi

    if ! docker info &> /dev/null; then
        echo -e "${RED}✗ Docker daemon not running. Please start Docker.${NC}"
        exit 1
    fi

    echo -e "${GREEN}✓ Docker available${NC}"
}

# Check GitHub CLI
check_gh() {
    if [ "$PUSH_RELEASE" = true ]; then
        if ! command -v gh &> /dev/null; then
            echo -e "${RED}✗ GitHub CLI (gh) not found. Please install it for --push.${NC}"
            exit 1
        fi

        if ! gh auth status &> /dev/null; then
            echo -e "${RED}✗ Not logged in to GitHub. Run: gh auth login${NC}"
            exit 1
        fi

        echo -e "${GREEN}✓ GitHub CLI authenticated${NC}"
    fi
}

# Create output directory
setup_output() {
    rm -rf "$OUTPUT_DIR"
    mkdir -p "$OUTPUT_DIR"
    mkdir -p "$PROJECT_DIR/dist-docker/linux"
    mkdir -p "$PROJECT_DIR/dist-docker/windows"
    echo -e "${GREEN}✓ Output directories created${NC}"
}

# Build Linux
build_linux() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Building for Linux (Docker)...${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    START_TIME=$(date +%s)

    cd "$DOCKER_DIR"
    docker compose build build-linux
    docker compose run --rm build-linux

    END_TIME=$(date +%s)
    DURATION=$((END_TIME - START_TIME))

    # Copy artifacts
    cp "$PROJECT_DIR/dist-docker/linux/deb/"*.deb "$OUTPUT_DIR/" 2>/dev/null || true
    cp "$PROJECT_DIR/dist-docker/linux/appimage/"*.AppImage "$OUTPUT_DIR/" 2>/dev/null || true

    echo -e "${GREEN}✓ Linux build completed in ${DURATION}s${NC}"
}

# Build Windows (cross-compilation)
build_windows() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Building for Windows (Docker cross-compile)...${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    START_TIME=$(date +%s)

    cd "$DOCKER_DIR"
    docker compose build build-windows
    docker compose run --rm build-windows

    END_TIME=$(date +%s)
    DURATION=$((END_TIME - START_TIME))

    # Copy artifacts
    cp "$PROJECT_DIR/dist-docker/windows/"*.exe "$OUTPUT_DIR/" 2>/dev/null || true

    echo -e "${GREEN}✓ Windows build completed in ${DURATION}s${NC}"
}

# Build macOS (native only)
build_macos() {
    if [[ "$(uname -s)" != "Darwin" ]]; then
        echo -e "${YELLOW}⚠ Skipping macOS build (not on macOS)${NC}"
        echo -e "${YELLOW}  macOS must be built on a Mac due to Apple licensing.${NC}"
        return
    fi

    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Building for macOS (native)...${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    cd "$PROJECT_DIR"

    # Build ARM
    echo -e "${CYAN}Building macOS ARM64...${NC}"
    START_TIME=$(date +%s)
    npm run tauri build -- --target aarch64-apple-darwin
    END_TIME=$(date +%s)
    echo -e "${GREEN}✓ macOS ARM64 in $((END_TIME - START_TIME))s${NC}"

    # Build x86
    echo -e "${CYAN}Building macOS x86_64...${NC}"
    START_TIME=$(date +%s)
    npm run tauri build -- --target x86_64-apple-darwin
    END_TIME=$(date +%s)
    echo -e "${GREEN}✓ macOS x86_64 in $((END_TIME - START_TIME))s${NC}"

    # Copy artifacts
    cp "$PROJECT_DIR/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/"*.dmg "$OUTPUT_DIR/" 2>/dev/null || true
    cp "$PROJECT_DIR/src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/"*.dmg "$OUTPUT_DIR/" 2>/dev/null || true

    echo -e "${GREEN}✓ macOS builds completed${NC}"
}

# Push to GitHub
push_release() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Creating GitHub Release v$VERSION...${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    cd "$PROJECT_DIR"

    # Check if tag exists
    if git rev-parse "v$VERSION" >/dev/null 2>&1; then
        echo -e "${YELLOW}Tag v$VERSION already exists${NC}"
    else
        echo -e "${CYAN}Creating tag v$VERSION...${NC}"
        git tag -a "v$VERSION" -m "Release v$VERSION"
        git push origin "v$VERSION"
    fi

    # Create release
    echo -e "${CYAN}Creating GitHub release...${NC}"

    # Get changelog for this version
    CHANGELOG=$(awk "/## \[$VERSION\]/,/## \[/" "$PROJECT_DIR/CHANGELOG.md" | head -n -1)

    gh release create "v$VERSION" \
        --title "Kaizen Launcher v$VERSION" \
        --notes "$CHANGELOG" \
        --draft \
        "$OUTPUT_DIR"/* || {
            echo -e "${YELLOW}Release may already exist, uploading assets...${NC}"
            for file in "$OUTPUT_DIR"/*; do
                gh release upload "v$VERSION" "$file" --clobber || true
            done
        }

    # Publish release
    gh release edit "v$VERSION" --draft=false

    echo -e "${GREEN}✓ Release v$VERSION published!${NC}"
    echo -e "${CYAN}View at: https://github.com/KaizenCore/Kaizen-Launcher/releases/tag/v$VERSION${NC}"
}

# Main
main() {
    check_docker
    check_gh
    setup_output

    if [ "$PARALLEL" = true ] && [ "$BUILD_LINUX" = true ] && [ "$BUILD_WINDOWS" = true ]; then
        echo -e "${CYAN}Building Linux and Windows in parallel...${NC}"
        build_linux &
        PID_LINUX=$!
        build_windows &
        PID_WINDOWS=$!

        wait $PID_LINUX
        wait $PID_WINDOWS
    else
        [ "$BUILD_LINUX" = true ] && build_linux
        [ "$BUILD_WINDOWS" = true ] && build_windows
    fi

    [ "$BUILD_MACOS" = true ] && build_macos

    # Show results
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║              Build Complete!                          ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "Artifacts in: ${BLUE}$OUTPUT_DIR${NC}"
    echo ""
    ls -la "$OUTPUT_DIR" 2>/dev/null || echo "No artifacts found"

    # Push if requested
    [ "$PUSH_RELEASE" = true ] && push_release
}

main
