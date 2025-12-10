#!/bin/bash
#
# Kaizen Launcher - Complete Release Script
# ==========================================
# Builds all platforms via Docker and publishes to GitHub
#
# Features:
# - Automatic version increment (patch, minor, major)
# - Updates all version files (package.json, Cargo.toml, tauri.conf.json)
# - Auto-generates changelog entries
# - Cross-platform builds via Docker (Linux, Windows) + native macOS
# - Creates GitHub releases with proper changelog
# - Generates update metadata for auto-updater
#
# Usage:
#   ./scripts/release.sh                    # Interactive mode
#   ./scripts/release.sh patch              # Bump patch version and release
#   ./scripts/release.sh minor              # Bump minor version and release
#   ./scripts/release.sh major              # Bump major version and release
#   ./scripts/release.sh --version 1.0.0    # Set specific version
#   ./scripts/release.sh --dry-run          # Show what would happen
#   ./scripts/release.sh --skip-build       # Skip builds, only create release
#   ./scripts/release.sh --only-build       # Only build, don't push release
#
# Options:
#   --parallel          Build Linux/Windows in parallel
#   --no-macos          Skip macOS builds
#   --no-linux          Skip Linux builds
#   --no-windows        Skip Windows builds
#   --draft             Create release as draft
#   --prerelease        Mark release as prerelease
#   --notes "..."       Custom release notes (appended to changelog)

set -e

# ============================================================================
# Configuration
# ============================================================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DOCKER_DIR="$PROJECT_DIR/docker"
OUTPUT_DIR="$PROJECT_DIR/dist-release"

# Files to update version in
VERSION_FILES=(
    "$PROJECT_DIR/package.json"
    "$PROJECT_DIR/src-tauri/Cargo.toml"
    "$PROJECT_DIR/src-tauri/tauri.conf.json"
)

# Default options
DRY_RUN=false
SKIP_BUILD=false
ONLY_BUILD=false
PARALLEL=false
BUILD_MACOS=true
BUILD_LINUX=true
BUILD_WINDOWS=true
DRAFT=false
PRERELEASE=false
CUSTOM_NOTES=""
VERSION_BUMP=""
SPECIFIC_VERSION=""

# Signing keys (can be set via environment or .env file)
SIGNING_KEY_FILE=""
SIGNING_KEY_PASSWORD=""

# Git options
AUTO_COMMIT=false
STASHED_CHANGES=false

# ============================================================================
# Helper Functions
# ============================================================================

print_header() {
    echo ""
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}         ${BOLD}Kaizen Launcher - Release Manager${NC}                      ${CYAN}║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_section() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

log_info() {
    echo -e "${CYAN}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

log_step() {
    echo -e "${MAGENTA}→${NC} $1"
}

# Get current version from package.json
get_current_version() {
    grep '"version"' "$PROJECT_DIR/package.json" | head -1 | sed 's/.*"version": "\(.*\)".*/\1/'
}

# Parse semantic version
parse_version() {
    local version=$1
    IFS='.' read -r -a parts <<< "$version"
    MAJOR="${parts[0]:-0}"
    MINOR="${parts[1]:-0}"
    PATCH="${parts[2]:-0}"
}

# Increment version
increment_version() {
    local current=$1
    local bump_type=$2

    parse_version "$current"

    case $bump_type in
        major)
            MAJOR=$((MAJOR + 1))
            MINOR=0
            PATCH=0
            ;;
        minor)
            MINOR=$((MINOR + 1))
            PATCH=0
            ;;
        patch)
            PATCH=$((PATCH + 1))
            ;;
    esac

    echo "${MAJOR}.${MINOR}.${PATCH}"
}

# Update version in a file
update_version_in_file() {
    local file=$1
    local old_version=$2
    local new_version=$3

    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY-RUN] Would update $file: $old_version → $new_version"
        return
    fi

    case "$file" in
        *.json)
            # For JSON files, update "version": "x.x.x"
            sed -i.bak "s/\"version\": \"$old_version\"/\"version\": \"$new_version\"/" "$file"
            rm -f "$file.bak"
            ;;
        *Cargo.toml)
            # For Cargo.toml, update version = "x.x.x" in [package] section
            sed -i.bak "s/^version = \"$old_version\"/version = \"$new_version\"/" "$file"
            rm -f "$file.bak"
            ;;
    esac

    log_success "Updated $(basename "$file")"
}

# Update all version files
update_all_versions() {
    local old_version=$1
    local new_version=$2

    print_section "Updating Version: $old_version → $new_version"

    for file in "${VERSION_FILES[@]}"; do
        if [ -f "$file" ]; then
            update_version_in_file "$file" "$old_version" "$new_version"
        else
            log_warning "File not found: $file"
        fi
    done
}

