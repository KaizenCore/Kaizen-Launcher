import { Clock, Play } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MockInstance {
    id: string;
    name: string;
    version: string;
    loader?: string | null;
    loaderVersion?: string | null;
    lastPlayed: string;
    playTime: string;
    status: 'ready' | 'running' | 'not_installed';
    iconUrl?: string;
}

interface InstanceCardProps extends Omit<MockInstance, 'id'> {
    isSelected?: boolean;
    onClick?: () => void;
}

const loaderColors: Record<string, string> = {
    fabric: 'bg-amber-500/20 text-amber-600 dark:text-amber-400',
    forge: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
    neoforge: 'bg-orange-500/20 text-orange-600 dark:text-orange-400',
    quilt: 'bg-purple-500/20 text-purple-600 dark:text-purple-400',
};

const statusColors: Record<string, string> = {
    ready: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
    running: 'bg-green-500/20 text-green-600 dark:text-green-400',
    not_installed: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400',
};

export function InstanceCard({
    name,
    version,
    loader,
    loaderVersion,
    lastPlayed,
    playTime,
    status,
    iconUrl,
    isSelected = false,
    onClick,
}: InstanceCardProps) {
    return (
        <div
            className={cn(
                'group cursor-pointer rounded-lg border border-border/50 bg-card p-3 transition-all duration-200 hover:bg-accent/50',
                isSelected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
            )}
            onClick={onClick}
        >
            <div className="flex items-start gap-3">
                {/* Icon */}
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                    {iconUrl ? (
                        <img src={iconUrl} alt={name} className="h-full w-full object-cover" />
                    ) : (
                        <span className="text-lg font-bold text-muted-foreground">
                            {name.charAt(0).toUpperCase()}
                        </span>
                    )}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <h3 className="truncate font-medium">{name}</h3>
                        <span
                            className={cn(
                                'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                                statusColors[status],
                            )}
                        >
                            {status === 'running' ? 'Running' : status === 'ready' ? 'Ready' : 'Install'}
                        </span>
                    </div>

                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{version}</span>
                        {loader && (
                            <>
                                <span>•</span>
                                <span
                                    className={cn(
                                        'rounded px-1.5 py-0.5 text-[10px] font-medium capitalize',
                                        loaderColors[loader.toLowerCase()] || 'bg-gray-500/20',
                                    )}
                                >
                                    {loader} {loaderVersion}
                                </span>
                            </>
                        )}
                    </div>

                    <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {lastPlayed}
                        </span>
                        <span className="flex items-center gap-1">
                            <Play className="h-3 w-3" />
                            {playTime}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
