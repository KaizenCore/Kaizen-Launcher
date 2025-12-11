import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
    Plus,
    Search,
    Play,
    Download,
    Trash2,
    Monitor,
    Server,
    Network,
    LayoutGrid,
    LayoutList,
    Columns,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const mockInstances = [
    {
        id: '1',
        name: 'Vanilla 1.21.4',
        version: '1.21.4',
        loader: null,
        playTime: '124h',
        status: 'ready' as const,
    },
    {
        id: '2',
        name: 'Fabric Modded',
        version: '1.20.4',
        loader: 'Fabric',
        playTime: '89h',
        status: 'ready' as const,
    },
    {
        id: '3',
        name: 'Create Mod Pack',
        version: '1.20.1',
        loader: 'Forge',
        playTime: '256h',
        status: 'running' as const,
    },
    {
        id: '4',
        name: 'SkyFactory 4',
        version: '1.12.2',
        loader: 'Forge',
        playTime: '45h',
        status: 'not_installed' as const,
    },
    {
        id: '5',
        name: 'All the Mods 9',
        version: '1.20.1',
        loader: 'Forge',
        playTime: '12h',
        status: 'ready' as const,
    },
    {
        id: '6',
        name: 'Cobblemon',
        version: '1.20.1',
        loader: 'Fabric',
        playTime: '67h',
        status: 'ready' as const,
    },
];

const loaderColors: Record<string, string> = {
    Fabric: 'bg-amber-500/10 text-amber-500',
    Forge: 'bg-blue-500/10 text-blue-500',
    NeoForge: 'bg-orange-500/10 text-orange-500',
    Quilt: 'bg-purple-500/10 text-purple-500',
};

export function InstancesPreview() {
    return (
        <div className="flex flex-col gap-4 p-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-lg font-bold">Instances</h1>
                    <p className="text-xs text-muted-foreground">Manage your Minecraft instances</p>
                </div>
                <Button size="sm" className="gap-2">
                    <Plus className="h-4 w-4" />
                    Create
                </Button>
            </div>

            {/* Search and filters */}
            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input placeholder="Search instances..." className="h-8 pl-8 text-sm" />
                </div>
                <div className="flex items-center rounded-md border">
                    <Button variant="secondary" size="icon" className="h-8 w-8 rounded-r-none">
                        <LayoutGrid className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none border-x">
                        <LayoutList className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-l-none">
                        <Columns className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-1">
                <button className="flex items-center gap-1.5 rounded-md bg-background px-3 py-1.5 text-xs font-medium shadow-sm">
                    <Monitor className="h-3.5 w-3.5" />
                    Clients
                    <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                        6
                    </Badge>
                </button>
                <button className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                    <Server className="h-3.5 w-3.5" />
                    Servers
                </button>
                <button className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                    <Network className="h-3.5 w-3.5" />
                    Proxies
                </button>
            </div>

            {/* Instance grid */}
            <div className="grid grid-cols-2 gap-3">
                {mockInstances.map((instance) => (
                    <Card
                        key={instance.id}
                        className={cn(
                            'cursor-pointer overflow-hidden transition-all hover:shadow-md',
                            instance.status === 'running' && 'border-green-500/50',
                        )}
                    >
                        <div className="relative">
                            {/* Background blur effect */}
                            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-50" />

                            <CardContent className="relative p-3">
                                {/* Icon and info */}
                                <div className="mb-2 flex items-start gap-2">
                                    <div
                                        className={cn(
                                            'flex h-10 w-10 items-center justify-center rounded-lg border border-border/50 bg-background/80',
                                            instance.status === 'running' && 'ring-2 ring-green-500/50',
                                        )}
                                    >
                                        <span className="text-sm font-bold text-muted-foreground">
                                            {instance.name.charAt(0)}
                                        </span>
                                        {instance.status === 'running' && (
                                            <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
                                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                                                <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-background bg-green-500" />
                                            </span>
                                        )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5">
                                            <h3 className="truncate text-sm font-semibold">
                                                {instance.name}
                                            </h3>
                                            {instance.status === 'running' && (
                                                <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-500">
                                                    Running
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-0.5 flex items-center gap-1.5">
                                            <span className="rounded bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium">
                                                {instance.version}
                                            </span>
                                            {instance.loader && (
                                                <span
                                                    className={cn(
                                                        'rounded px-1.5 py-0.5 text-[10px] font-medium',
                                                        loaderColors[instance.loader],
                                                    )}
                                                >
                                                    {instance.loader}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Playtime */}
                                <div className="mb-2 flex items-center gap-1 text-[10px] text-muted-foreground">
                                    <Play className="h-3 w-3" />
                                    {instance.playTime}
                                </div>

                                {/* Action button */}
                                <div className="flex items-center gap-2">
                                    {instance.status === 'running' ? (
                                        <Button
                                            size="sm"
                                            variant="destructive"
                                            className="h-7 flex-1 gap-1 text-xs"
                                        >
                                            Stop
                                        </Button>
                                    ) : instance.status === 'ready' ? (
                                        <Button size="sm" className="h-7 flex-1 gap-1 text-xs">
                                            <Play className="h-3 w-3" />
                                            Play
                                        </Button>
                                    ) : (
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            className="h-7 flex-1 gap-1 text-xs"
                                        >
                                            <Download className="h-3 w-3" />
                                            Install
                                        </Button>
                                    )}
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 w-7 p-0 hover:border-destructive hover:text-destructive"
                                    >
                                        <Trash2 className="h-3 w-3" />
                                    </Button>
                                </div>
                            </CardContent>
                        </div>
                    </Card>
                ))}
            </div>
        </div>
    );
}
