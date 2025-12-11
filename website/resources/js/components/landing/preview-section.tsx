import { useState } from 'react';
import { useTranslations } from '@/lib/i18n';
import { AppWindow } from '@/components/preview/app-window';
import { SidebarPreview, type PreviewPage } from '@/components/preview/sidebar-preview';
import { HomePreview } from '@/components/preview/views/home-preview';
import { InstancesPreview } from '@/components/preview/views/instances-preview';
import { BrowsePreview } from '@/components/preview/views/browse-preview';
import { BackupsPreview } from '@/components/preview/views/backups-preview';
import { SettingsPreview } from '@/components/preview/views/settings-preview';

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
                <div className="mb-16 text-center">
                    <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                        {t.preview.title}
                    </h2>
                    <p className="mt-4 text-lg text-muted-foreground">{t.preview.subtitle}</p>
                </div>

                {/* App preview */}
                <div className="mx-auto max-w-5xl">
                    <AppWindow className="w-full">
                        <SidebarPreview activePage={activePage} onPageChange={setActivePage} />

                        {/* Main content area */}
                        <div className="flex-1 overflow-auto bg-background">
                            {renderContent()}
                        </div>
                    </AppWindow>

                    {/* Interactive hint */}
                    <p className="mt-4 text-center text-sm text-muted-foreground">
                        👆 Click on the sidebar icons to explore different pages
                    </p>
                </div>
            </div>
        </section>
    );
}