# Get commits since last tag
get_commits_since_tag() {
    local last_tag=$(git describe --tags --abbrev=0 2>/dev/null || echo "")

    if [ -z "$last_tag" ]; then
        git log --oneline -20
    else
        git log --oneline "$last_tag"..HEAD
    fi
}

# Categorize commits for changelog
categorize_commits() {
    local commits=$1

    ADDED=""
    CHANGED=""
    FIXED=""
    TECHNICAL=""

    while IFS= read -r line; do
        # Skip empty lines
        [ -z "$line" ] && continue

        # Extract commit message (remove hash)
        local msg=$(echo "$line" | sed 's/^[a-f0-9]* //')

        # Categorize based on conventional commit prefixes
        case "$msg" in
            feat:*|feat\(*|add:*|Add*)
                ADDED="$ADDED\n- ${msg#*: }"
                ;;
            fix:*|fix\(*|Fix*)
                FIXED="$FIXED\n- ${msg#*: }"
                ;;
            refactor:*|perf:*|style:*)
                CHANGED="$CHANGED\n- ${msg#*: }"
                ;;
            chore:*|docs:*|test:*|ci:*|build:*)
                TECHNICAL="$TECHNICAL\n- ${msg#*: }"
                ;;
            *)
                # Uncategorized commits go to Changed
                CHANGED="$CHANGED\n- $msg"
                ;;
        esac
    done <<< "$commits"
}

# Generate changelog entry
generate_changelog_entry() {
    local version=$1
    local date=$(date +%Y-%m-%d)

    local commits=$(get_commits_since_tag)
    categorize_commits "$commits"

    local entry="## [$version] - $date\n"

    if [ -n "$ADDED" ]; then
        entry="$entry\n### Added$ADDED\n"
    fi

    if [ -n "$CHANGED" ]; then
        entry="$entry\n### Changed$CHANGED\n"
    fi

    if [ -n "$FIXED" ]; then
        entry="$entry\n### Fixed$FIXED\n"
    fi

    if [ -n "$TECHNICAL" ]; then
        entry="$entry\n### Technical$TECHNICAL\n"
    fi

    # If no commits found, add placeholder
    if [ -z "$ADDED" ] && [ -z "$CHANGED" ] && [ -z "$FIXED" ] && [ -z "$TECHNICAL" ]; then
        entry="$entry\n### Changed\n- Release $version\n"
    fi

    echo -e "$entry"
}

# Update CHANGELOG.md
update_changelog() {
    local version=$1
    local changelog_file="$PROJECT_DIR/CHANGELOG.md"

    print_section "Updating Changelog"

    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY-RUN] Would update CHANGELOG.md with:"
        generate_changelog_entry "$version"
        return
    fi

    # Generate new entry
    local new_entry=$(generate_changelog_entry "$version")

    # Create temp file with new entry
    local temp_file=$(mktemp)

    # Add header and new entry
    echo "# Changelog" > "$temp_file"
    echo "" >> "$temp_file"
    echo "All notable changes to Kaizen Launcher will be documented in this file." >> "$temp_file"
    echo "" >> "$temp_file"
    echo -e "$new_entry" >> "$temp_file"

    # Append existing entries (skip header)
    tail -n +5 "$changelog_file" >> "$temp_file" 2>/dev/null || true

    # Replace changelog
    mv "$temp_file" "$changelog_file"

    log_success "Changelog updated"
}

# Extract changelog for specific version
get_version_changelog() {
    local version=$1
    local changelog_file="$PROJECT_DIR/CHANGELOG.md"

    # Extract section between version header and next version header
    awk "/## \[$version\]/,/## \[/" "$changelog_file" | head -n -1
}

# ============================================================================
# Signing Key Management
# ============================================================================

