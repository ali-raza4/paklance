'use strict';
/*
 * Serves the website (public/index.html) and SEO helpers.
 *
 * The site uses hash routes (/#jobs, /#blog/<slug>), like the current paklance.com. For search engines and
 * link previews, /blog and /blog/<slug> are also served with the right title, description, canonical URL,
 * Open Graph tags and JSON-LD already in the HTML; the page then switches itself to the hash route.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const db = require('./db');
const config = require('./config');
const { h } = require('./lib/errors');

const router = express.Router();
const PUBLIC = path.join(config.ROOT, 'public');
const SITE = 'https://www.paklance.com';

let cached = null;
function indexHtml() {
  if (cached && config.isProd) return cached;
  cached = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  return cached;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const siteUrl = () => (config.isProd ? SITE : config.appUrl);

function withSeo(html, o) {
  const tags = [
    `<meta name="description" content="${esc(o.description)}" data-blog-seo>`,
    `<link rel="canonical" href="${esc(o.url)}" data-blog-seo>`,
    `<meta property="og:site_name" content="Paklance" data-blog-seo>`,
    `<meta property="og:type" content="${esc(o.type)}" data-blog-seo>`,
    `<meta property="og:title" content="${esc(o.title)}" data-blog-seo>`,
    `<meta property="og:description" content="${esc(o.description)}" data-blog-seo>`,
    `<meta property="og:url" content="${esc(o.url)}" data-blog-seo>`,
    `<meta name="twitter:card" content="summary_large_image" data-blog-seo>`
  ];
  if (o.article) {
    const a = o.article;
    tags.push(`<meta property="article:published_time" content="${esc(a.published_on)}" data-blog-seo>`);
    if (a.updated_on) tags.push(`<meta property="article:modified_time" content="${esc(a.updated_on)}" data-blog-seo>`);
    tags.push(`<meta property="article:section" content="${esc(a.category)}" data-blog-seo>`);
    const ld = {
      '@context': 'https://schema.org', '@type': 'BlogPosting', headline: a.title, description: a.excerpt,
      datePublished: a.published_on, dateModified: a.updated_on || a.published_on,
      author: { '@type': 'Organization', name: 'Paklance Editorial Team' },
      publisher: { '@type': 'Organization', name: 'Paklance' }, mainEntityOfPage: o.url
    };
    tags.push(`<script type="application/ld+json" data-blog-seo>${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`);
  }
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(o.title)}</title>`)
    .replace('<!--SEO-->', tags.join('\n'));
}

// Hash-routed app pages that also answer on a real path (e.g. /pricing → /#pricing).
const APP_PATHS = ['/jobs', '/talent', '/how', '/global', '/match', '/trust', '/pricing', '/dashboard'];
router.get(APP_PATHS, (req, res) => res.type('html').send(indexHtml()));

router.get('/blog', (req, res) => {
  res.type('html').send(withSeo(indexHtml(), {
    title: 'Insights for Better Work | Paklance Blog',
    description: 'Practical insights, advice, and resources for freelancers, businesses, and global teams.',
    url: siteUrl() + '/blog', type: 'website'
  }));
});

router.get('/blog/:slug', h(async (req, res) => {
  const a = await db('blog_articles').where({ slug: String(req.params.slug), status: 'published' }).first();
  if (!a) return res.redirect(302, '/#blog');
  res.type('html').send(withSeo(indexHtml(), {
    title: `${a.title} | Paklance Blog`, description: a.excerpt, url: `${siteUrl()}/blog/${a.slug}`, type: 'article', article: a
  }));
}));

router.get('/reset-password', (req, res) => res.sendFile(path.join(PUBLIC, 'reset-password.html')));

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${siteUrl()}/sitemap.xml\n`);
});

router.get('/sitemap.xml', h(async (req, res) => {
  const base = siteUrl();
  const rows = await db('blog_articles').where({ status: 'published' }).orderBy('published_on', 'desc').select('slug', 'published_on', 'updated_on');
  const urls = [
    { loc: base + '/' }, { loc: base + '/pricing' }, { loc: base + '/how' }, { loc: base + '/global' }, { loc: base + '/blog' },
    ...rows.map((r) => ({ loc: `${base}/blog/${r.slug}`, lastmod: r.updated_on || r.published_on }))
  ];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${esc(u.lastmod)}</lastmod>` : ''}</url>`)
    .join('\n')}\n</urlset>\n`);
}));

module.exports = { router, PUBLIC };
