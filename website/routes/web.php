<?php

use Illuminate\Support\Facades\Route;
use Inertia\Inertia;
use Laravel\Fortify\Features;

Route::get('/', function () {
    return Inertia::render('welcome', [
        'canRegister' => Features::enabled(Features::registration()),
    ]);
})->name('home');

Route::get('/changelog', function () {
    return Inertia::render('changelog');
})->name('changelog');

Route::get('/terms', function () {
    return Inertia::render('terms');
})->name('terms');

Route::get('/privacy', function () {
    return Inertia::render('privacy');
})->name('privacy');

// SEO: Dynamic sitemap.xml
Route::get('/sitemap.xml', function () {
    $url = config('app.url');
    $lastmod = now()->format('Y-m-d');

    $content = <<<XML
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>{$url}</loc>
    <lastmod>{$lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>{$url}/changelog</loc>
    <lastmod>{$lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>{$url}/terms</loc>
    <lastmod>{$lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>{$url}/privacy</loc>
    <lastmod>{$lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
</urlset>
XML;

    return response($content, 200, [
        'Content-Type' => 'application/xml',
    ]);
})->name('sitemap');

// SEO: Dynamic robots.txt
Route::get('/robots.txt', function () {
    $url = config('app.url');

    $content = <<<TXT
# Kaizen Launcher - robots.txt
User-agent: *
Allow: /

# Sitemap
Sitemap: {$url}/sitemap.xml

# Disallow admin/auth routes
Disallow: /login
Disallow: /register
Disallow: /dashboard
Disallow: /settings
TXT;

    return response($content, 200, [
        'Content-Type' => 'text/plain',
    ]);
})->name('robots');

Route::middleware(['auth', 'verified'])->group(function () {
    Route::get('dashboard', function () {
        return Inertia::render('dashboard');
    })->name('dashboard');
});

require __DIR__.'/settings.php';
