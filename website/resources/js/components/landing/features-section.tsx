import { useTranslations } from '@/lib/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { MotionDiv, StaggerContainer, StaggerItem, motion } from '@/components/ui/motion';
import {
    Layers,
    Server,
    Package,
    ShieldCheck,
    Coffee,
    Globe,
    Cloud,
    User,
    Share2,
    Clock,
    MessageSquare,
    Map,
    Languages,
} from 'lucide-react';

const features = [
    {
        key: 'multiLoader',
        icon: Layers,
        color: 'text-blue-500',
        bgColor: 'bg-blue-500/10',
    },
    {
        key: 'servers',
        icon: Server,
        color: 'text-green-500',
        bgColor: 'bg-green-500/10',
    },
    {
        key: 'modrinth',
        icon: Package,
        color: 'text-emerald-500',
        bgColor: 'bg-emerald-500/10',
    },
    {
        key: 'cloudBackup',
        icon: Cloud,
        color: 'text-sky-500',
        bgColor: 'bg-sky-500/10',
    },
    {
        key: 'autoBackup',
        icon: Clock,
        color: 'text-amber-500',
        bgColor: 'bg-amber-500/10',
    },
    {
        key: 'skinManager',
        icon: User,
        color: 'text-pink-500',
        bgColor: 'bg-pink-500/10',
    },
    {
        key: 'instanceSharing',
        icon: Share2,
        color: 'text-violet-500',
        bgColor: 'bg-violet-500/10',
    },
    {
        key: 'worldManagement',
        icon: Map,
        color: 'text-lime-500',
        bgColor: 'bg-lime-500/10',
    },
    {
        key: 'discord',
        icon: MessageSquare,
        color: 'text-indigo-500',
        bgColor: 'bg-indigo-500/10',
    },
    {
        key: 'i18n',
        icon: Languages,
        color: 'text-rose-500',
        bgColor: 'bg-rose-500/10',
    },
    {
        key: 'auth',
        icon: ShieldCheck,
        color: 'text-purple-500',
        bgColor: 'bg-purple-500/10',
    },
    {
        key: 'java',
        icon: Coffee,
        color: 'text-orange-500',
        bgColor: 'bg-orange-500/10',
    },
    {
        key: 'tunneling',
        icon: Globe,
        color: 'text-cyan-500',
        bgColor: 'bg-cyan-500/10',
    },
] as const;

export function FeaturesSection() {
    const t = useTranslations();

    return (
        <section id="features" className="py-20 lg:py-32">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                {/* Header */}
                <MotionDiv className="text-center">
                    <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                        {t.features.title}
                    </h2>
                    <p className="mt-4 text-lg text-muted-foreground">
                        {t.features.subtitle}
                    </p>
                </MotionDiv>

                {/* Features grid */}
                <StaggerContainer
                    className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
                    staggerDelay={0.1}
                >
                    {features.map((feature) => {
                        const featureData = t.features[feature.key];
                        const Icon = feature.icon;

                        return (
                            <StaggerItem key={feature.key}>
                                <motion.div
                                    whileHover={{ y: -5, scale: 1.02 }}
                                    transition={{ duration: 0.2 }}
                                >
                                    <Card className="h-full border-border/50 bg-card/50 backdrop-blur transition-colors hover:border-border hover:bg-card">
                                        <CardContent className="p-6">
                                            <motion.div
                                                className={`mb-4 flex h-12 w-12 items-center justify-center rounded-lg ${feature.bgColor}`}
                                                whileHover={{ scale: 1.1, rotate: 5 }}
                                                transition={{ duration: 0.2 }}
                                            >
                                                <Icon className={`h-6 w-6 ${feature.color}`} />
                                            </motion.div>
                                            <h3 className="mb-2 text-lg font-semibold">
                                                {featureData.title}
                                            </h3>
                                            <p className="text-sm text-muted-foreground">
                                                {featureData.desc}
                                            </p>
                                        </CardContent>
                                    </Card>
                                </motion.div>
                            </StaggerItem>
                        );
                    })}
                </StaggerContainer>
            </div>
        </section>
    );
}
