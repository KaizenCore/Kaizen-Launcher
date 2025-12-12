import { useState } from 'react';
import { useTranslations } from '@/lib/i18n';
import { AppWindow } from '@/components/preview/app-window';
import { SidebarPreview, type PreviewPage } from '@/components/preview/sidebar-preview';
import { HomePreview } from '@/components/preview/views/home-preview';
import { InstancesPreview } from '@/components/preview/views/instances-preview';
import { BrowsePreview } from '@/components/preview/views/browse-preview';
import { BackupsPreview } from '@/components/preview/views/backups-preview';
import { SettingsPreview } from '@/components/preview/views/settings-preview';
import { MotionDiv, motion } from '@/components/ui/motion';
import { AnimatePresence } from 'framer-motion';

export function PreviewSection() {
    const t = useTranslations();
    const [activePage, setActivePage] = useState<PreviewPage>('home');

    const handleNavigate = (page: string) => {
        if (page === 'instances' || page === 'browse' || page === 'backups' || page === 'settings' || page === 'home') {
            setActivePage(page as PreviewPage);
        }
    };

    const renderContent = () => {
        switch (activePage) {
            case 'home':
                return <HomePreview onNavigate={handleNavigate} />;
            case 'instances':
                return <InstancesPreview />;
            case 'browse':
                return <BrowsePreview />;
            case 'backups':
                return <BackupsPreview />;
            case 'settings':
                return <SettingsPreview />;
            default:
                return <HomePreview onNavigate={handleNavigate} />;
        }
    };

    return (
        <section className="py-20 lg:py-32">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                {/* Header */}
                <MotionDiv className="mb-16 text-center">
                    <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                        {t.preview.title}
                    </h2>
                    <p className="mt-4 text-lg text-muted-foreground">{t.preview.subtitle}</p>
                </MotionDiv>

                {/* App preview */}
                <MotionDiv
                    className="mx-auto max-w-5xl"
                    delay={0.2}
                    duration={0.8}
                >
                    <motion.div
                        whileHover={{ scale: 1.01 }}
                        transition={{ duration: 0.3 }}
                    >
                        <AppWindow className="w-full">
                            <SidebarPreview activePage={activePage} onPageChange={setActivePage} />

                            {/* Main content area with page transitions */}
                            <div className="flex-1 overflow-auto bg-background">
                                <AnimatePresence mode="wait">
                                    <motion.div
                                        key={activePage}
                                        initial={{ opacity: 0, x: 10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -10 }}
                                        transition={{ duration: 0.2 }}
                                        className="h-full"
                                    >
                                        {renderContent()}
                                    </motion.div>
                                </AnimatePresence>
                            </div>
                        </AppWindow>
                    </motion.div>

                    {/* Interactive hint */}
                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 1, duration: 0.5 }}
                        className="mt-4 text-center text-sm text-muted-foreground"
                    >
                        👆 Click on the sidebar icons to explore different pages
                    </motion.p>
                </MotionDiv>
            </div>
        </section>
    );
}
