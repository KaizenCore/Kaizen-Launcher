import { createContext, ReactNode, useCallback, useContext, useState } from 'react';

export type Locale = 'en' | 'fr';

interface FeatureTranslation {
    title: string;
    desc: string;
}

interface Translations {
    nav: {
        features: string;
        download: string;
        changelog: string;
        github: string;
        discord: string;
    };
    hero: {
        title: string;
        subtitle: string;
        downloadFor: string;
        viewGithub: string;
        version: string;
        beta: string;
    };
    features: {
        title: string;
        subtitle: string;
        multiLoader: FeatureTranslation;
        servers: FeatureTranslation;
        modrinth: FeatureTranslation;
        auth: FeatureTranslation;
        java: FeatureTranslation;
        tunneling: FeatureTranslation;
    };
    preview: {
        title: string;
        subtitle: string;
    };
    download: {
        title: string;
        subtitle: string;
        windows: string;
        windowsDesc: string;
        macos: string;
        macosDesc: string;
        linux: string;
        linuxDesc: string;
        allReleases: string;
        requirements: string;
        downloadButton: string;
    };
    footer: {
        copyright: string;
        madeWith: string;
    };
    common: {
        learnMore: string;
        getStarted: string;
    };
}

const translations: Record<Locale, Translations> = {
    en: {
        nav: {
            features: 'Features',
            download: 'Download',
            changelog: 'Changelog',
            github: 'GitHub',
            discord: 'Discord',
        },
        hero: {
            title: 'The Modern Minecraft Launcher',
            subtitle:
                'A powerful, feature-rich launcher for Minecraft with support for multiple modloaders, servers, and seamless mod management.',
            downloadFor: 'Download for',
            viewGithub: 'View on GitHub',
            version: 'v0.4.0 • Open Source',
            beta: 'Early Beta',
        },
        features: {
            title: 'Everything you need to play',
            subtitle: 'Built for performance, designed for simplicity',
            multiLoader: {
                title: 'Multi-Loader Support',
                desc: 'Play with Fabric, Forge, NeoForge, or Quilt. Switch between modloaders effortlessly.',
            },
            servers: {
                title: 'Server Hosting',
                desc: 'Run Paper, Purpur, Velocity, or BungeeCord servers directly from the launcher.',
            },
            modrinth: {
                title: 'Modrinth Integration',
                desc: 'Browse, search, and install mods and modpacks with a single click.',
            },
            auth: {
                title: 'Microsoft Authentication',
                desc: 'Secure OAuth login with your Microsoft account. Your credentials stay safe.',
            },
            java: {
                title: 'Automatic Java',
                desc: 'Java 21 is automatically detected and installed. No manual setup required.',
            },
            tunneling: {
                title: 'Server Tunneling',
                desc: 'Share your server with friends using Cloudflare, Playit, Ngrok, or Bore.',
            },
        },
        preview: {
            title: 'Beautiful & Intuitive',
            subtitle: 'A clean interface that gets out of your way',
        },
        download: {
            title: 'Download Kaizen Launcher',
            subtitle: 'Available for Windows, macOS, and Linux',
            windows: 'Windows',
            windowsDesc: 'Windows 10/11 (64-bit)',
            macos: 'macOS',
            macosDesc: 'macOS 11+ (Intel & Apple Silicon)',
            linux: 'Linux',
            linuxDesc: 'AppImage, .deb',
            allReleases: 'View all releases on GitHub',
            requirements: 'System Requirements',
            downloadButton: 'Download',
        },
        footer: {
            copyright: '© 2025 Kaizen Launcher. Open source under MIT license.',
            madeWith: 'Made with',
        },
        common: {
            learnMore: 'Learn more',
            getStarted: 'Get Started',
        },
    },
    fr: {
        nav: {
            features: 'Fonctionnalités',
            download: 'Télécharger',
            changelog: 'Changelog',
            github: 'GitHub',
            discord: 'Discord',
        },
        hero: {
            title: 'Le Launcher Minecraft Moderne',
            subtitle:
                'Un launcher puissant et complet pour Minecraft avec support multi-modloaders, serveurs et gestion simplifiée des mods.',
            downloadFor: 'Télécharger pour',
            viewGithub: 'Voir sur GitHub',
            version: 'v0.4.0 • Open Source',
            beta: 'Bêta',
        },
        features: {
            title: 'Tout ce dont vous avez besoin',
            subtitle: 'Conçu pour la performance, pensé pour la simplicité',
            multiLoader: {
                title: 'Support Multi-Loader',
                desc: 'Jouez avec Fabric, Forge, NeoForge ou Quilt. Changez de modloader sans effort.',
            },
            servers: {
                title: 'Hébergement Serveur',
                desc: 'Lancez des serveurs Paper, Purpur, Velocity ou BungeeCord directement depuis le launcher.',
            },
            modrinth: {
                title: 'Intégration Modrinth',
                desc: 'Parcourez, recherchez et installez des mods et modpacks en un clic.',
            },
            auth: {
                title: 'Authentification Microsoft',
                desc: 'Connexion OAuth sécurisée avec votre compte Microsoft. Vos identifiants restent protégés.',
            },
            java: {
                title: 'Java Automatique',
                desc: 'Java 21 est automatiquement détecté et installé. Aucune configuration manuelle requise.',
            },
            tunneling: {
                title: 'Tunnel Serveur',
                desc: 'Partagez votre serveur avec vos amis via Cloudflare, Playit, Ngrok ou Bore.',
            },
        },
        preview: {
            title: 'Élégant & Intuitif',
            subtitle: 'Une interface épurée qui vous laisse jouer',
        },
        download: {
            title: 'Télécharger Kaizen Launcher',
            subtitle: 'Disponible pour Windows, macOS et Linux',
            windows: 'Windows',
            windowsDesc: 'Windows 10/11 (64-bit)',
            macos: 'macOS',
            macosDesc: 'macOS 11+ (Intel & Apple Silicon)',
            linux: 'Linux',
            linuxDesc: 'AppImage, .deb',
            allReleases: 'Voir toutes les versions sur GitHub',
            requirements: 'Configuration requise',
            downloadButton: 'Télécharger',
        },
        footer: {
            copyright: '© 2025 Kaizen Launcher. Open source sous licence MIT.',
            madeWith: 'Fait avec',
        },
        common: {
            learnMore: 'En savoir plus',
            getStarted: 'Commencer',
        },
    },
};

export type { Translations };

interface I18nContextType {
    locale: Locale;
    setLocale: (locale: Locale) => void;
    t: Translations;
}

const I18nContext = createContext<I18nContextType | null>(null);

function getInitialLocale(): Locale {
    if (typeof window === 'undefined') return 'en';

    const saved = localStorage.getItem('locale') as Locale | null;
    if (saved && (saved === 'en' || saved === 'fr')) {
        return saved;
    }

    const browserLang = navigator.language.split('-')[0];
    return browserLang === 'fr' ? 'fr' : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
    const [locale, setLocaleState] = useState<Locale>(() => getInitialLocale());

    const setLocale = useCallback((newLocale: Locale) => {
        setLocaleState(newLocale);
        localStorage.setItem('locale', newLocale);
    }, []);

    const t = translations[locale];

    return (
        <I18nContext.Provider value={{ locale, setLocale, t }}>
            {children}
        </I18nContext.Provider>
    );
}

export function useI18n() {
    const context = useContext(I18nContext);
    if (!context) {
        throw new Error('useI18n must be used within an I18nProvider');
    }
    return context;
}

export function useTranslations() {
    return useI18n().t;
}

export function useLocale() {
    const { locale, setLocale } = useI18n();
    return { locale, setLocale };
}
