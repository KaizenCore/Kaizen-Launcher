import { useTranslations } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, Github, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';

const GITHUB_URL = 'https://github.com/KaizenCore/Kaizen-Launcher';

type OS = 'windows' | 'macos' | 'linux' | 'unknown';

function detectOS(): OS {
    if (typeof window === 'undefined') return 'unknown';

    const userAgent = navigator.userAgent.toLowerCase();
    const platform = navigator.platform.toLowerCase();

    if (platform.includes('win') || userAgent.includes('windows')) {
        return 'windows';
    }
    if (platform.includes('mac') || userAgent.includes('mac')) {
        return 'macos';
    }
    if (platform.includes('linux') || userAgent.includes('linux')) {
        return 'linux';
    }
    return 'unknown';
}

const osNames: Record<OS, string> = {
    windows: 'Windows',
    macos: 'macOS',
    linux: 'Linux',
    unknown: 'your OS',
};

export function HeroSection() {
    const t = useTranslations();
    const os = useMemo(() => detectOS(), []);

    const scrollToDownload = () => {
        const element = document.getElementById('download');
        if (element) {
            element.scrollIntoView({ behavior: 'smooth' });
        }
    };

    return (
        <section className="relative overflow-hidden pt-32 pb-20 lg:pt-40 lg:pb-32">
            {/* Background gradient */}
            <div className="absolute inset-0 -z-10">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent" />
                <div className="absolute top-0 right-0 h-[500px] w-[500px] rounded-full bg-primary/5 blur-3xl" />
                <div className="absolute bottom-0 left-0 h-[300px] w-[300px] rounded-full bg-primary/10 blur-3xl" />
            </div>

            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <div className="text-center">
                    {/* Beta badge */}
                    <Badge
                        variant="outline"
                        className="mb-6 border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    >
                        {t.hero.beta}
                    </Badge>

                    {/* Title */}
                    <h1 className="mx-auto max-w-4xl text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
                        {t.hero.title}
                    </h1>

                    {/* Subtitle */}
                    <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
                        {t.hero.subtitle}
                    </p>

                    {/* CTA buttons */}
                    <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
                        <Button size="lg" className="gap-2" onClick={scrollToDownload}>
                            <Download className="h-5 w-5" />
                            {t.hero.downloadFor} {osNames[os]}
                        </Button>
                        <Button size="lg" variant="outline" className="gap-2" asChild>
                            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                                <Github className="h-5 w-5" />
                                {t.hero.viewGithub}
                                <ChevronRight className="h-4 w-4" />
                            </a>
                        </Button>
                    </div>

                    {/* Version info */}
                    <p className="mt-6 text-sm text-muted-foreground">{t.hero.version}</p>
                </div>
            </div>
        </section>
    );
}