load_signing_keys() {
    print_section "Loading Signing Keys"

    # Try to load from .env file first
    local env_file="$PROJECT_DIR/.env"
    local env_local="$PROJECT_DIR/.env.local"
    local keys_file="$PROJECT_DIR/.tauri-signing-keys"

    # Check .env.local first (higher priority)
    if [ -f "$env_local" ]; then
        log_info "Loading keys from .env.local"
        source "$env_local" 2>/dev/null || true
    elif [ -f "$env_file" ]; then
        log_info "Loading keys from .env"
        source "$env_file" 2>/dev/null || true
    elif [ -f "$keys_file" ]; then
        log_info "Loading keys from .tauri-signing-keys"
        source "$keys_file" 2>/dev/null || true
    fi

    # Check if keys are already in environment
    if [ -n "$TAURI_SIGNING_PRIVATE_KEY" ]; then
        log_success "Signing key found in environment"
        return 0
    fi

    # Try to load from file path
    if [ -n "$SIGNING_KEY_FILE" ] && [ -f "$SIGNING_KEY_FILE" ]; then
        TAURI_SIGNING_PRIVATE_KEY=$(cat "$SIGNING_KEY_FILE")
        export TAURI_SIGNING_PRIVATE_KEY
        log_success "Signing key loaded from file: $SIGNING_KEY_FILE"
    fi

    # Set password if provided
    if [ -n "$SIGNING_KEY_PASSWORD" ]; then
        export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$SIGNING_KEY_PASSWORD"
    fi

    # Final check
    if [ -z "$TAURI_SIGNING_PRIVATE_KEY" ]; then
        log_warning "No signing key found!"
        echo ""
        echo -e "${YELLOW}To enable signed releases, set one of:${NC}"
        echo "  1. Environment variable: TAURI_SIGNING_PRIVATE_KEY"
        echo "  2. Create .env.local with TAURI_SIGNING_PRIVATE_KEY=..."
        echo "  3. Use --signing-key <file> option"
        echo ""
        echo -e "${CYAN}Generate keys with: npx tauri signer generate -w ~/.tauri/kaizen.key${NC}"
        echo ""

        if [ "$DRY_RUN" = false ]; then
            read -p "Continue without signing? [y/N] " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                exit 1
            fi
        fi
    else
        log_success "Signing keys configured"
    fi
}

generate_signing_keys() {
    print_section "Generating New Signing Keys"

    local keys_dir="$HOME/.tauri"
    local key_file="$keys_dir/kaizen.key"
    local pubkey_file="$keys_dir/kaizen.key.pub"

    mkdir -p "$keys_dir"

    if [ -f "$key_file" ]; then
        log_warning "Key file already exists: $key_file"
        read -p "Overwrite? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            return 1
        fi
    fi

    # Generate keys using Tauri CLI
    log_step "Generating key pair..."

    # Prompt for password
    read -s -p "Enter password for signing key (or leave empty): " key_password
    echo

    if [ -n "$key_password" ]; then
        echo "$key_password" | npx tauri signer generate -w "$key_file"
    else
        npx tauri signer generate -w "$key_file" <<< ""
    fi

    if [ -f "$key_file" ] && [ -f "$pubkey_file" ]; then
        log_success "Keys generated successfully!"
        echo ""
        echo -e "Private key: ${CYAN}$key_file${NC}"
        echo -e "Public key:  ${CYAN}$pubkey_file${NC}"
        echo ""

        # Show public key for tauri.conf.json
        echo -e "${YELLOW}Add this public key to tauri.conf.json > plugins > updater > pubkey:${NC}"
        cat "$pubkey_file"
        echo ""

        # Create .env.local template
        local env_template="$PROJECT_DIR/.env.local.example"
        cat > "$env_template" << EOF
# Tauri Signing Keys
# Copy this file to .env.local and fill in your keys
# DO NOT commit .env.local to version control!

TAURI_SIGNING_PRIVATE_KEY=$(cat "$key_file")
TAURI_SIGNING_PRIVATE_KEY_PASSWORD=$key_password
EOF
        log_info "Created template: $env_template"
    else
        log_error "Failed to generate keys"
        return 1
    fi
}

# ============================================================================
# Pre-flight Checks
# ============================================================================

