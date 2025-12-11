import { useTranslations } from '@/lib/i18n';
import { AppWindow } from '@/components/preview/app-window';
import { SidebarPreview } from '@/components/preview/sidebar-preview';
import { InstanceCard } from '@/components/preview/instance-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, ChevronRight, Layers, Package, Clock } from 'lucide-react';

const mockInstances = [
    {
        id: '1',
        name: 'Vanilla 1.21.4',
        version: '1.21.4',
        loader: null,
        loaderVersion: null,
        lastPlayed: '2 hours ago',
        playTime: '124h',
        status: 'ready' as const,
    },
    {
        id: '2',
        name: 'Fabric Modded',
        version: '1.20.4',
        loader: 'Fabric',
        loaderVersion: '0.15.6',
        lastPlayed: 'Yesterday',
        playTime: '89h',
        status: 'ready' as const,
    },
    {
        id: '3',
        name: 'Create Mod Pack',
        version: '1.20.1',
        loader: 'Forge',
        loaderVersion: '47.2.0',
        lastPlayed: '3 days ago',
        playTime: '256h',
        status: 'ready' as const,
    },
];

const mockStats = {
    instances: 12,
    mods: 247,
    playtime: '469h',
};

export function PreviewSection() {
    const t = useTranslations();

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
                        <SidebarPreview />

                        {/* Main content area */}
                        <div className="flex-1 overflow-hidden bg-background p-6">
                            {/* Header */}
                            <div className="mb-6 flex items-center justify-between">
                                <div>
                                    <h2 className="text-2xl font-bold">Welcome back!</h2>
                                    <p className="text-sm text-muted-foreground">
                                        Ready to play? Select an instance to get started.
                                    </p>
                                </div>
                                <Button size="sm" className="gap-2">
                                    <Plus className="h-4 w-4" />
                                    New Instance
                                </Button>
                            </div>

                            {/* Stats cards */}
                            <div className="mb-6 grid grid-cols-3 gap-4">
                                <Card className="border-border/50 bg-secondary/30">
                                    <CardContent className="flex items-center gap-3 p-4">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                                            <Layers className="h-5 w-5 text-primary" />
                                        </div>
                                        <div>
                                            <p className="text-2xl font-bold">{mockStats.instances}</p>
                                            <p className="text-xs text-muted-foreground">Instances</p>
                                        </div>
                                    </CardContent>
                                </Card>
                                <Card className="border-border/50 bg-secondary/30">
                                    <CardContent className="flex items-center gap-3 p-4">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
                                            <Package className="h-5 w-5 text-emerald-500" />
                                        </div>
                                        <div>
                                            <p className="text-2xl font-bold">{mockStats.mods}</p>
                                            <p className="text-xs text-muted-foreground">Mods Installed</p>
                                        </div>
                                    </CardContent>
                                </Card>
                                <Card className="border-border/50 bg-secondary/30">
                                    <CardContent className="flex items-center gap-3 p-4">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                                            <Clock className="h-5 w-5 text-amber-500" />
                                        </div>
                                        <div>
                                            <p className="text-2xl font-bold">{mockStats.playtime}</p>
                                            <p className="text-xs text-muted-foreground">Total Playtime</p>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Recent instances */}
                            <div className="mb-4 flex items-center justify-between">
                                <h3 className="font-semibold">Recent Instances</h3>
                                <Button variant="ghost" size="sm" className="gap-1 text-xs">
                                    View all
                                    <ChevronRight className="h-3 w-3" />
                                </Button>
                            </div>

                            <div className="space-y-3">
                                {mockInstances.map((instance, index) => (
                                    <InstanceCard
                                        key={instance.id}
                                        {...instance}
                                        isSelected={index === 0}
                                    />
                                ))}
                            </div>
                        </div>
                    </AppWindow>
                </div>
            </div>
        </section>
    );
}
