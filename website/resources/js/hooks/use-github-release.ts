import { useEffect, useState } from 'react';

const GITHUB_API_URL = 'https://api.github.com/repos/KaizenCore/Kaizen-Launcher/releases';
const GITHUB_REPO_API_URL = 'https://api.github.com/repos/KaizenCore/Kaizen-Launcher';
const CACHE_KEY = 'kaizen-latest-release';
const CACHE_KEY_ALL = 'kaizen-all-releases';
const CACHE_KEY_STARS = 'kaizen-stars';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export interface ReleaseAsset {
    name: string;
    browser_download_url: string;
    size: number;
}

export interface GitHubRelease {
    id: number;
    tag_name: string;
    name: string;
    body: string;
    published_at: string;
    html_url: string;
    assets: ReleaseAsset[];
    prerelease: boolean;
    draft: boolean;
}

interface CachedRelease {
    data: GitHubRelease;
    timestamp: number;
}

interface CachedReleases {
    data: GitHubRelease[];
    timestamp: number;
}

function getFromCache(): GitHubRelease | null {
    if (typeof window === 'undefined') return null;

    try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (!cached) return null;

        const { data, timestamp }: CachedRelease = JSON.parse(cached);
        if (Date.now() - timestamp > CACHE_DURATION) {
            localStorage.removeItem(CACHE_KEY);
            return null;
        }

        return data;
    } catch {
        return null;
    }
}

function saveToCache(data: GitHubRelease): void {
    if (typeof window === 'undefined') return;

    try {
        const cached: CachedRelease = { data, timestamp: Date.now() };
        localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
    } catch {
        // Ignore storage errors
    }
}

export function useGitHubRelease() {
    const [release, setRelease] = useState<GitHubRelease | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const cached = getFromCache();
        if (cached) {
            setRelease(cached);
            setLoading(false);
            return;
        }

        fetch(`${GITHUB_API_URL}/latest`)
            .then((res) => {
                if (!res.ok) throw new Error('Failed to fetch release');
                return res.json();
            })
            .then((data: GitHubRelease) => {
                setRelease(data);
                saveToCache(data);
            })
            .catch((err) => {
                setError(err.message);
            })
            .finally(() => {
                setLoading(false);
            });
    }, []);

    const version = release?.tag_name ?? 'v0.4.0';

    const getDownloadUrl = (platform: 'windows' | 'macos' | 'linux'): string | null => {
        if (!release?.assets) return null;

        const patterns: Record<string, RegExp> = {
            windows: /\.(exe|msi)$/i,
            macos: /\.(dmg|app\.tar\.gz)$/i,
            linux: /\.(AppImage|deb)$/i,
        };

        const asset = release.assets.find((a) => patterns[platform].test(a.name));
        return asset?.browser_download_url ?? null;
    };

    return {
        version,
        release,
        loading,
        error,
        getDownloadUrl,
        releasesUrl: 'https://github.com/KaizenCore/Kaizen-Launcher/releases',
    };
}

// Hook to fetch all releases for changelog
function getAllFromCache(): GitHubRelease[] | null {
    if (typeof window === 'undefined') return null;

    try {
        const cached = localStorage.getItem(CACHE_KEY_ALL);
        if (!cached) return null;

        const { data, timestamp }: CachedReleases = JSON.parse(cached);
        if (Date.now() - timestamp > CACHE_DURATION) {
            localStorage.removeItem(CACHE_KEY_ALL);
            return null;
        }

        return data;
    } catch {
        return null;
    }
}

function saveAllToCache(data: GitHubRelease[]): void {
    if (typeof window === 'undefined') return;

    try {
        const cached: CachedReleases = { data, timestamp: Date.now() };
        localStorage.setItem(CACHE_KEY_ALL, JSON.stringify(cached));
    } catch {
        // Ignore storage errors
    }
}

// Hook to fetch changelog from GitHub releases
const CACHE_KEY_CHANGELOG = 'kaizen-changelog-v3';

export interface ChangelogEntry {
    version: string;
    date: string;
    releaseUrl: string;
    body: string;
    sections: {
        title: string;
        items: string[];
    }[];
}