check_dependencies() {
    print_section "Checking Dependencies"

    local missing=()

    # Check Docker
    if ! command -v docker &> /dev/null; then
        missing+=("docker")
    elif ! docker info &> /dev/null; then
        log_error "Docker daemon is not running"
        exit 1
    else
        log_success "Docker available"
    fi

    # Check GitHub CLI
    if ! command -v gh &> /dev/null; then
        missing+=("gh (GitHub CLI)")
    elif ! gh auth status &> /dev/null 2>&1; then
        log_warning "Not logged in to GitHub CLI. Run: gh auth login"
        if [ "$ONLY_BUILD" = false ] && [ "$DRY_RUN" = false ]; then
            exit 1
        fi
    else
        log_success "GitHub CLI authenticated"
    fi

    # Check git
    if ! command -v git &> /dev/null; then
        missing+=("git")
    else
        log_success "Git available"
    fi

    # Check jq (optional but recommended)
    if ! command -v jq &> /dev/null; then
        log_warning "jq not found (optional, using sed for JSON manipulation)"
    else
        log_success "jq available"
    fi

    # Check Node.js
    if ! command -v node &> /dev/null; then
        missing+=("node")
    else
        log_success "Node.js $(node --version) available"
    fi

    # Check Rust (for macOS builds)
    if [ "$BUILD_MACOS" = true ]; then
        if ! command -v cargo &> /dev/null; then
            log_warning "Cargo not found, macOS builds will fail"
        else
            log_success "Cargo $(cargo --version | cut -d' ' -f2) available"
        fi
    fi

    if [ ${#missing[@]} -gt 0 ]; then
        log_error "Missing dependencies: ${missing[*]}"
        exit 1
    fi
}

check_git_status() {
    print_section "Checking Git Status"

    cd "$PROJECT_DIR"

    # Check for uncommitted changes
    if [ -n "$(git status --porcelain)" ]; then
        log_warning "You have uncommitted changes:"
        git status --short
        echo ""

        if [ "$DRY_RUN" = true ]; then
            log_info "[DRY-RUN] Would handle uncommitted changes"
        elif [ "$AUTO_COMMIT" = true ]; then
            # Auto-commit mode
            log_step "Auto-committing changes..."
            git add -A
            git commit -m "$(cat <<EOF
chore: pre-release changes

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
            log_success "Changes auto-committed"
        else
            echo -e "${BOLD}What would you like to do?${NC}"
            echo ""
            echo -e "  ${BOLD}1)${NC} Commit changes now (recommended)"
            echo -e "  ${BOLD}2)${NC} Stash changes and continue"
            echo -e "  ${BOLD}3)${NC} Continue without committing"
            echo -e "  ${BOLD}4)${NC} Cancel"
            echo ""
            read -p "Choice [1-4]: " choice

            case $choice in
                1)
                    # Commit changes
                    echo ""
                    read -p "Enter commit message (or press Enter for default): " commit_msg
                    if [ -z "$commit_msg" ]; then
                        commit_msg="chore: pre-release changes"
                    fi

                    log_step "Adding all changes..."
                    git add -A

                    log_step "Committing..."
                    git commit -m "$(cat <<EOF
$commit_msg

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
                    log_success "Changes committed"
                    ;;
                2)
                    # Stash changes
                    log_step "Stashing changes..."
                    git stash push -m "Pre-release stash $(date +%Y%m%d-%H%M%S)"
                    log_success "Changes stashed (use 'git stash pop' to restore)"
                    STASHED_CHANGES=true
                    ;;
                3)
                    # Continue anyway
                    log_warning "Continuing with uncommitted changes..."
                    ;;
                *)
                    echo "Cancelled."
                    exit 0
                    ;;
            esac
        fi
    else
        log_success "Working directory clean"
    fi

    # Check current branch
    local branch=$(git branch --show-current)
    log_info "Current branch: $branch"

    if [ "$branch" != "main" ] && [ "$branch" != "master" ]; then
        log_warning "Not on main/master branch"
    fi
}

# ============================================================================
# Build Functions
# ============================================================================

setup_output_dir() {
    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY-RUN] Would create output directory: $OUTPUT_DIR"
        return
    fi

    rm -rf "$OUTPUT_DIR"
    mkdir -p "$OUTPUT_DIR"
    mkdir -p "$PROJECT_DIR/dist-docker/linux"
    mkdir -p "$PROJECT_DIR/dist-docker/windows"

    log_success "Output directories created"
}

build_linux() {
    print_section "Building for Linux (Docker)"

    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY-RUN] Would build Linux via Docker"
        return
    fi

    local start_time=$(date +%s)

    cd "$DOCKER_DIR"

    # Export signing keys for Docker build
    export TAURI_SIGNING_PRIVATE_KEY="${TAURI_SIGNING_PRIVATE_KEY:-}"
    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

    log_step "Building Docker image..."
    docker compose build \
        --build-arg TAURI_SIGNING_PRIVATE_KEY="$TAURI_SIGNING_PRIVATE_KEY" \
        --build-arg TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" \
        build-linux

    log_step "Running build..."
    docker compose run --rm \
        -e TAURI_SIGNING_PRIVATE_KEY="$TAURI_SIGNING_PRIVATE_KEY" \
        -e TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" \
        build-linux

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    # Copy artifacts (deb and rpm from Docker, AppImage built via GitHub Actions)
    cp "$PROJECT_DIR/dist-docker/linux/deb/"*.deb "$OUTPUT_DIR/" 2>/dev/null || true
    cp "$PROJECT_DIR/dist-docker/linux/deb/"*.sig "$OUTPUT_DIR/" 2>/dev/null || true
    cp "$PROJECT_DIR/dist-docker/linux/rpm/"*.rpm "$OUTPUT_DIR/" 2>/dev/null || true
    cp "$PROJECT_DIR/dist-docker/linux/rpm/"*.sig "$OUTPUT_DIR/" 2>/dev/null || true

    log_success "Linux build completed in ${duration}s"
    log_info "Note: AppImage will be built via GitHub Actions"
}

