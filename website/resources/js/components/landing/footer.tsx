import { useTranslations } from '@/lib/i18n';
import { MotionDiv, motion } from '@/components/ui/motion';
import { Github, Heart } from 'lucide-react';

const GITHUB_URL = 'https://github.com/KaizenCore/Kaizen-Launcher';
const DISCORD_URL = 'https://discord.gg/eRKRSeBxrZ';

export function Footer() {
    const t = useTranslations();

    return (
        <footer className="border-t border-border/40 bg-background">
            <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
                <MotionDiv
                    className="flex flex-col items-center justify-between gap-6 md:flex-row"
                    delay={0.1}
                >
                    {/* Logo and copyright */}
                    <div className="flex flex-col items-center gap-2 md:items-start">
                        <motion.div
                            className="flex items-center gap-3"
                            whileHover={{ scale: 1.02 }}
                        >
                            <img src="/Kaizen.svg" alt="Kaizen" className="h-8 w-8" />
                            <span className="font-semibold">Kaizen Launcher</span>
                        </motion.div>
                        <p className="text-sm text-muted-foreground">
                            {t.footer.copyright}
                        </p>
                    </div>

                    {/* Links */}
                    <div className="flex items-center gap-6">
                        <motion.a
                            href={GITHUB_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                        >
                            <Github className="h-4 w-4" />
                            GitHub
                        </motion.a>
                        <motion.a
                            href={DISCORD_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                        >
                            <DiscordIcon className="h-4 w-4" />
                            Discord
                        </motion.a>
                    </div>

                    {/* Made with love */}
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        {t.footer.madeWith}
                        <motion.div
                            animate={{
                                scale: [1, 1.2, 1],
                            }}
                            transition={{
                                duration: 1.5,
                                repeat: Infinity,
                                ease: 'easeInOut',
                            }}
                        >
                            <Heart className="h-4 w-4 fill-red-500 text-red-500" />
                        </motion.div>
                    </div>
                </MotionDiv>
            </div>
        </footer>
    );
}

function DiscordIcon({ className }: { className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
    );
}
