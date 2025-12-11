import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Play, ChevronRight, Layers, Package, Clock, ChevronDown } from 'lucide-react';
import { InstanceCard, type MockInstance } from '../instance-card';

const mockInstances: MockInstance[] = [
    {
        id: '1',
        name: 'Vanilla 1.21.4',
        version: '1.21.4',
        loader: null,
        loaderVersion: null,
        lastPlayed: '2 hours ago',
        playTime: '124h',
        status: 'ready',
    },
    {
        id: '2',
        name: 'Fabric Modded',
        version: '1.20.4',
        loader: 'Fabric',
        loaderVersion: '0.15.6',
        lastPlayed: 'Yesterday',
        playTime: '89h',
        status: 'ready',
    },
    {
        id: '3',
        name: 'Create Mod Pack',
        version: '1.20.1',
        loader: 'Forge',
        loaderVersion: '47.2.0',
        lastPlayed: '3 days ago',
        playTime: '256h',
        status: 'ready',
    },
];

const mockStats = {
    instances: 12,
    mods: 247,
    playtime: '469h',
};

interface HomePreviewProps {
    onNavigate?: (page: string) => void;
}

export function HomePreview({ onNavigate }: HomePreviewProps) {
    const selectedInstance = mockInstances[0];

    return (
        <div className="flex flex-col gap-4 p-4">
            {/* Hero card with selected instance */}
            <Card className="overflow-hidden">
                <div className="relative">
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-primary/5 to-transparent" />
                    <CardContent className="relative p-4">
                        <div className="flex gap-4">
                            {/* Instance icon */}
                            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/50 bg-muted/50">
                                <span className="text-2xl font-bold text-muted-foreground">
                                    {selectedInstance.name.charAt(0)}
                                </span>
                            </div>
                            {/* Instance info */}
                            <div className="min-w-0 flex-1">
                                <div className="mb-1 flex items-center gap-2">
                                    <button className="flex items-center gap-1 hover:opacity-80">
                                        <h2 className="truncate text-lg font-bold">
                                            {selectedInstance.name}
                                        </h2>
                                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                    </button>
                                    <Badge
                                        variant="outline"
                                        className="border-emerald-500/50 text-emerald-500"
                                    >
                                        Ready
                                    </Badge>
                                </div>
                                <p className="text-sm text-muted-foreground">
                                    Minecraft {selectedInstance.version}
                                </p>
                                <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                                    <span className="flex items-center gap-1">
                                        <Clock className="h-3 w-3" />
                                        {selectedInstance.playTime}
                                    </span>
                                    <span>{selectedInstance.lastPlayed}</span>
                                </div>
                            </div>
                            {/* Play button */}
                            <div className="flex items-center">
                                <Button size="lg" className="gap-2 px-6">
                                    <Play className="h-5 w-5" />
                                    Play
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </div>
            </Card>

            {/* Stats cards */}
            <div className="grid grid-cols-3 gap-3">
                <Card
                    className="cursor-pointer border-border/50 bg-secondary/30 transition-colors hover:bg-secondary/50"
                    onClick={() => onNavigate?.('instances')}
                >
                    <CardContent className="flex items-center gap-3 p-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                            <Layers className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                            <p className="text-xl font-bold">{mockStats.instances}</p>
                            <p className="text-xs text-muted-foreground">Instances</p>
                        </div>
                    </CardContent>
                </Card>
                <Card
                    className="cursor-pointer border-border/50 bg-secondary/30 transition-colors hover:bg-secondary/50"
                    onClick={() => onNavigate?.('browse')}
                >
                    <CardContent className="flex items-center gap-3 p-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10">
                            <Package className="h-4 w-4 text-emerald-500" />
                        </div>
                        <div>
                            <p className="text-xl font-bold">{mockStats.mods}</p>
                            <p className="text-xs text-muted-foreground">Mods</p>
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-border/50 bg-secondary/30">
                    <CardContent className="flex items-center gap-3 p-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10">
                            <Clock className="h-4 w-4 text-amber-500" />
                        </div>
                        <div>
                            <p className="text-xl font-bold">{mockStats.playtime}</p>
                            <p className="text-xs text-muted-foreground">Playtime</p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Recent instances */}
            <div>
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Recent Instances</h3>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        onClick={() => onNavigate?.('instances')}
                    >
                        View all
                        <ChevronRight className="h-3 w-3" />
                    </Button>
                </div>
                <div className="space-y-2">
                    {mockInstances.map((instance, index) => (
                        <InstanceCard key={instance.id} {...instance} isSelected={index === 0} />
                    ))}
                </div>
            </div>
        </div>
    );
}