build_windows() {
    print_section "Building for Windows (Docker cross-compile)"

    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY-RUN] Would build Windows via Docker"
        return
    fi

    local start_time=$(date +%s)

    cd "$DOCKER_DIR"

    # Export signing keys for Docker build
    export TAURI_SIGNING_PRIVATE_KEY="${TAURI_SIGNING_PRIVATE_KEY:-}"
    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

    log_step "Building Docker image..."
    docker compose build \
        --build-arg TAURI_SIGNING_PRIVATE_KEY="$TAURI_SIGNING_PRIVATE_KEY" \
        --build-arg TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" \
        build-windows

    log_step "Running build..."
    docker compose run --rm \
        -e TAURI_SIGNING_PRIVATE_KEY="$TAURI_SIGNING_PRIVATE_KEY" \
        -e TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" \
        build-windows

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    # Copy artifacts
    cp "$PROJECT_DIR/dist-docker/windows/"*.exe "$OUTPUT_DIR/" 2>/dev/null || true
    cp "$PROJECT_DIR/dist-docker/windows/"*.msi "$OUTPUT_DIR/" 2>/dev/null || true
    cp "$PROJECT_DIR/dist-docker/windows/"*.json "$OUTPUT_DIR/" 2>/dev/null || true
    cp "$PROJECT_DIR/dist-docker/windows/"*.sig "$OUTPUT_DIR/" 2>/dev/null || true

    log_success "Windows build completed in ${duration}s"
}

build_macos() {
    if [[ "$(uname -s)" != "Darwin" ]]; then
        log_warning "Skipping macOS build (not running on macOS)"
        return
    fi

    print_section "Building for macOS (native)"

    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY-RUN] Would build macOS (ARM64 + x86_64)"
        return
    fi

    cd "$PROJECT_DIR"

    # Build ARM64
    log_step "Building macOS ARM64..."
    local start_time=$(date +%s)
    npm run tauri build -- --target aarch64-apple-darwin
    local end_time=$(date +%s)
    log_success "macOS ARM64 completed in $((end_time - start_time))s"

    # Build x86_64
    log_step "Building macOS x86_64..."
    start_time=$(date +%s)
    npm run tauri build -- --target x86_64-apple-darwin
    end_time=$(date +%s)
    log_success "macOS x86_64 completed in $((end_time - start_time))s"

    # Copy artifacts
    cp "$PROJECT_DIR/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/"*.dmg "$OUTPUT_DIR/" 2>/dev/null || true
    cp "$PROJECT_DIR/src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/"*.dmg "$OUTPUT_DIR/" 2>/dev/null || true
    cp "$PROJECT_DIR/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/"*.app.tar.gz "$OUTPUT_DIR/" 2>/dev/null || true
    cp "$PROJECT_DIR/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/"*.app.tar.gz "$OUTPUT_DIR/" 2>/dev/null || true
    cp "$PROJECT_DIR/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/"*.app.tar.gz.sig "$OUTPUT_DIR/" 2>/dev/null || true
    cp "$PROJECT_DIR/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/"*.app.tar.gz.sig "$OUTPUT_DIR/" 2>/dev/null || true

    log_success "macOS builds completed"
}

trigger_appimage_workflow() {
    local version=$1

    print_section "Triggering GitHub Actions for AppImage"

    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY-RUN] Would trigger build-appimage workflow for v$version"
        return
    fi

    log_step "Triggering AppImage build workflow..."

    # Trigger the workflow
    gh workflow run build-appimage.yml \
        --field tag="v$version" \
        --field upload_to_release="true" \
        2>/dev/null || {
            log_warning "Could not trigger AppImage workflow automatically"
            echo ""
            echo -e "${YELLOW}To build AppImage manually, run:${NC}"
            echo "  gh workflow run build-appimage.yml -f tag=v$version -f upload_to_release=true"
            return
        }

    log_success "AppImage workflow triggered!"
    echo ""
    log_info "The AppImage will be built on GitHub and uploaded to the release."
    log_info "Monitor progress: gh run list --workflow=build-appimage.yml"
}

