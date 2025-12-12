import { Head } from '@inertiajs/react';
import { I18nProvider } from '@/lib/i18n';
import { Navbar } from '@/components/landing/navbar';
import { HeroSection } from '@/components/landing/hero-section';
import { PreviewSection } from '@/components/landing/preview-section';
import { FeaturesSection } from '@/components/landing/features-section';
import { DownloadSection } from '@/components/landing/download-section';
import { Footer } from '@/components/landing/footer';
import { CookieConsent } from '@/components/cookie-consent';

export default function Welcome() {
    return (
        <I18nProvider>
            <Head title="Kaizen Launcher - The Modern Minecraft Launcher">
                <link rel="preconnect" href="https://fonts.bunny.net" />
                <link
                    href="https://fonts.bunny.net/css?family=inter:400,500,600,700"
                    rel="stylesheet"
                />
            </Head>

            <div className="min-h-screen bg-background text-foreground">
                <Navbar />
                <main>
                    <HeroSection />
                    <PreviewSection />
                    <FeaturesSection />
                    <DownloadSection />
                </main>
                <Footer />
                <CookieConsent />
            </div>
        </I18nProvider>
    );
}
