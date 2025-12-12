import { Head, Link } from '@inertiajs/react';
import { I18nProvider, useLocale } from '@/lib/i18n';
import { Navbar } from '@/components/landing/navbar';
import { Footer } from '@/components/landing/footer';
import { CookieConsent } from '@/components/cookie-consent';
import { MotionDiv } from '@/components/ui/motion';

const privacyContent = {
    en: {
        title: 'Privacy Policy',
        lastUpdated: 'Last updated: January 2025',
        intro: 'At Kaizen Launcher, we take your privacy seriously. This policy explains what data we collect and how we use it.',
        sections: [
            {
                title: '1. Data We Collect',
                content: `**Local Data (stored on your device only):**
• Microsoft account tokens (encrypted)
• Game instance configurations
• Mod lists and settings
• Application preferences

**Website Analytics:**
• Anonymous usage statistics via Google Analytics
• Page views and navigation patterns
• Browser and device information
• Geographic region (country-level only)

We do NOT collect:
• Personal gameplay data
• Chat logs or messages
• Screenshots or recordings
• Payment information`,
            },
            {
                title: '2. How We Use Your Data',
                content: `**Local Data:**
Used exclusively on your device to:
• Authenticate with Microsoft/Minecraft services
• Save your preferences and configurations
• Manage your game instances and mods

**Analytics Data:**
Used to:
• Understand how visitors use our website
• Improve user experience
• Fix bugs and issues
• Plan future features`,
            },
            {
                title: '3. Data Storage & Security',
                content: `**Local Data:**
• Stored locally on your computer
• Sensitive data (tokens) encrypted with AES-256-GCM
• Never transmitted to our servers
• You can delete all data by uninstalling the application

**Analytics Data:**
• Processed by Google Analytics
• Subject to Google's privacy policy
• Retained according to our analytics settings`,
            },
            {
                title: '4. Third-Party Services',
                content: `The Software integrates with these third-party services:

**Microsoft Authentication**
• Purpose: Minecraft account login
• Data shared: Authentication tokens
• Policy: https://privacy.microsoft.com

**Modrinth**
• Purpose: Mod downloads and searches
• Data shared: Search queries
• Policy: https://modrinth.com/legal/privacy

**Cloud Storage Providers**
• Purpose: Backup storage (optional)
• Data shared: Your backup files
• Policies vary by provider

**Google Analytics (Website only)**
• Purpose: Website analytics
• Data shared: Anonymous usage data
• Policy: https://policies.google.com/privacy`,
            },
            {
                title: '5. Cookies',
                content: `Our website uses cookies for:
• Essential functionality (session management)
• Analytics (with your consent)
• Remembering your preferences (language)

You can manage cookie preferences through the cookie consent banner or your browser settings.`,
            },
            {
                title: '6. Your Rights',
                content: `You have the right to:
• Access your data stored locally (in the app data folder)
• Delete all local data (by uninstalling the application)
• Opt out of analytics cookies
• Request information about data processing

For GDPR/CCPA requests, please contact us through GitHub or Discord.`,
            },
            {
                title: '7. Children\'s Privacy',
                content: `Kaizen Launcher does not knowingly collect data from children under 13. The Software requires a Minecraft account, which has its own age requirements set by Microsoft.`,
            },
            {
                title: '8. Changes to This Policy',
                content: `We may update this privacy policy from time to time. We will notify users of significant changes through our GitHub repository or Discord server.`,
            },
            {
                title: '9. Contact Us',
                content: `If you have questions about this Privacy Policy:
• Open an issue on GitHub: github.com/KaizenCore/Kaizen-Launcher
• Join our Discord server`,
            },
        ],
    },
    fr: {
        title: 'Politique de confidentialité',
        lastUpdated: 'Dernière mise à jour : Janvier 2025',
        intro: 'Chez Kaizen Launcher, nous prenons votre vie privée au sérieux. Cette politique explique quelles données nous collectons et comment nous les utilisons.',
        sections: [
            {
                title: '1. Données collectées',
                content: `**Données locales (stockées uniquement sur votre appareil) :**
• Jetons de compte Microsoft (chiffrés)
• Configurations des instances de jeu
• Listes de mods et paramètres
• Préférences de l'application

**Analytiques du site web :**
• Statistiques d'utilisation anonymes via Google Analytics
• Pages vues et schémas de navigation
• Informations sur le navigateur et l'appareil
• Région géographique (niveau pays uniquement)

Nous NE collectons PAS :
• Données personnelles de jeu
• Journaux de chat ou messages
• Captures d'écran ou enregistrements
• Informations de paiement`,
            },
            {
                title: '2. Utilisation de vos données',
                content: `**Données locales :**
Utilisées exclusivement sur votre appareil pour :
• S'authentifier auprès des services Microsoft/Minecraft
• Sauvegarder vos préférences et configurations
• Gérer vos instances de jeu et mods

**Données analytiques :**
Utilisées pour :
• Comprendre comment les visiteurs utilisent notre site
• Améliorer l'expérience utilisateur
• Corriger les bugs et problèmes
• Planifier les futures fonctionnalités`,
            },
            {
                title: '3. Stockage et sécurité des données',
                content: `**Données locales :**
• Stockées localement sur votre ordinateur
• Données sensibles (jetons) chiffrées avec AES-256-GCM
• Jamais transmises à nos serveurs
• Vous pouvez supprimer toutes les données en désinstallant l'application

**Données analytiques :**
• Traitées par Google Analytics
• Soumises à la politique de confidentialité de Google
• Conservées selon nos paramètres analytiques`,
            },
            {
                title: '4. Services tiers',
                content: `Le logiciel s'intègre avec ces services tiers :

**Authentification Microsoft**
• Objectif : Connexion au compte Minecraft
• Données partagées : Jetons d'authentification
• Politique : https://privacy.microsoft.com

**Modrinth**
• Objectif : Téléchargements et recherches de mods
• Données partagées : Requêtes de recherche
• Politique : https://modrinth.com/legal/privacy

**Fournisseurs de stockage cloud**
• Objectif : Stockage de sauvegardes (optionnel)
• Données partagées : Vos fichiers de sauvegarde
• Politiques variables selon le fournisseur

**Google Analytics (Site web uniquement)**
• Objectif : Analytiques du site web
• Données partagées : Données d'utilisation anonymes
• Politique : https://policies.google.com/privacy`,
            },
            {
                title: '5. Cookies',
                content: `Notre site web utilise des cookies pour :
• Fonctionnalité essentielle (gestion de session)
• Analytiques (avec votre consentement)
• Mémorisation de vos préférences (langue)

Vous pouvez gérer les préférences de cookies via la bannière de consentement ou les paramètres de votre navigateur.`,
            },
            {
                title: '6. Vos droits',
                content: `Vous avez le droit de :
• Accéder à vos données stockées localement (dans le dossier de données de l'application)
• Supprimer toutes les données locales (en désinstallant l'application)
• Refuser les cookies analytiques
• Demander des informations sur le traitement des données

Pour les demandes RGPD/CCPA, veuillez nous contacter via GitHub ou Discord.`,
            },
            {
                title: '7. Confidentialité des enfants',
                content: `Kaizen Launcher ne collecte pas sciemment de données auprès d'enfants de moins de 13 ans. Le logiciel nécessite un compte Minecraft, qui a ses propres exigences d'âge définies par Microsoft.`,
            },
            {
                title: '8. Modifications de cette politique',
                content: `Nous pouvons mettre à jour cette politique de confidentialité de temps en temps. Nous informerons les utilisateurs des changements significatifs via notre dépôt GitHub ou notre serveur Discord.`,
            },
            {
                title: '9. Nous contacter',
                content: `Si vous avez des questions sur cette Politique de confidentialité :
• Ouvrez un ticket sur GitHub : github.com/KaizenCore/Kaizen-Launcher
• Rejoignez notre serveur Discord`,
            },
        ],
    },
};

