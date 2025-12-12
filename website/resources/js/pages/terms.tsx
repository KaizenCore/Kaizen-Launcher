import { Head, Link } from '@inertiajs/react';
import { I18nProvider, useLocale } from '@/lib/i18n';
import { Navbar } from '@/components/landing/navbar';
import { Footer } from '@/components/landing/footer';
import { CookieConsent } from '@/components/cookie-consent';
import { MotionDiv } from '@/components/ui/motion';

const termsContent = {
    en: {
        title: 'Terms of Service',
        lastUpdated: 'Last updated: January 2025',
        sections: [
            {
                title: '1. Acceptance of Terms',
                content: `By downloading, installing, or using Kaizen Launcher ("the Software"), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the Software.`,
            },
            {
                title: '2. Description of Service',
                content: `Kaizen Launcher is an open-source Minecraft launcher that allows users to manage Minecraft instances, install mods, and connect to servers. The Software is provided free of charge under the MIT license.`,
            },
            {
                title: '3. User Responsibilities',
                content: `You are responsible for:
• Ensuring you have a valid Minecraft license from Mojang/Microsoft
• Using the Software in compliance with Minecraft's End User License Agreement (EULA)
• Any content you create, share, or distribute using the Software
• Maintaining the security of your Microsoft account credentials`,
            },
            {
                title: '4. Intellectual Property',
                content: `Kaizen Launcher is open-source software licensed under the MIT license. Minecraft is a trademark of Mojang Studios/Microsoft. We are not affiliated with, endorsed by, or connected to Mojang or Microsoft.`,
            },
            {
                title: '5. Third-Party Services',
                content: `The Software integrates with third-party services including:
• Microsoft Authentication (for Minecraft accounts)
• Modrinth (for mod downloads)
• Cloud storage providers (Google Drive, Dropbox, etc.)

Your use of these services is subject to their respective terms and privacy policies.`,
            },
            {
                title: '6. Disclaimer of Warranties',
                content: `THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.`,
            },
            {
                title: '7. Limitation of Liability',
                content: `IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`,
            },
            {
                title: '8. Modifications',
                content: `We reserve the right to modify these terms at any time. Continued use of the Software after changes constitutes acceptance of the new terms.`,
            },
            {
                title: '9. Contact',
                content: `For questions about these Terms of Service, please open an issue on our GitHub repository or contact us through Discord.`,
            },
        ],
    },
    fr: {
        title: 'Conditions d\'utilisation',
        lastUpdated: 'Dernière mise à jour : Janvier 2025',
        sections: [
            {
                title: '1. Acceptation des conditions',
                content: `En téléchargeant, installant ou utilisant Kaizen Launcher ("le Logiciel"), vous acceptez d'être lié par ces Conditions d'utilisation. Si vous n'acceptez pas ces conditions, veuillez ne pas utiliser le Logiciel.`,
            },
            {
                title: '2. Description du service',
                content: `Kaizen Launcher est un launcher Minecraft open-source qui permet aux utilisateurs de gérer des instances Minecraft, d'installer des mods et de se connecter à des serveurs. Le Logiciel est fourni gratuitement sous licence MIT.`,
            },
            {
                title: '3. Responsabilités de l\'utilisateur',
                content: `Vous êtes responsable de :
• Vous assurer que vous possédez une licence Minecraft valide de Mojang/Microsoft
• Utiliser le Logiciel en conformité avec le Contrat de Licence Utilisateur Final (EULA) de Minecraft
• Tout contenu que vous créez, partagez ou distribuez en utilisant le Logiciel
• Maintenir la sécurité de vos identifiants de compte Microsoft`,
            },
            {
                title: '4. Propriété intellectuelle',
                content: `Kaizen Launcher est un logiciel open-source sous licence MIT. Minecraft est une marque déposée de Mojang Studios/Microsoft. Nous ne sommes pas affiliés, approuvés ou connectés à Mojang ou Microsoft.`,
            },
            {
                title: '5. Services tiers',
                content: `Le Logiciel s'intègre avec des services tiers incluant :
• Authentification Microsoft (pour les comptes Minecraft)
• Modrinth (pour le téléchargement de mods)
• Fournisseurs de stockage cloud (Google Drive, Dropbox, etc.)

Votre utilisation de ces services est soumise à leurs conditions et politiques de confidentialité respectives.`,
            },
            {
                title: '6. Exclusion de garanties',
                content: `LE LOGICIEL EST FOURNI "TEL QUEL", SANS GARANTIE D'AUCUNE SORTE, EXPRESSE OU IMPLICITE, Y COMPRIS MAIS SANS S'Y LIMITER LES GARANTIES DE QUALITÉ MARCHANDE, D'ADÉQUATION À UN USAGE PARTICULIER ET DE NON-CONTREFAÇON.`,
            },
            {
                title: '7. Limitation de responsabilité',
                content: `EN AUCUN CAS LES AUTEURS OU LES DÉTENTEURS DU COPYRIGHT NE SERONT RESPONSABLES DE TOUTE RÉCLAMATION, DOMMAGE OU AUTRE RESPONSABILITÉ, QUE CE SOIT DANS UNE ACTION CONTRACTUELLE, DÉLICTUELLE OU AUTRE, DÉCOULANT DE OU EN RELATION AVEC LE LOGICIEL OU L'UTILISATION OU D'AUTRES TRANSACTIONS DANS LE LOGICIEL.`,
            },
            {
                title: '8. Modifications',
                content: `Nous nous réservons le droit de modifier ces conditions à tout moment. L'utilisation continue du Logiciel après les modifications constitue une acceptation des nouvelles conditions.`,
            },
            {
                title: '9. Contact',
                content: `Pour toute question concernant ces Conditions d'utilisation, veuillez ouvrir un ticket sur notre dépôt GitHub ou nous contacter via Discord.`,
            },
        ],
    },
};

function TermsContent() {
    const { locale } = useLocale();
    const content = termsContent[locale];

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
                    </MotionDiv>

                    <MotionDiv delay={0.1} className="space-y-8">
                        {content.sections.map((section, index) => (
                            <section key={index} className="rounded-xl border border-border/50 bg-card/50 p-6 backdrop-blur">
                                <h2 className="text-xl font-semibold mb-4">{section.title}</h2>
                                <div className="text-muted-foreground whitespace-pre-line">
                                    {section.content}
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

export default function Terms() {
    return (
        <I18nProvider>
            <Head title="Terms of Service - Kaizen Launcher" />
            <TermsContent />
        </I18nProvider>
    );
}
