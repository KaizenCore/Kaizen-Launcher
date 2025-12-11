import { useTranslations } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Download, ExternalLink, Check } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

const RELEASES_URL = 'https://github.com/KaizenCore/Kaizen-Launcher/releases/latest';
const GITHUB_API_URL = 'https://api.github.com/repos/KaizenCore/Kaizen-Launcher/releases/latest';

type OS = 'windows' | 'macos' | 'linux';

interface ReleaseAsset {
    name: string;
    browser_download_url: string;
}

interface Release {
    tag_name: string;
    assets: ReleaseAsset[];
}

const osData = {
    windows: {
        icon: WindowsIcon,
        extensions: ['.exe', '.msi'],
        requirements: ['Windows 10/11', '64-bit'],
    },
    macos: {
        icon: AppleIcon,
        extensions: ['.dmg', '.app'],
        requirements: ['macOS 11+', 'Intel & Apple Silicon'],
    },
    linux: {
        icon: LinuxIcon,
        extensions: ['.AppImage', '.deb'],
        requirements: ['Ubuntu 20.04+', '64-bit'],
    },
} as const;

function detectOS(): OS {
    if (typeof window === 'undefined') return 'windows';

    const userAgent = navigator.userAgent.toLowerCase();
    const platform = navigator.platform.toLowerCase();

    if (platform.includes('win') || userAgent.includes('windows')) {
        return 'windows';
    }
    if (platform.includes('mac') || userAgent.includes('mac')) {
        return 'macos';
    }
    return 'linux';
}

export function DownloadSection() {
    const t = useTranslations();
    const currentOS = useMemo(() => detectOS(), []);
    const [release, setRelease] = useState<Release | null>(null);

    useEffect(() => {
        // Fetch latest release info
        fetch(GITHUB_API_URL)
            .then((res) => res.json())
            .then((data) => {
                setRelease(data);
            })
            .catch(() => {
                // Silently fail, will use fallback URL
            });
    }, []);

    const getDownloadUrl = (os: OS): string => {
        if (!release) return RELEASES_URL;

        const extensions = osData[os].extensions;
        const asset = release.assets.find((a) =>
            extensions.some((ext) => a.name.toLowerCase().endsWith(ext.toLowerCase())),
        );

        return asset?.browser_download_url || RELEASES_URL;
    };

    const platforms: OS[] = ['windows', 'macos', 'linux'];

    return (
        <section id="download" className="py-20 lg:py-32">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                {/* Header */}
                <div className="text-center">
                    <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                        {t.download.title}
                    </h2>
                    <p className="mt-4 text-lg text-muted-foreground">{t.download.subtitle}</p>
                </div>

                {/* Download cards */}
                <div className="mt-16 grid gap-6 sm:grid-cols-3">
                    {platforms.map((os) => {
                        const data = osData[os];
                        const Icon = data.icon;
                        const isCurrentOS = os === currentOS;
                        const downloadUrl = getDownloadUrl(os);

                        return (
                            <Card
                                key={os}
                                className={`relative border-border/50 bg-card/50 backdrop-blur transition-all duration-200 hover:border-border hover:bg-card ${
                                    isCurrentOS ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''
                                }`}
                            >
                                {isCurrentOS && (
                                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                                        <span className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                                            <Check className="h-3 w-3" />
                                            Detected
                                        </span>
                                    </div>
                                )}
                                <CardContent className="p-6 pt-8 text-center">
                                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
                                        <Icon className="h-8 w-8" />
                                    </div>
                                    <h3 className="mb-2 text-xl font-semibold">
                                        {t.download[os]}
                                    </h3>
                                    <p className="mb-4 text-sm text-muted-foreground">
                                        {t.download[`${os}Desc` as keyof typeof t.download]}
                                    </p>
                                    <ul className="mb-6 space-y-1 text-xs text-muted-foreground">
                                        {data.requirements.map((req, i) => (
                                            <li key={i} className="flex items-center justify-center gap-1">
                                                <Check className="h-3 w-3 text-green-500" />
                                                {req}
                                            </li>
                                        ))}
                                    </ul>
                                    <Button className="w-full gap-2" asChild>
                                        <a href={downloadUrl} target="_blank" rel="noopener noreferrer">
                                            <Download className="h-4 w-4" />
                                            {t.download.downloadButton}
                                        </a>
                                    </Button>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>

                {/* All releases link */}
                <div className="mt-8 text-center">
                    <Button variant="outline" className="gap-2" asChild>
                        <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
                            {t.download.allReleases}
                            <ExternalLink className="h-4 w-4" />
                        </a>
                    </Button>
                </div>
            </div>
        </section>
    );
}

function WindowsIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
            <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
        </svg>
    );
}

function AppleIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
        </svg>
    );
}

function LinuxIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.357.357 0 00-.19-.064c.431-1.278.264-2.55-.173-3.694-.533-1.41-1.465-2.638-2.175-3.483-.796-1.005-1.576-1.957-1.56-3.368.026-2.152.236-6.133-3.544-6.139zm.529 3.405h.013c.213 0 .396.062.584.198.19.135.33.332.438.533.105.259.158.459.166.724 0-.02.006-.04.006-.06v.105a.086.086 0 01-.004-.021l-.004-.024a1.807 1.807 0 01-.15.706.953.953 0 01-.213.335.71.71 0 00-.088-.042c-.104-.045-.198-.064-.284-.133a1.312 1.312 0 00-.22-.066c.05-.06.146-.133.183-.198.053-.128.082-.264.088-.402v-.02a1.21 1.21 0 00-.061-.4c-.045-.134-.101-.2-.183-.333-.084-.066-.167-.132-.267-.132h-.016c-.093 0-.176.03-.262.132a.8.8 0 00-.205.334 1.18 1.18 0 00-.09.4v.019c.002.089.008.179.02.267-.193-.067-.438-.135-.607-.202a1.635 1.635 0 01-.018-.2v-.02a1.772 1.772 0 01.15-.768c.082-.22.232-.406.43-.533a.985.985 0 01.594-.2zm-2.962.059h.036c.142 0 .27.048.399.135.146.129.264.288.344.465.09.199.14.4.153.667v.004c.007.134.006.2-.002.266v.08c-.03.007-.056.018-.083.024-.152.055-.274.135-.393.2.012-.09.013-.18.003-.267v-.015c-.012-.133-.04-.2-.082-.333a.613.613 0 00-.166-.267.248.248 0 00-.183-.064h-.021c-.071.006-.13.04-.186.132a.552.552 0 00-.12.27.944.944 0 00-.023.33v.015c.012.135.037.2.08.334.046.134.098.2.166.268.01.009.02.018.034.024-.07.057-.117.07-.176.136a.304.304 0 01-.131.068 2.62 2.62 0 01-.275-.402 1.772 1.772 0 01-.155-.667 1.759 1.759 0 01.08-.668 1.43 1.43 0 01.283-.535c.128-.133.26-.2.418-.2zm1.37 1.706c.332 0 .733.065 1.216.399.293.2.523.269 1.052.468h.003c.255.136.405.266.478.399v-.131a.571.571 0 01.016.47c-.123.31-.516.643-1.063.842v.002c-.268.135-.501.333-.775.465-.276.135-.588.292-1.012.267a1.139 1.139 0 01-.448-.067 3.566 3.566 0 01-.322-.198c-.195-.135-.363-.332-.612-.465v-.005h-.005c-.4-.246-.616-.512-.686-.71-.07-.268-.005-.47.193-.6.224-.135.38-.271.483-.336.104-.074.143-.102.176-.131h.002v-.003c.169-.202.436-.47.839-.601.139-.036.294-.065.466-.065zm2.8 2.142c.358 1.417 1.196 3.475 1.735 4.473.286.534.855 1.659 1.102 3.024.156-.005.33.018.513.064.646-1.671-.546-3.467-1.089-3.966-.22-.2-.232-.335-.123-.335.59.534 1.365 1.572 1.646 2.757.13.535.16 1.104.021 1.67.067.028.135.06.205.067 1.032.534 1.413.938 1.23 1.537v-.002c-.06-.135-.12-.2-.238-.333h-.003c-.3-.266-.7-.535-1.299-.869-.095-.065-.182-.135-.274-.2-.079-.066-.16-.135-.24-.2h-.003c-.12-.066-.166-.2-.2-.334-.034-.135-.015-.2.067-.335.248-.403.553-.69.813-.869v-.002c.26-.135.39-.267.39-.334 0-.2-.323-.065-.489.065-.264.202-.573.535-.865.869a.586.586 0 00-.121.133h-.003l-.001.004a.586.586 0 00-.055.132v.001c-.013.067-.015.135-.015.2 0 .066-.022.2.2.469.023.135.086.2.146.334.054.066.101.135.186.2.257.2.594.468.975.802.432.4.903.869.957 1.334.059.47-.229.869-.857 1.135h-.037a1.573 1.573 0 01-.332.135c-.14.066-.28.2-.36.4-.083.2-.113.469-.076.8.025.2.062.4.094.535.034.2.059.332.04.465-.019.2-.075.267-.183.334-.1.066-.267.066-.4.134-.133.066-.267.2-.333.4-.064.135-.064.265-.034.4v.132c-.066.066-.2.132-.332.2-.39.2-.796.399-.93.8v.067l.003.066c.004.267.068.535.266.8.2.266.533.534.933.869h.003c.262.2.467.4.6.535.135.2.203.334.137.535-.064.135-.197.135-.33.2-.133 0-.266.066-.4.066h-.131c-.9.134-1.737.403-2.436.936a2.036 2.036 0 00-.733 1.002c-.066.2-.1.469-.066.8l.003.069a.18.18 0 00.003.034v-.001l.003.019.003.015c.127.802.74 1.57 1.606 2.003.867.4 1.903.469 2.772.002a2.63 2.63 0 001.068-.869c.135-.2.266-.467.334-.733.334-.2.667-.466.933-.733.3-.333.53-.735.66-1.135h.002v-.003c.134-.332.2-.667.2-1.002 0-.333-.067-.666-.2-.932v-.002c.466-.802.801-1.77.934-2.938v-.003a7.32 7.32 0 00-.002-1.869c-.064-.533-.166-1.069-.3-1.536-.269-.933-.666-1.737-1.066-2.336-.267-.4-.534-.732-.734-.932-.2-.133-.333-.265-.467-.333-.134-.067-.2-.067-.334-.2-.133-.066-.266-.2-.467-.332a5.58 5.58 0 00-.6-.4c-.132-.066-.266-.2-.4-.266-.066-.066-.133-.066-.2-.133v-.067c-.068-.2-.135-.266-.27-.332-.132-.133-.265-.2-.464-.267l-.067-.034-.068-.034-.066-.033-.066-.033-.002-.002-.066-.033-.004-.002h-.003v-.002l-.003-.002h-.003l-.002-.002-.002-.001-.066-.033a.847.847 0 01-.268-.333l-.002-.003c-.09-.135-.136-.267-.136-.468V8.77c0-.266.108-.534.257-.869.265-.601.664-1.336.664-2.338v-.003c0-.466-.066-.869-.2-1.202-.132-.333-.332-.535-.598-.668a1.348 1.348 0 00-.736-.132zm-4.869.066c-.47.2-.8.466-1.003.8-.2.333-.267.733-.267 1.2 0 .466.1.933.266 1.336.166.4.367.733.567.933.2.267.4.4.533.533.136.134.2.2.2.267 0 .133-.132.335-.4.6v.003c-.198.2-.454.404-.721.601.26.133.528.202.787.268-.014.066-.002.2.014.333-.262-.2-.523-.466-.723-.8a2.403 2.403 0 01-.399-1.333c0-.2.034-.4.067-.601.034-.2.067-.333.034-.468a1.09 1.09 0 00-.182-.467h-.003c-.09-.133-.2-.2-.333-.2-.134 0-.267.067-.4.2-.267.267-.467.601-.534.935a2.58 2.58 0 00.002 1.201c.066.4.2.733.4 1.001.198.2.398.4.598.534.066.066.132.133.198.133.068.066.136.067.204.134.066.066.2.066.266.133a.9.9 0 01.267.265c.066.134.132.269.2.4.066.135.134.269.2.336.004.066.01.131.017.197.003.066.003.132.003.198 0 .134-.012.268-.037.4-.023.134-.057.267-.103.4h-.003c-.09.268-.19.535-.29.802-.1.266-.196.534-.262.8a2.823 2.823 0 00-.067.734c0 .133.02.267.054.4.03.133.08.265.147.398h.003c.132.265.333.535.598.8.13.135.28.265.45.4l.004.003c.164.134.35.265.562.4.2.134.4.267.534.4.132.134.198.2.198.334v.067c.2-.266.4-.6.534-.869a5.51 5.51 0 00.466-1.2c.134-.468.2-.935.2-1.402 0-.467-.066-.869-.2-1.269a4.17 4.17 0 00-.534-1.134 4.51 4.51 0 00-.866-1.002c-.134-.135-.334-.266-.534-.4-.2-.2-.4-.4-.667-.535-.265-.2-.466-.401-.666-.668-.2-.268-.334-.602-.4-1.002a2.8 2.8 0 01.066-1.068c.066-.335.166-.602.333-.869.166-.266.332-.466.532-.532.2-.067.334-.2.534-.268.2-.066.333-.133.467-.265.133-.135.2-.335.2-.535 0-.134-.034-.267-.067-.467a1.21 1.21 0 01-.002-.535c.034-.2.1-.333.2-.467.098-.066.196-.133.33-.133z" />
        </svg>
    );
}
