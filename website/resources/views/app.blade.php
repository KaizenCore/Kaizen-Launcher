<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}" class="{{ ($appearance ?? 'system') == 'dark' ? 'dark' : '' }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">

        {{-- Inline script to detect system dark mode preference and apply it immediately --}}
        <script>
            (function() {
                const appearance = '{{ $appearance ?? "system" }}';

                if (appearance === 'system') {
                    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

                    if (prefersDark) {
                        document.documentElement.classList.add('dark');
                    }
                }
            })();
        </script>

        {{-- Inline style to set the HTML background color based on our theme in app.css --}}
        <style>
            html {
                background-color: oklch(1 0 0);
            }

            html.dark {
                background-color: oklch(0.145 0 0);
            }
        </style>

        <title inertia>{{ config('app.name', 'Kaizen Launcher') }}</title>

        {{-- Primary SEO Meta Tags --}}
        <meta name="description" content="A modern, open-source Minecraft launcher with modpack support, server management, and a beautiful interface. Download for Windows, macOS, and Linux.">
        <meta name="keywords" content="Minecraft launcher, modpack, Fabric, Forge, NeoForge, Quilt, Minecraft mods, server management, open source, gaming">
        <meta name="author" content="Kaizen">
        <meta name="robots" content="index, follow">
        <meta name="googlebot" content="index, follow">
        <link rel="canonical" href="{{ config('app.url') }}">

        {{-- Open Graph / Facebook --}}
        <meta property="og:type" content="website">
        <meta property="og:url" content="{{ config('app.url') }}">
        <meta property="og:site_name" content="{{ config('app.name', 'Kaizen Launcher') }}">
        <meta property="og:title" content="{{ config('app.name', 'Kaizen Launcher') }} - Modern Minecraft Launcher">
        <meta property="og:description" content="A modern, open-source Minecraft launcher with modpack support, server management, and a beautiful interface. Download for Windows, macOS, and Linux.">
        <meta property="og:image" content="{{ config('app.url') }}/preview.png">
        <meta property="og:image:width" content="1200">
        <meta property="og:image:height" content="630">
        <meta property="og:image:alt" content="Kaizen Launcher - Modern Minecraft Launcher">
        <meta property="og:locale" content="en_US">

        {{-- Twitter --}}
        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:url" content="{{ config('app.url') }}">
        <meta name="twitter:title" content="{{ config('app.name', 'Kaizen Launcher') }} - Modern Minecraft Launcher">
        <meta name="twitter:description" content="A modern, open-source Minecraft launcher with modpack support, server management, and a beautiful interface.">
        <meta name="twitter:image" content="{{ config('app.url') }}/preview.png">
        <meta name="twitter:image:alt" content="Kaizen Launcher - Modern Minecraft Launcher">

        {{-- Theme color for browsers --}}
        <meta name="theme-color" content="#10b981" media="(prefers-color-scheme: light)">
        <meta name="theme-color" content="#059669" media="(prefers-color-scheme: dark)">
        <meta name="msapplication-TileColor" content="#10b981">
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
        <meta name="mobile-web-app-capable" content="yes">
        <meta name="apple-mobile-web-app-title" content="Kaizen">

        {{-- Favicon --}}
        <link rel="icon" href="/favicon.ico?v=2" sizes="48x48">
        <link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml">
        <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2">
        <link rel="manifest" href="/site.webmanifest">

        {{-- JSON-LD Structured Data --}}
        <script type="application/ld+json">
        {
            "@@context": "https://schema.org",
            "@@type": "SoftwareApplication",
            "name": "Kaizen Launcher",
            "description": "A modern, open-source Minecraft launcher with modpack support, server management, and a beautiful interface.",
            "url": "{{ config('app.url') }}",
            "applicationCategory": "GameApplication",
            "operatingSystem": "Windows, macOS, Linux",
            "offers": {
                "@@type": "Offer",
                "price": "0",
                "priceCurrency": "USD"
            },
            "author": {
                "@@type": "Organization",
                "name": "Kaizen",
                "url": "{{ config('app.url') }}"
            },
            "softwareVersion": "0.5.2",
            "downloadUrl": "https://github.com/KaizenCore/Kaizen-Launcher/releases",
            "screenshot": "{{ config('app.url') }}/preview.png",
            "featureList": [
                "Modpack support (Fabric, Forge, NeoForge, Quilt)",
                "Server management",
                "Beautiful modern interface",
                "Cross-platform (Windows, macOS, Linux)",
                "Open source"
            ]
        }
        </script>

        <link rel="preconnect" href="https://fonts.bunny.net">
        <link href="https://fonts.bunny.net/css?family=inter:400,500,600,700" rel="stylesheet" />

        @viteReactRefresh
        @vite(['resources/js/app.tsx', "resources/js/pages/{$page['component']}.tsx"])
        @inertiaHead
    </head>
    <body class="font-sans antialiased">
        @inertia
    </body>
</html>
