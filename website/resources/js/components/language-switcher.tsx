import { useLocale } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Globe } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function LanguageSwitcher() {
    const { locale, setLocale } = useLocale();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2 transition-colors duration-200">
                    <Globe className="h-4 w-4" />
                    <span className="uppercase">{locale}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem
                    onClick={() => setLocale('en')}
                    className={`transition-colors duration-200 ${locale === 'en' ? 'bg-accent' : ''}`}
                >
                    <span className="mr-2">🇬🇧</span>
                    English
                </DropdownMenuItem>
                <DropdownMenuItem
                    onClick={() => setLocale('fr')}
                    className={`transition-colors duration-200 ${locale === 'fr' ? 'bg-accent' : ''}`}
                >
                    <span className="mr-2">🇫🇷</span>
                    Français
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
