import { useTranslations } from '@/lib/i18n';
import { useGitHubRelease, useGitHubStars } from '@/hooks/use-github-release';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion } from '@/components/ui/motion';
import { Download, Github, ChevronRight, Star } from 'lucide-react';
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
    const { version } = useGitHubRelease();
    const { formattedStars } = useGitHubStars();

    const scrollToDownload = () => {
        const element = document.getElementById('download');
        if (element) {
            element.scrollIntoView({ behavior: 'smooth' });
        }
    };

    return (
        <section className="relative overflow-hidden pt-32 pb-20 lg:pt-40 lg:pb-32">
            {/* Animated background gradient */}
            <div className="absolute inset-0 -z-10">
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 1.5 }}
                    className="absolute inset-0 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent"
                />
                <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 2, ease: 'easeOut' }}
                    className="absolute top-0 right-0 h-[500px] w-[500px] rounded-full bg-primary/5 blur-3xl"
                />
                <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 2, delay: 0.3, ease: 'easeOut' }}
                    className="absolute bottom-0 left-0 h-[300px] w-[300px] rounded-full bg-primary/10 blur-3xl"
                />
            </div>

            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <div className="text-center">
                    {/* Beta badge */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.1 }}
                    >
                        <Badge
                            variant="outline"
                            className="mb-6 border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        >
                            {t.hero.beta}
                        </Badge>
                    </motion.div>

                    {/* Title */}
                    <motion.h1
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.2 }}
                        className="mx-auto max-w-4xl text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl"
                    >
                        {t.hero.title}
                    </motion.h1>

                    {/* Subtitle */}
                    <motion.p
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.3 }}
                        className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground"
                    >
                        {t.hero.subtitle}
                    </motion.p>

                    {/* CTA buttons */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.4 }}
                        className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row"
                    >
                        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                            <Button size="lg" className="gap-2" onClick={scrollToDownload}>
                                <Download className="h-5 w-5" />
                                {t.hero.downloadFor} {osNames[os]}
                            </Button>
                        </motion.div>
                        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                            <Button size="lg" variant="outline" className="gap-2" asChild>
                                <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                                    <Github className="h-5 w-5" />
                                    {t.hero.viewGithub}
                                    <ChevronRight className="h-4 w-4" />
                                </a>
                            </Button>
                        </motion.div>
                    </motion.div>

                    {/* Version info + Star button */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.6, delay: 0.6 }}
                        className="mt-6 flex items-center justify-center gap-4"
                    >
                        <span className="text-sm text-muted-foreground">
                            {version} • Open Source
                        </span>
                        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                            <Button
                                variant="outline"
                                size="sm"
                                className="gap-2 border-amber-500/30 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400"
                                asChild
                            >
                                <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                                    <Star className="h-4 w-4 fill-current" />
                                    Star
                                    {formattedStars && (
                                        <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
                                            {formattedStars}
                                        </Badge>
                                    )}
                                </a>
                            </Button>
                        </motion.div>
                    </motion.div>
                </div>
            </div>
        </section>
    );
}