run_builds() {
    setup_output_dir

    if [ "$PARALLEL" = true ] && [ "$BUILD_LINUX" = true ] && [ "$BUILD_WINDOWS" = true ]; then
        print_section "Building Linux & Windows in Parallel"

        if [ "$DRY_RUN" = false ]; then
            build_linux &
            local pid_linux=$!

            build_windows &
            local pid_windows=$!

            wait $pid_linux || log_error "Linux build failed"
            wait $pid_windows || log_error "Windows build failed"
        else
            log_info "[DRY-RUN] Would run Linux and Windows builds in parallel"
        fi
    else
        [ "$BUILD_LINUX" = true ] && build_linux
        [ "$BUILD_WINDOWS" = true ] && build_windows
    fi

    [ "$BUILD_MACOS" = true ] && build_macos
}

# ============================================================================
# Release Functions
# ============================================================================

generate_latest_json() {
    local version=$1
    local output_file="$OUTPUT_DIR/latest.json"

    print_section "Generating Update Manifest"

    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY-RUN] Would generate latest.json"
        return
    fi

    local date=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    local notes=$(get_version_changelog "$version" | tr '\n' ' ' | sed 's/"/\\"/g')

    # Base URL for releases
    local base_url="https://github.com/KaizenCore/Kaizen-Launcher/releases/download/v${version}"

    # Start JSON
    cat > "$output_file" << EOF
{
  "version": "$version",
  "notes": "$notes",
  "pub_date": "$date",
  "platforms": {
EOF

    local first=true

    # macOS ARM64
    local macos_arm_file=$(ls "$OUTPUT_DIR/"*aarch64*.app.tar.gz 2>/dev/null | head -1)
    local macos_arm_sig=$(ls "$OUTPUT_DIR/"*aarch64*.app.tar.gz.sig 2>/dev/null | head -1)
    if [ -n "$macos_arm_file" ] && [ -n "$macos_arm_sig" ]; then
        local sig=$(cat "$macos_arm_sig")
        [ "$first" = false ] && echo "," >> "$output_file"
        first=false
        cat >> "$output_file" << EOF
    "darwin-aarch64": {
      "signature": "$sig",
      "url": "$base_url/$(basename "$macos_arm_file")"
    }
EOF
    fi

    # macOS x86_64
    local macos_x86_file=$(ls "$OUTPUT_DIR/"*x86_64*.app.tar.gz 2>/dev/null | head -1)
    local macos_x86_sig=$(ls "$OUTPUT_DIR/"*x86_64*.app.tar.gz.sig 2>/dev/null | head -1)
    if [ -n "$macos_x86_file" ] && [ -n "$macos_x86_sig" ]; then
        local sig=$(cat "$macos_x86_sig")
        [ "$first" = false ] && echo "," >> "$output_file"
        first=false
        cat >> "$output_file" << EOF
    "darwin-x86_64": {
      "signature": "$sig",
      "url": "$base_url/$(basename "$macos_x86_file")"
    }
EOF
    fi

    # Linux x86_64
    local linux_file=$(ls "$OUTPUT_DIR/"*.AppImage 2>/dev/null | head -1)
    local linux_sig=$(ls "$OUTPUT_DIR/"*.AppImage.sig 2>/dev/null | head -1)
    if [ -n "$linux_file" ] && [ -n "$linux_sig" ]; then
        local sig=$(cat "$linux_sig")
        [ "$first" = false ] && echo "," >> "$output_file"
        first=false
        cat >> "$output_file" << EOF
    "linux-x86_64": {
      "signature": "$sig",
      "url": "$base_url/$(basename "$linux_file")"
    }
EOF
    fi

    # Windows x86_64
    local windows_file=$(ls "$OUTPUT_DIR/"*.exe 2>/dev/null | grep -i setup | head -1)
    local windows_sig=$(ls "$OUTPUT_DIR/"*.exe.sig 2>/dev/null | head -1)
    if [ -n "$windows_file" ] && [ -n "$windows_sig" ]; then
        local sig=$(cat "$windows_sig")
        [ "$first" = false ] && echo "," >> "$output_file"
        first=false
        cat >> "$output_file" << EOF
    "windows-x86_64": {
      "signature": "$sig",
      "url": "$base_url/$(basename "$windows_file")"
    }
EOF
    fi

    # Close JSON
    cat >> "$output_file" << EOF

  }
}
EOF

    log_success "Generated latest.json"
}

commit_version_changes() {
    local version=$1

    print_section "Committing Version Changes"

    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY-RUN] Would commit version changes and create tag v$version"
        return
    fi

    cd "$PROJECT_DIR"

    # Add changed files
    git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json CHANGELOG.md

    # Commit
    git commit -m "$(cat <<EOF
chore(release): bump version to $version

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"

    log_success "Changes committed"

    # Create tag
    if git rev-parse "v$version" >/dev/null 2>&1; then
        log_warning "Tag v$version already exists"
    else
        git tag -a "v$version" -m "Release v$version"
        log_success "Tag v$version created"
    fi
}

