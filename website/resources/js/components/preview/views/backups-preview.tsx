import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    Archive,
    Cloud,
    HardDrive,
    MoreHorizontal,
    Download,
    Trash2,
    Clock,
    FolderOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const mockBackups = [
    {
        id: '1',
        name: 'Create Mod Pack - Auto Backup',
        instance: 'Create Mod Pack',
        date: '2 hours ago',
        size: '256 MB',
        type: 'auto' as const,
        location: 'local' as const,
    },
    {
        id: '2',
        name: 'Vanilla 1.21.4 - Manual',
        instance: 'Vanilla 1.21.4',
        date: 'Yesterday',
        size: '128 MB',
        type: 'manual' as const,
        location: 'cloud' as const,
    },
    {
        id: '3',
        name: 'Fabric Modded - Auto Backup',
        instance: 'Fabric Modded',
        date: '3 days ago',
        size: '512 MB',
        type: 'auto' as const,
        location: 'local' as const,
    },
    {
        id: '4',
        name: 'SkyFactory 4 - Before Update',
        instance: 'SkyFactory 4',
        date: '1 week ago',
        size: '384 MB',
        type: 'manual' as const,
        location: 'cloud' as const,
    },
];

const mockWorlds = [
    {
        id: '1',
        name: 'My Survival World',
        instance: 'Vanilla 1.21.4',
        lastPlayed: 'Today',
        size: '45 MB',
    },
    {
        id: '2',
        name: 'Creative Build',
        instance: 'Vanilla 1.21.4',
        lastPlayed: 'Yesterday',
        size: '128 MB',
    },
    {
        id: '3',
        name: 'Factory Base',
        instance: 'Create Mod Pack',
        lastPlayed: '3 days ago',
        size: '256 MB',
    },
];

export function BackupsPreview() {
    return (
        <div className="flex flex-col gap-4 p-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-lg font-bold">Backups</h1>
                    <p className="text-xs text-muted-foreground">
                        Manage your world saves and backups
                    </p>
                </div>
                <Button size="sm" className="gap-2">
                    <Archive className="h-4 w-4" />
                    New Backup
                </Button>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-1 w-fit">
                <button className="flex items-center gap-1.5 rounded-md bg-background px-3 py-1.5 text-xs font-medium shadow-sm">
                    <Archive className="h-3.5 w-3.5" />
                    Backups
                    <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                        {mockBackups.length}
                    </Badge>
                </button>
                <button className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                    <FolderOpen className="h-3.5 w-3.5" />
                    Worlds
                    <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                        {mockWorlds.length}
                    </Badge>
                </button>
            </div>

            {/* Backups list */}
            <div className="space-y-2">
                {mockBackups.map((backup) => (
                    <Card key={backup.id} className="overflow-hidden">
                        <CardContent className="p-3">
                            <div className="flex items-center gap-3">
                                {/* Icon */}
                                <div
                                    className={cn(
                                        'flex h-10 w-10 items-center justify-center rounded-lg',
                                        backup.location === 'cloud'
                                            ? 'bg-blue-500/10'
                                            : 'bg-muted',
                                    )}
                                >
                                    {backup.location === 'cloud' ? (
                                        <Cloud className="h-5 w-5 text-blue-500" />
                                    ) : (
                                        <HardDrive className="h-5 w-5 text-muted-foreground" />
                                    )}
                                </div>

                                {/* Info */}
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <h3 className="truncate text-sm font-medium">
                                            {backup.name}
                                        </h3>
                                        <Badge
                                            variant="outline"
                                            className={cn(
                                                'h-5 px-1.5 text-[10px]',
                                                backup.type === 'auto'
                                                    ? 'border-amber-500/30 text-amber-500'
                                                    : 'border-primary/30 text-primary',
                                            )}
                                        >
                                            {backup.type === 'auto' ? 'Auto' : 'Manual'}
                                        </Badge>
                                    </div>
                                    <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                                        <span className="flex items-center gap-1">
                                            <Clock className="h-3 w-3" />
                                            {backup.date}
                                        </span>
                                        <span>{backup.size}</span>
                                        <span>{backup.instance}</span>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-1">
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-8 w-8 p-0"
                                    >
                                        <Download className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-8 w-8 p-0 hover:text-destructive"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                                        <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
}
