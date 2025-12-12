import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Cookie, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

const CONSENT_KEY = 'cookie-consent';

type ConsentStatus = 'pending' | 'accepted' | 'declined';

declare global {
    interface Window {
        umami?: {
            track: (event: string, data?: Record<string, unknown>) => void;
        };
    }
}

function loadUmamiScript() {
    if (document.getElementById('umami-script')) return;

    const script = document.createElement('script');
    script.id = 'umami-script';
    script.defer = true;
    script.src = 'https://umami.3de-scs.tech/script.js';
    script.dataset.websiteId = '95f30323-435f-4ed0-a8a2-9e5bfc3f8ab6';
    document.head.appendChild(script);
}

export function CookieConsent() {
    const [status, setStatus] = useState<ConsentStatus>('pending');
    const [visible, setVisible] = useState(false);
    const { locale } = useI18n();

    useEffect(() => {
        const saved = localStorage.getItem(CONSENT_KEY) as ConsentStatus | null;

        if (saved === 'accepted') {
            setStatus('accepted');
            loadUmamiScript();
        } else if (saved === 'declined') {
            setStatus('declined');
        } else {
            // Show popup after a short delay
            setTimeout(() => setVisible(true), 1500);
        }
    }, []);

    const handleAccept = () => {
        localStorage.setItem(CONSENT_KEY, 'accepted');
        setStatus('accepted');
        setVisible(false);
        loadUmamiScript();
    };

    const handleDecline = () => {
        localStorage.setItem(CONSENT_KEY, 'declined');
        setStatus('declined');
        setVisible(false);
    };

    const translations = {
        en: {
            title: 'Cookie Consent',
            message: 'We use analytics cookies to understand how you use our website and improve your experience.',
            accept: 'Accept',
            decline: 'Decline',
        },
        fr: {
            title: 'Consentement cookies',
            message: 'Nous utilisons des cookies analytiques pour comprendre comment vous utilisez notre site et améliorer votre expérience.',
            accept: 'Accepter',
            decline: 'Refuser',
        },
    };

    const t = translations[locale] || translations.en;

    if (status !== 'pending') return null;

    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    initial={{ y: 100, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 100, opacity: 0 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                    className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-lg"
                >
                    <div className="rounded-xl border border-border bg-background/95 p-4 shadow-lg backdrop-blur-md">
                        <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                                <Cookie className="h-5 w-5 text-primary" />
                            </div>
                            <div className="flex-1">
                                <div className="flex items-center justify-between">
                                    <h3 className="font-semibold">{t.title}</h3>
                                    <button
                                        onClick={handleDecline}
                                        className="text-muted-foreground hover:text-foreground"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {t.message}
                                </p>
                                <div className="mt-3 flex gap-2">
                                    <Button size="sm" onClick={handleAccept}>
                                        {t.accept}
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={handleDecline}>
                                        {t.decline}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
