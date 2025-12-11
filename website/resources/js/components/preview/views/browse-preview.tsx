import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, Package, Blocks, Download, ArrowDownToLine } from 'lucide-react';

const mockModpacks = [
    {
        id: '1',
        name: 'Create: Above and Beyond',
        author: 'simibubi',
        downloads: '2.5M',
        icon: '🔧',
        description: 'A quest-based modpack featuring Create mod',
        version: '1.20.1',
        loader: 'Forge',
    },
    {
        id: '2',
        name: 'All the Mods 9',
        author: 'ATM Team',
        downloads: '4.2M',
        icon: '📦',
        description: 'The ultimate kitchen sink modpack',
        version: '1.20.1',
        loader: 'Forge',
    },
    {
        id: '3',
        name: 'Cobblemon',
        author: 'Cobblemon Team',
        downloads: '1.8M',
        icon: '🎮',
        description: 'Pokemon in Minecraft',
        version: '1.20.1',
        loader: 'Fabric',
    },
    {
        id: '4',
        name: 'Better MC [FABRIC]',
        author: 'SharkieFN',
        downloads: '3.1M',
        icon: '✨',
        description: 'Enhanced vanilla experience',
        version: '1.20.4',
        loader: 'Fabric',
    },
    {
        id: '5',
        name: 'RLCraft',
        author: 'Shivaxi',
        downloads: '8.7M',
        icon: '⚔️',
        description: 'Brutal survival challenge',
        version: '1.12.2',
        loader: 'Forge',
    },
    {
        id: '6',
        name: 'Fabulously Optimized',
        author: 'Robotkoer',
        downloads: '5.2M',
        icon: '🚀',
        description: 'Performance optimization pack',
        version: '1.20.4',
        loader: 'Fabric',
    },
];

const loaderColors: Record<string, string> = {
    Fabric: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    Forge: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
};

export function BrowsePreview() {
    return (
        <div className="flex flex-col gap-4 p-4">
            {/* Header */}
            <div>
                <h1 className="text-lg font-bold">Browse</h1>
                <p className="text-xs text-muted-foreground">
                    Discover mods and modpacks from Modrinth
                </p>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-1 w-fit">
                <button className="flex items-center gap-1.5 rounded-md bg-background px-3 py-1.5 text-xs font-medium shadow-sm">
                    <Package className="h-3.5 w-3.5" />
                    Modpacks
                </button>
                <button className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                    <Blocks className="h-3.5 w-3.5" />
                    Mods
                </button>
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search modpacks..." className="pl-9" />
            </div>

            {/* Results grid */}
            <div className="grid grid-cols-2 gap-3">
                {mockModpacks.map((modpack) => (
                    <Card
                        key={modpack.id}
                        className="cursor-pointer overflow-hidden transition-all hover:shadow-md hover:border-primary/30"
                    >
                        <CardContent className="p-3">
                            {/* Header */}
                            <div className="flex items-start gap-2 mb-2">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-lg">
                                    {modpack.icon}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <h3 className="truncate text-sm font-semibold">{modpack.name}</h3>
                                    <p className="text-[10px] text-muted-foreground">
                                        by {modpack.author}
                                    </p>
                                </div>
                            </div>

                            {/* Description */}
                            <p className="mb-2 line-clamp-2 text-[11px] text-muted-foreground">
                                {modpack.description}
                            </p>

                            {/* Tags */}
                            <div className="mb-2 flex flex-wrap gap-1">
                                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                                    {modpack.version}
                                </Badge>
                                <Badge
                                    variant="outline"
                                    className={`h-5 px-1.5 text-[10px] ${loaderColors[modpack.loader]}`}
                                >
                                    {modpack.loader}
                                </Badge>
                            </div>

                            {/* Stats and action */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                    <span className="flex items-center gap-1">
                                        <ArrowDownToLine className="h-3 w-3" />
                                        {modpack.downloads}
                                    </span>
                                </div>
                                <Button size="sm" className="h-6 gap-1 px-2 text-[10px]">
                                    <Download className="h-3 w-3" />
                                    Install
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
}
