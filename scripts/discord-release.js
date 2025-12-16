#!/usr/bin/env node

/**
 * Discord Release Announcement Script
 *
 * Usage:
 *   node scripts/discord-release.js [--dry-run] [--message "Custom announcement text"]
 *
 * Environment:
 *   DISCORD_WEBHOOK_URL - Required. Discord webhook URL for announcements
 *
 * This script reads the current version from package.json and extracts
 * the changelog for that version, then posts it to Discord with an optional
 * custom announcement message.
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Configuration
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const DRY_RUN = process.argv.includes('--dry-run');

// Parse --message argument
function getMessageArg() {
    const args = process.argv;
    const msgIndex = args.indexOf('--message');
    if (msgIndex !== -1 && args[msgIndex + 1]) {
        return args[msgIndex + 1];
    }
    return null;
}
const CUSTOM_MESSAGE = getMessageArg();

// Colors for embed
const EMBED_COLOR = 0x5865F2; // Discord blurple

function getVersion() {
    const packagePath = join(rootDir, 'package.json');
    const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
    return pkg.version;
}

function getChangelog(version) {
    const changelogPath = join(rootDir, 'CHANGELOG.md');

    if (!existsSync(changelogPath)) {
        console.error('CHANGELOG.md not found');
        return null;
    }

    const content = readFileSync(changelogPath, 'utf-8');
    const lines = content.split('\n');

    let capturing = false;
    let changelog = [];

    for (const line of lines) {
        // Match version header: ## [0.6.0] - 2025-12-14 or ## [0.6.0] - Unreleased
        const versionMatch = line.match(/^## \[([^\]]+)\]/);

        if (versionMatch) {
            if (capturing) {
                // We've hit the next version, stop capturing
                break;
            }
            if (versionMatch[1] === version) {
                capturing = true;
                continue; // Skip the header line itself
            }
        }

        if (capturing) {
            changelog.push(line);
        }
    }

    // Clean up: remove leading/trailing empty lines
    while (changelog.length > 0 && changelog[0].trim() === '') {
        changelog.shift();
    }
    while (changelog.length > 0 && changelog[changelog.length - 1].trim() === '') {
        changelog.pop();
    }

    return changelog.join('\n');
}

function formatChangelogForDiscord(changelog) {
    if (!changelog) return 'No changelog available.';

    // Convert markdown headers to Discord format
    let formatted = changelog
        // ### Added -> **Added**
        .replace(/^### (.+)$/gm, '**$1**')
        // Keep bullet points as-is (Discord supports them)
        // Truncate if too long (Discord embed description limit is 4096)
        .substring(0, 4000);

    if (changelog.length > 4000) {
        formatted += '\n\n*...truncated*';
    }

    return formatted;
}

async function sendDiscordWebhook(version, changelog, customMessage) {
    if (!WEBHOOK_URL) {
        console.error('Error: DISCORD_WEBHOOK_URL environment variable is not set');
        console.error('');
        console.error('To set it:');
        console.error('  Windows: set DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...');
        console.error('  Linux/Mac: export DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...');
        process.exit(1);
    }

    const formattedChangelog = formatChangelogForDiscord(changelog);

    const payload = {
        embeds: [{
            title: `Kaizen Launcher v${version} Released!`,
            description: formattedChangelog,
            color: EMBED_COLOR,
            thumbnail: {
                url: 'https://launcher.kaizencore.tech/Kaizen.svg'
            },
            footer: {
                text: 'Kaizen Launcher'
            },
            timestamp: new Date().toISOString(),
            fields: [
                {
                    name: 'Download',
                    value: `[GitHub Releases](https://github.com/0xGingi/Kaizen-Launcher/releases/tag/v${version})`,
                    inline: true
                }
            ]
        }]
    };

    // Add custom announcement message before the embed
    if (customMessage) {
        payload.content = customMessage;
    }

    if (DRY_RUN) {
        console.log('=== DRY RUN MODE ===');
        console.log('Would send the following to Discord:');
        console.log(JSON.stringify(payload, null, 2));
        return;
    }

    try {
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Discord API error: ${response.status} - ${error}`);
        }

        console.log(`Successfully announced v${version} on Discord!`);
    } catch (error) {
        console.error('Failed to send Discord webhook:', error.message);
        process.exit(1);
    }
}

async function main() {
    console.log('Discord Release Announcement Script');
    console.log('====================================');

    const version = getVersion();
    console.log(`Version: ${version}`);

    const changelog = getChangelog(version);

    if (!changelog) {
        console.error(`No changelog found for version ${version}`);
        console.error('Make sure CHANGELOG.md contains an entry for this version.');
        process.exit(1);
    }

    console.log(`Changelog found (${changelog.length} characters)`);
    console.log('');

    await sendDiscordWebhook(version, changelog, CUSTOM_MESSAGE);
}

main().catch(console.error);
