import { Head } from '@inertiajs/react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useChangelog, ChangelogEntry } from '@/hooks/use-github-release';
import { I18nProvider, useLocale } from '@/lib/i18n';
import { Navbar } from '@/components/landing/navbar';
import { Footer } from '@/components/landing/footer';
import { MotionDiv } from '@/components/ui/motion';
import { Badge } from '@/components/ui/badge';
import { Calendar, ChevronDown, ChevronRight, Loader2, AlertCircle, ExternalLink } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

function formatDate(dateString: string, locale: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

function isBetaVersion(version: string): boolean {
    const match = version.match(/^(\d+)\./);
    if (!match) return true;
    return parseInt(match[1], 10) < 1;
}

function ChangelogCard({ entry, locale, isLatest }: { entry: ChangelogEntry; locale: string; isLatest: boolean }) {
    const [isExpanded, setIsExpanded] = useState(isLatest);
    const formattedDate = formatDate(entry.date, locale);
    const hasContent = entry.body && !entry.body.includes('See the assets for download links');
    const isBeta = isBetaVersion(entry.version);

    return (
        <article className="relative rounded-xl border border-border/50 bg-card/50 backdrop-blur transition-colors hover:border-border hover:bg-card overflow-hidden">
            {/* Header - Always visible */}
            <div className="p-6 flex items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-xl font-bold">v{entry.version}</h2>
                    {isLatest && (
                        <Badge className="bg-primary/20 text-primary">
                            Latest
                        </Badge>
                    )}
                    {isBeta && (
                        <Badge variant="outline" className="border-amber-500/50 text-amber-500">
                            Beta
                        </Badge>
                    )}
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Calendar className="h-4 w-4" />
                        <time dateTime={entry.date}>{formattedDate}</time>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {hasContent ? (
                        <button
                            onClick={() => setIsExpanded(!isExpanded)}
                            className="p-2 rounded-md hover:bg-muted/50 transition-colors"
                        >
                            {isExpanded ? (
                                <ChevronDown className="h-5 w-5 text-muted-foreground" />
                            ) : (
                                <ChevronRight className="h-5 w-5 text-muted-foreground" />
                            )}
                        </button>
                    ) : (
                        <a
                            href={entry.releaseUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-sm text-primary hover:underline"
                        >
                            {locale === 'fr' ? 'Voir sur GitHub' : 'View on GitHub'}
                            <ExternalLink className="h-4 w-4" />
                        </a>
                    )}
                </div>
            </div>

            {/* Content - Expandable with Markdown */}
            {hasContent && (
                <AnimatePresence>
                    {isExpanded && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                        >
                            <div className="px-6 pb-6 border-t border-border/50">
                                <div className="pt-4 prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-headings:text-foreground prose-h2:text-lg prose-h2:mt-4 prose-h2:mb-2 prose-h3:text-base prose-h3:mt-3 prose-h3:mb-2 prose-p:text-muted-foreground prose-p:my-2 prose-ul:my-2 prose-ul:pl-4 prose-li:text-muted-foreground prose-li:my-1 prose-strong:text-foreground prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-code:text-primary prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
                                    <ReactMarkdown>{entry.body}</ReactMarkdown>
                                </div>

                                {/* Link to GitHub release */}
                                <div className="pt-4 mt-4 border-t border-border/30">
                                    <a
                                        href={entry.releaseUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                                    >
                                        {locale === 'fr' ? 'Voir la release sur GitHub' : 'View release on GitHub'}
                                        <ExternalLink className="h-4 w-4" />
                                    </a>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            )}
        </article>
    );
}

function ChangelogContent() {
    const { locale } = useLocale();
    const { entries, loading, error } = useChangelog();

    return (
        <div className="relative min-h-screen bg-background text-foreground">
            <Navbar />

            <main className="pt-24 pb-20">
                <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
                    {/* Header */}
                    <MotionDiv className="mb-12 text-center">
                        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
                            Changelog
                        </h1>
                        <p className="mt-4 text-lg text-muted-foreground">
                            {locale === 'fr'
                                ? 'Découvrez les nouveautés et améliorations de chaque version.'
                                : 'Discover what\'s new and improved in each release.'}
                        </p>
                    </MotionDiv>

                    {/* Loading state */}
                    {loading && (
                        <div className="flex flex-col items-center justify-center py-20">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            <p className="mt-4 text-muted-foreground">
                                {locale === 'fr' ? 'Chargement du changelog...' : 'Loading changelog...'}
                            </p>
                        </div>
                    )}

                    {/* Error state */}
                    {error && (
                        <div className="flex flex-col items-center justify-center py-20">
                            <AlertCircle className="h-8 w-8 text-destructive" />
                            <p className="mt-4 text-muted-foreground">
                                {locale === 'fr'
                                    ? 'Impossible de charger le changelog.'
                                    : 'Failed to load changelog.'}
                            </p>
                            <a
                                href="https://github.com/KaizenCore/Kaizen-Launcher/blob/main/CHANGELOG.md"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-2 text-primary hover:underline"
                            >
                                {locale === 'fr' ? 'Voir sur GitHub' : 'View on GitHub'}
                            </a>
                        </div>
                    )}

                    {/* Changelog entries */}
                    {!loading && !error && entries.length > 0 && (
                        <div className="space-y-4">
                            {entries.map((entry, index) => (
                                <ChangelogCard
                                    key={entry.version}
                                    entry={entry}
                                    locale={locale}
                                    isLatest={index === 0}
                                />
                            ))}
                        </div>
                    )}

                    {/* Empty state */}
                    {!loading && !error && entries.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-20">
                            <p className="text-muted-foreground">
                                {locale === 'fr'
                                    ? 'Aucune entrée de changelog disponible.'
                                    : 'No changelog entries available.'}
                            </p>
                        </div>
                    )}
                </div>
            </main>

            <Footer />
        </div>
    );
}

export default function Changelog() {
    return (
        <I18nProvider>
            <Head title="Changelog - Kaizen Launcher" />
            <ChangelogContent />
        </I18nProvider>
    );
}
