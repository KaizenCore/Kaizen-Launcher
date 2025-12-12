import { useGitHubRelease } from '@/hooks/use-github-release';
import { Minus, Square, X } from 'lucide-react';
import { ReactNode } from 'react';

interface AppWindowProps {
    children: ReactNode;
    className?: string;
}

export function AppWindow({ children, className = '' }: AppWindowProps) {
    const { version } = useGitHubRelease();

    return (
        <div
            className={`overflow-hidden rounded-xl border border-border/50 bg-background shadow-2xl ${className}`}
        >
            {/* Title bar */}
            <div className="flex h-8 items-center justify-between border-b border-border bg-background">
                {/* Logo and title */}
                <div className="flex items-center gap-2 px-3">
                    <img src="/Kaizen.svg" alt="Kaizen" className="h-4 w-4" />
                    <span className="text-sm font-medium text-foreground/80">
                        Kaizen Launcher
                    </span>
                    <span className="rounded border border-amber-500/30 bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-500">
                        Beta
                    </span>
                    <span className="text-[10px] text-muted-foreground">{version}</span>
                </div>

                {/* Spacer */}
                <div className="flex-1" />

                {/* Window controls (decorative) */}
                <div className="flex">
                    <div className="flex h-8 w-10 items-center justify-center text-muted-foreground">
                        <Minus className="h-3 w-3" />
                    </div>
                    <div className="flex h-8 w-10 items-center justify-center text-muted-foreground">
                        <Square className="h-3 w-3" />
                    </div>
                    <div className="flex h-8 w-10 items-center justify-center text-muted-foreground hover:bg-destructive hover:text-destructive-foreground">
                        <X className="h-3 w-3" />
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex">{children}</div>
        </div>
    );
}
