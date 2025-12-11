import { Archive, Home, Layers, Search, Settings, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItemProps {
    icon: React.ElementType;
    isActive?: boolean;
}

function NavItem({ icon: Icon, isActive = false }: NavItemProps) {
    return (
        <div
            className={cn(
                'relative flex h-10 w-10 items-center justify-center rounded-lg transition-all duration-200',
                isActive
                    ? 'bg-primary text-primary-foreground shadow-md'
                    : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
            )}
        >
            {isActive && (
                <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-primary" />
            )}
            <Icon size={20} strokeWidth={isActive ? 2 : 1.5} />
        </div>
    );
}

export function SidebarPreview() {
    return (
        <aside className="flex flex-col items-center border-r border-border/50 bg-secondary/20 px-3 py-4">
            {/* Main navigation */}
            <nav className="flex flex-col items-center gap-2">
                <NavItem icon={Home} isActive />
                <NavItem icon={Layers} />
                <NavItem icon={Search} />
                <NavItem icon={Archive} />
            </nav>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Separator */}
            <div className="my-4 h-px w-6 bg-border/50" />

            {/* Bottom navigation */}
            <nav className="flex flex-col items-center gap-2">
                {/* Account avatar */}
                <div
                    className="h-9 w-9 overflow-hidden rounded-lg"
                    style={{ boxShadow: '0 0 0 2px #22c55e' }}
                >
                    <img
                        src="https://mc-heads.net/avatar/Steve/36"
                        alt="Steve"
                        className="h-full w-full"
                    />
                </div>
                <NavItem icon={Sparkles} />
                <NavItem icon={Settings} />
            </nav>
        </aside>
    );
}