export function useChangelog() {
    const [entries, setEntries] = useState<ChangelogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Check cache
        try {
            const cached = localStorage.getItem(CACHE_KEY_CHANGELOG);
            if (cached) {
                const { data, timestamp } = JSON.parse(cached);
                if (Date.now() - timestamp < CACHE_DURATION) {
                    setEntries(data);
                    setLoading(false);
                    return;
                }
            }
        } catch {
            // Ignore cache errors
        }

        // Fetch releases from GitHub API
        fetch(`${GITHUB_API_URL}?per_page=50`)
            .then((res) => {
                if (!res.ok) throw new Error('Failed to fetch releases');
                return res.json();
            })
            .then((releases: GitHubRelease[]) => {
                // Filter out drafts and convert to changelog entries
                const changelogEntries: ChangelogEntry[] = releases
                    .filter((r) => !r.draft)
                    .map((release) => {
                        // Extract version from tag_name (remove 'v' prefix if present)
                        const version = release.tag_name.replace(/^v/, '');

                        // Get the raw body for markdown rendering
                        const body = release.body || '';

                        // Parse sections from release body if available
                        const sections = parseReleaseSections(body);

                        return {
                            version,
                            date: release.published_at,
                            releaseUrl: release.html_url,
                            body,
                            sections,
                        };
                    });

                setEntries(changelogEntries);

                // Cache the result
                try {
                    localStorage.setItem(CACHE_KEY_CHANGELOG, JSON.stringify({
                        data: changelogEntries,
                        timestamp: Date.now(),
                    }));
                } catch {
                    // Ignore cache errors
                }
            })
            .catch((err) => {
                setError(err.message);
            })
            .finally(() => {
                setLoading(false);
            });
    }, []);

    return { entries, loading, error };
}

// Parse release body into sections
function parseReleaseSections(body: string): { title: string; items: string[] }[] {
    if (!body || body.includes('See the assets for download links')) {
        // Empty or placeholder body - return empty sections
        return [];
    }

    const sections: { title: string; items: string[] }[] = [];
    const lines = body.split('\n');

    let currentSection: { title: string; items: string[] } | null = null;

    for (const line of lines) {
        // Match section header: ## Added, ### Fixed, etc.
        const sectionMatch = line.match(/^#{2,3}\s+(.+)/);
        if (sectionMatch) {
            if (currentSection && currentSection.items.length > 0) {
                sections.push(currentSection);
            }
            currentSection = {
                title: sectionMatch[1].trim(),
                items: [],
            };
            continue;
        }

        // Match list item: - Something or * Something
        const itemMatch = line.match(/^[-*]\s+(.+)/);
        if (itemMatch && currentSection) {
            currentSection.items.push(itemMatch[1].trim());
        }
    }

    // Don't forget the last section
    if (currentSection && currentSection.items.length > 0) {
        sections.push(currentSection);
    }

    return sections;
}

export function useGitHubReleases() {
    const [releases, setReleases] = useState<GitHubRelease[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const cached = getAllFromCache();
        if (cached) {
            setReleases(cached);
            setLoading(false);
            return;
        }

        fetch(`${GITHUB_API_URL}?per_page=50`)
            .then((res) => {
                if (!res.ok) throw new Error('Failed to fetch releases');
                return res.json();
            })
            .then((data: GitHubRelease[]) => {
                // Filter out drafts
                const publicReleases = data.filter((r) => !r.draft);
                setReleases(publicReleases);
                saveAllToCache(publicReleases);
            })
            .catch((err) => {
                setError(err.message);
            })
            .finally(() => {
                setLoading(false);
            });
    }, []);

    return {
        releases,
        loading,
        error,
    };
}

// Hook to fetch GitHub star count
export function useGitHubStars() {
    const [stars, setStars] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Check cache first
        try {
            const cached = localStorage.getItem(CACHE_KEY_STARS);
            if (cached) {
                const { data, timestamp } = JSON.parse(cached);
                if (Date.now() - timestamp < CACHE_DURATION) {
                    setStars(data);
                    setLoading(false);
                    return;
                }
            }
        } catch {
            // Ignore cache errors
        }

        fetch(GITHUB_REPO_API_URL)
            .then((res) => {
                if (!res.ok) throw new Error('Failed to fetch repo info');
                return res.json();
            })
            .then((data) => {
                const starCount = data.stargazers_count;
                setStars(starCount);

                // Cache the result
                try {
                    localStorage.setItem(CACHE_KEY_STARS, JSON.stringify({
                        data: starCount,
                        timestamp: Date.now(),
                    }));
                } catch {
                    // Ignore cache errors
                }
            })
            .catch(() => {
                // Silently fail - stars are optional
            })
            .finally(() => {
                setLoading(false);
            });
    }, []);

    // Format star count (e.g., 1.2k)
    const formattedStars = stars !== null
        ? stars >= 1000
            ? `${(stars / 1000).toFixed(1)}k`
            : String(stars)
        : null;

    return { stars, formattedStars, loading };
}