push_to_github() {
    local version=$1

    print_section "Pushing to GitHub"

    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY-RUN] Would push commits and tag to GitHub"
        return
    fi

    cd "$PROJECT_DIR"

    log_step "Pushing commits..."
    git push origin HEAD

    log_step "Pushing tag..."
    git push origin "v$version"

    log_success "Pushed to GitHub"
}

create_github_release() {
    local version=$1

    print_section "Creating GitHub Release"

    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY-RUN] Would create GitHub release v$version"
        log_info "Artifacts that would be uploaded:"
        ls -la "$OUTPUT_DIR" 2>/dev/null || echo "  (no artifacts)"
        return
    fi

    cd "$PROJECT_DIR"

    # Get changelog
    local changelog=$(get_version_changelog "$version")

    # Add custom notes if provided
    if [ -n "$CUSTOM_NOTES" ]; then
        changelog="$changelog

---

$CUSTOM_NOTES"
    fi

    # Build gh release command
    local gh_args=("release" "create" "v$version")
    gh_args+=("--title" "Kaizen Launcher v$version")
    gh_args+=("--notes" "$changelog")

    [ "$DRAFT" = true ] && gh_args+=("--draft")
    [ "$PRERELEASE" = true ] && gh_args+=("--prerelease")

    # Add all artifacts
    for file in "$OUTPUT_DIR"/*; do
        if [ -f "$file" ]; then
            gh_args+=("$file")
        fi
    done

    log_step "Creating release..."
    gh "${gh_args[@]}" || {
        log_warning "Release may already exist, uploading assets..."
        for file in "$OUTPUT_DIR"/*; do
            if [ -f "$file" ]; then
                gh release upload "v$version" "$file" --clobber || true
            fi
        done
    }

    # If not draft, ensure it's published
    if [ "$DRAFT" = false ]; then
        gh release edit "v$version" --draft=false 2>/dev/null || true
    fi

    log_success "Release v$version created!"
    echo ""
    log_info "View at: ${CYAN}https://github.com/KaizenCore/Kaizen-Launcher/releases/tag/v$version${NC}"
}

# ============================================================================
# Interactive Mode
# ============================================================================

interactive_version_prompt() {
    local current=$1

    echo ""
    echo -e "${BOLD}Current version: ${CYAN}$current${NC}"
    echo ""
    echo "Select version bump type:"
    echo ""

    local next_patch=$(increment_version "$current" "patch")
    local next_minor=$(increment_version "$current" "minor")
    local next_major=$(increment_version "$current" "major")

    echo -e "  ${BOLD}1)${NC} patch  → ${GREEN}$next_patch${NC}  (bug fixes)"
    echo -e "  ${BOLD}2)${NC} minor  → ${GREEN}$next_minor${NC}  (new features)"
    echo -e "  ${BOLD}3)${NC} major  → ${GREEN}$next_major${NC}  (breaking changes)"
    echo -e "  ${BOLD}4)${NC} custom → enter specific version"
    echo -e "  ${BOLD}5)${NC} cancel"
    echo ""

    read -p "Choice [1-5]: " choice

    case $choice in
        1) VERSION_BUMP="patch" ;;
        2) VERSION_BUMP="minor" ;;
        3) VERSION_BUMP="major" ;;
        4)
            read -p "Enter version (e.g., 1.0.0): " SPECIFIC_VERSION
            ;;
        *)
            echo "Cancelled."
            exit 0
            ;;
    esac
}

# ============================================================================
# Argument Parsing
# ============================================================================

parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            patch|minor|major)
                VERSION_BUMP="$1"
                shift
                ;;
            --version|-v)
                SPECIFIC_VERSION="$2"
                shift 2
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --skip-build)
                SKIP_BUILD=true
                shift
                ;;
            --only-build)
                ONLY_BUILD=true
                shift
                ;;
            --parallel)
                PARALLEL=true
                shift
                ;;
            --no-macos)
                BUILD_MACOS=false
                shift
                ;;
            --no-linux)
                BUILD_LINUX=false
                shift
                ;;
            --no-windows)
                BUILD_WINDOWS=false
                shift
                ;;
            --draft)
                DRAFT=true
                shift
                ;;
            --prerelease)
                PRERELEASE=true
                shift
                ;;
            --notes)
                CUSTOM_NOTES="$2"
                shift 2
                ;;
            --signing-key)
                SIGNING_KEY_FILE="$2"
                shift 2
                ;;
            --signing-password)
                SIGNING_KEY_PASSWORD="$2"
                shift 2
                ;;
            --generate-keys)
                generate_signing_keys
                exit 0
                ;;
            --auto-commit)
                AUTO_COMMIT=true
                shift
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done
}

show_help() {
    cat << EOF
Kaizen Launcher - Release Manager

Usage:
  ./scripts/release.sh [VERSION_BUMP] [OPTIONS]

Version Bump:
  patch                 Bump patch version (0.1.0 → 0.1.1)
  minor                 Bump minor version (0.1.0 → 0.2.0)
  major                 Bump major version (0.1.0 → 1.0.0)
  --version, -v VER     Set specific version

Build Options:
  --dry-run             Show what would happen without making changes
  --skip-build          Skip builds, only update version and create release
  --only-build          Only build, don't push release to GitHub
  --parallel            Build Linux and Windows in parallel
  --no-macos            Skip macOS builds
  --no-linux            Skip Linux builds
  --no-windows          Skip Windows builds

Signing Options:
  --signing-key FILE    Path to Tauri signing private key file
  --signing-password PW Password for the signing key
  --generate-keys       Generate new signing keys and exit

Git Options:
  --auto-commit         Automatically commit uncommitted changes

Release Options:
  --draft               Create release as draft
  --prerelease          Mark release as prerelease
  --notes "..."         Add custom release notes
  --help, -h            Show this help message

Environment Variables:
  TAURI_SIGNING_PRIVATE_KEY          Signing key content
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD Signing key password

Examples:
  ./scripts/release.sh                      # Interactive mode
  ./scripts/release.sh patch                # Quick patch release
  ./scripts/release.sh minor --parallel     # Minor release with parallel builds
  ./scripts/release.sh --version 1.0.0      # Release version 1.0.0
  ./scripts/release.sh patch --dry-run      # Preview patch release
  ./scripts/release.sh --only-build         # Build without releasing
  ./scripts/release.sh --generate-keys      # Generate new signing keys

Signing Key Setup:
  1. Generate keys:     ./scripts/release.sh --generate-keys
  2. Create .env.local: cp .env.local.example .env.local
  3. The script will auto-load keys from .env.local
EOF
}

# ============================================================================
# Main
# ============================================================================

main() {
    parse_arguments "$@"

    print_header

    # Show mode
    if [ "$DRY_RUN" = true ]; then
        echo -e "${YELLOW}Running in DRY-RUN mode - no changes will be made${NC}"
        echo ""
    fi

    # Get current version
    local current_version=$(get_current_version)
    log_info "Current version: $current_version"

    # Determine new version
    local new_version=""

    if [ -n "$SPECIFIC_VERSION" ]; then
        new_version="$SPECIFIC_VERSION"
    elif [ -n "$VERSION_BUMP" ]; then
        new_version=$(increment_version "$current_version" "$VERSION_BUMP")
    else
        # Interactive mode
        interactive_version_prompt "$current_version"

        if [ -n "$SPECIFIC_VERSION" ]; then
            new_version="$SPECIFIC_VERSION"
        else
            new_version=$(increment_version "$current_version" "$VERSION_BUMP")
        fi
    fi

    log_info "New version: $new_version"
    echo ""

    # Pre-flight checks
    check_dependencies
    check_git_status

    # Load signing keys
    load_signing_keys

    # Update versions
    update_all_versions "$current_version" "$new_version"

    # Update changelog
    update_changelog "$new_version"

    # Run builds (unless skipped)
    if [ "$SKIP_BUILD" = false ]; then
        run_builds
    else
        log_info "Skipping builds (--skip-build)"
    fi

    # Commit and release (unless only-build)
    if [ "$ONLY_BUILD" = false ]; then
        commit_version_changes "$new_version"
        push_to_github "$new_version"

        # Generate latest.json for auto-updater
        [ "$SKIP_BUILD" = false ] && generate_latest_json "$new_version"

        create_github_release "$new_version"

        # Trigger GitHub Actions for AppImage (can't build in Docker)
        if [ "$BUILD_LINUX" = true ]; then
            trigger_appimage_workflow "$new_version"
        fi
    else
        log_info "Skipping release (--only-build)"
    fi

    # Summary
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                    Release Complete! 🎉                           ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    if [ "$SKIP_BUILD" = false ]; then
        echo -e "Artifacts in: ${BLUE}$OUTPUT_DIR${NC}"
        echo ""
        ls -lh "$OUTPUT_DIR" 2>/dev/null || echo "No artifacts found"
    fi

    if [ "$ONLY_BUILD" = false ]; then
        echo ""
        echo -e "Release URL: ${CYAN}https://github.com/KaizenCore/Kaizen-Launcher/releases/tag/v$new_version${NC}"
    fi
}

main "$@"
