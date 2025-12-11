import { Archive, Home, Layers, Search, Settings, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export type PreviewPage = 'home' | 'instances' | 'browse' | 'backups' | 'settings';

interface NavItemProps {
    icon: React.ElementType;
    isActive?: boolean;
    onClick?: () => void;
}

function NavItem({ icon: Icon, isActive = false, onClick }: NavItemProps) {
    return (
        <button
            onClick={onClick}
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
        </button>
    );
}

interface SidebarPreviewProps {
    activePage: PreviewPage;
    onPageChange: (page: PreviewPage) => void;
}

export function SidebarPreview({ activePage, onPageChange }: SidebarPreviewProps) {
    return (
        <aside className="flex flex-col items-center border-r border-border/50 bg-secondary/20 px-3 py-4">
            {/* Main navigation */}
            <nav className="flex flex-col items-center gap-2">
                <NavItem
                    icon={Home}
                    isActive={activePage === 'home'}
                    onClick={() => onPageChange('home')}
                />
                <NavItem
                    icon={Layers}
                    isActive={activePage === 'instances'}
                    onClick={() => onPageChange('instances')}
                />
                <NavItem
                    icon={Search}
                    isActive={activePage === 'browse'}
                    onClick={() => onPageChange('browse')}
                />
                <NavItem
                    icon={Archive}
                    isActive={activePage === 'backups'}
                    onClick={() => onPageChange('backups')}
                />
            </nav>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Separator */}
            <div className="my-4 h-px w-6 bg-border/50" />

            {/* Bottom navigation */}
            <nav className="flex flex-col items-center gap-2">
                {/* Account avatar */}
                <div
                    className="h-9 w-9 cursor-pointer overflow-hidden rounded-lg transition-transform hover:scale-105"
                    style={{ boxShadow: '0 0 0 2px #22c55e' }}
                >
                    <img
                        src="https://mc-heads.net/avatar/Steve/36"
                        alt="Steve"
                        className="h-full w-full"
                    />
                </div>
                <NavItem icon={Sparkles} />
                <NavItem
                    icon={Settings}
                    isActive={activePage === 'settings'}
                    onClick={() => onPageChange('settings')}
                />
            </nav>
        </aside>
    );
}