function PrivacyContent() {
    const { locale } = useLocale();
    const content = privacyContent[locale];

    return (
        <div className="relative min-h-screen bg-background text-foreground">
            <Navbar />

            <main className="pt-24 pb-20">
                <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
                    <MotionDiv className="mb-12">
                        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
                            {content.title}
                        </h1>
                        <p className="mt-4 text-muted-foreground">
                            {content.lastUpdated}
                        </p>
                        <p className="mt-4 text-lg text-muted-foreground">
                            {content.intro}
                        </p>
                    </MotionDiv>

                    <MotionDiv delay={0.1} className="space-y-8">
                        {content.sections.map((section, index) => (
                            <section key={index} className="rounded-xl border border-border/50 bg-card/50 p-6 backdrop-blur">
                                <h2 className="text-xl font-semibold mb-4">{section.title}</h2>
                                <div className="text-muted-foreground whitespace-pre-line prose prose-sm dark:prose-invert max-w-none prose-strong:text-foreground prose-a:text-primary">
                                    {section.content.split('**').map((part, i) =>
                                        i % 2 === 0 ? part : <strong key={i}>{part}</strong>
                                    )}
                                </div>
                            </section>
                        ))}
                    </MotionDiv>

                    <MotionDiv delay={0.2} className="mt-8 text-center">
                        <Link
                            href="/"
                            className="text-primary hover:underline"
                        >
                            {locale === 'fr' ? '← Retour à l\'accueil' : '← Back to Home'}
                        </Link>
                    </MotionDiv>
                </div>
            </main>

            <Footer />
            <CookieConsent />
        </div>
    );
}

export default function Privacy() {
    return (
        <I18nProvider>
            <Head title="Privacy Policy - Kaizen Launcher" />
            <PrivacyContent />
        </I18nProvider>
    );
}
