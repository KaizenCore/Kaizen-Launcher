import { useTranslations } from '@/lib/i18n';
import { Card, CardContent } from '@/components/ui/card';
import {
    Layers,
    Server,
    Package,
    ShieldCheck,
    Coffee,
    Globe,
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
                <div className="text-center">
                    <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                        {t.features.title}
                    </h2>
                    <p className="mt-4 text-lg text-muted-foreground">
                        {t.features.subtitle}
                    </p>
                </div>

                {/* Features grid */}
                <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {features.map((feature) => {
                        const featureData = t.features[feature.key];
                        const Icon = feature.icon;

                        return (
                            <Card
                                key={feature.key}
                                className="border-border/50 bg-card/50 backdrop-blur transition-all duration-200 hover:border-border hover:bg-card"
                            >
                                <CardContent className="p-6">
                                    <div
                                        className={`mb-4 flex h-12 w-12 items-center justify-center rounded-lg ${feature.bgColor}`}
                                    >
                                        <Icon className={`h-6 w-6 ${feature.color}`} />
                                    </div>
                                    <h3 className="mb-2 text-lg font-semibold">
                                        {featureData.title}
                                    </h3>
                                    <p className="text-sm text-muted-foreground">
                                        {featureData.desc}
                                    </p>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
