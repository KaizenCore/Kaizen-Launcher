import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    Palette,
    FolderOpen,
    Coffee,
    Bell,
    Globe,
    Monitor,
    Moon,
    Sun,
    Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const settingsSections = [
    {
        id: 'appearance',
        icon: Palette,
        title: 'Appearance',
        description: 'Customize the look and feel',
    },
    {
        id: 'storage',
        icon: FolderOpen,
        title: 'Storage',
        description: 'Manage data directories',
    },
    {
        id: 'java',
        icon: Coffee,
        title: 'Java',
        description: 'Configure Java runtime',
    },
    {
        id: 'notifications',
        icon: Bell,
        title: 'Notifications',
        description: 'Alert preferences',
    },
    {
        id: 'language',
        icon: Globe,
        title: 'Language',
        description: 'Change app language',
    },
];

const themes = [
    { id: 'light', icon: Sun, label: 'Light' },
    { id: 'dark', icon: Moon, label: 'Dark' },
    { id: 'system', icon: Monitor, label: 'System' },
];

const accentColors = [
    { id: 'blue', color: 'bg-blue-500', label: 'Blue' },
    { id: 'purple', color: 'bg-purple-500', label: 'Purple' },
    { id: 'green', color: 'bg-green-500', label: 'Green' },
    { id: 'orange', color: 'bg-orange-500', label: 'Orange' },
    { id: 'rose', color: 'bg-rose-500', label: 'Rose' },
];

export function SettingsPreview() {
    return (
        <div className="flex gap-4 p-4 h-full">
            {/* Settings nav */}
            <div className="w-48 shrink-0 space-y-1">
                <h2 className="mb-3 text-lg font-bold">Settings</h2>
                {settingsSections.map((section, index) => (
                    <button
                        key={section.id}
                        className={cn(
                            'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                            index === 0
                                ? 'bg-primary/10 text-primary'
                                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                        )}
                    >
                        <section.icon className="h-4 w-4" />
                        {section.title}
                    </button>
                ))}
            </div>

            {/* Settings content */}
            <div className="flex-1 space-y-4 overflow-auto">
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Palette className="h-4 w-4" />
                            Appearance
                        </CardTitle>
                        <CardDescription className="text-xs">
                            Customize how the launcher looks
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Theme */}
                        <div>
                            <label className="mb-2 block text-sm font-medium">Theme</label>
                            <div className="flex gap-2">
                                {themes.map((theme) => (
                                    <button
                                        key={theme.id}
                                        className={cn(
                                            'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                                            theme.id === 'dark'
                                                ? 'border-primary bg-primary/10 text-primary'
                                                : 'border-border hover:bg-muted/50',
                                        )}
                                    >
                                        <theme.icon className="h-4 w-4" />
                                        {theme.label}
                                        {theme.id === 'dark' && <Check className="h-3 w-3" />}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Accent color */}
                        <div>
                            <label className="mb-2 block text-sm font-medium">Accent Color</label>
                            <div className="flex gap-2">
                                {accentColors.map((color) => (
                                    <button
                                        key={color.id}
                                        className={cn(
                                            'relative h-8 w-8 rounded-full transition-transform hover:scale-110',
                                            color.color,
                                            color.id === 'blue' && 'ring-2 ring-offset-2 ring-offset-background ring-primary',
                                        )}
                                        title={color.label}
                                    >
                                        {color.id === 'blue' && (
                                            <Check className="absolute inset-0 m-auto h-4 w-4 text-white" />
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Coffee className="h-4 w-4" />
                            Java Runtime
                        </CardTitle>
                        <CardDescription className="text-xs">
                            Manage Java installation
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                                    <Coffee className="h-5 w-5 text-amber-500" />
                                </div>
                                <div>
                                    <p className="text-sm font-medium">Java 21.0.2</p>
                                    <p className="text-xs text-muted-foreground">
                                        Temurin (Eclipse Adoptium)
                                    </p>
                                </div>
                            </div>
                            <Badge
                                variant="outline"
                                className="border-green-500/30 text-green-500"
                            >
                                Installed
                            </Badge>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Globe className="h-4 w-4" />
                            Language
                        </CardTitle>
                        <CardDescription className="text-xs">
                            Choose your preferred language
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex gap-2">
                            <button className="flex items-center gap-2 rounded-lg border border-primary bg-primary/10 px-3 py-2 text-sm text-primary">
                                🇬🇧 English
                                <Check className="h-3 w-3" />
                            </button>
                            <button className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/50">
                                🇫🇷 Français
                            </button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
