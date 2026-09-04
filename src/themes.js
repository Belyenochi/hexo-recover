/**
 * Which theme generated a page, and where that theme puts each part of it.
 *
 * The article body itself is theme-independent: it is hexo-renderer-marked
 * output that the theme wraps in a container. Everything around it -- title,
 * dates, category and tag links, index excerpts, menu, avatar -- is theme
 * markup, and that is what the table below records. Every selector was read
 * from a site generated with the theme's current release; those sites are the
 * fixtures under test/fixtures/themes, and the test asserts each entry still
 * finds the right element. Do not edit an entry from memory of the theme.
 *
 * Only `body` is required. `page` is the container of a standalone page (about)
 * when the theme wraps pages differently from posts. A missing key means "use the generic fallback" in
 * recover.js (Open Graph meta, JSON-LD, link shapes), which is where most of
 * the metadata comes from anyway -- Hexo's open_graph() helper writes it for
 * every theme.
 */
export const THEMES = {
  next: {
    body: '.post-body',
    title: '.post-title',
    categories: ".post-meta a[href*='/categories/']",
    tags: '.post-tags a',
    excerpt: 'article .post-body',
    menu: '.menu-item a',
    social: '.links-of-author-item a, .links-of-author a',
    avatar: '.site-author-image',
    siteTitle: '.site-title',
    author: '.site-author-name',
    description: '.site-description',
    marker: /hexo-theme-next|NexT\.\w+ v/,
  },
  landscape: {
    body: '.article-entry',
    title: '.article-title',
    categories: '.article-category-link',
    tags: '.article-tag-list-link',
    excerpt: 'article .article-entry',
    menu: '#main-nav a',
    social: '#sub-nav a',
    siteTitle: '#logo',
    marker: /hexo-theme-landscape/,
  },
  butterfly: {
    body: '#article-container',
    title: 'h1.post-title',
    categories: 'a.post-meta-categories',
    tags: 'a.post-meta__tags',
    excerpt: '.recent-post-item .content',
    menu: '.menus_items a',
    social: '.card-info-social-icons a',
    avatar: '.avatar-img img',
    siteTitle: '.site-name',
    marker: /hexo-theme-butterfly/,
  },
  fluid: {
    // Fluid drops span.line from code blocks and separates lines with <br>;
    // convert.js handles that shape.
    body: '.post-content > .markdown-body',
    title: 'h1#seo-header',
    categories: 'a.category-chain-item',
    tags: ".post-metas a[href*='/tags/']",
    excerpt: '.index-excerpt',
    page: 'article.page-content',
    menu: '.navbar-nav a.nav-link',
    marker: /hexo-theme-fluid/,
  },
  icarus: {
    body: 'article.card-content .content',
    title: 'article h1.title',
    categories: ".article-meta a[href*='/categories/']",
    tags: '.article-tags a',
    excerpt: 'article.card-content .content',
    menu: '.navbar-menu a.navbar-item',
    marker: /hexo-theme-icarus/,
  },
  volantis: {
    body: '#post-body',
    title: '.article-meta h1.title',
    categories: '.new-meta-item.category a',
    tags: '.meta-tags a.tag',
    excerpt: '.article-desc',
    menu: '.nav-list-h a.menuitem',
    social: '.social-wrapper a.social',
    avatar: 'a.avatar img',
    marker: /hexo-theme-volantis/,
  },
  stellar: {
    body: 'article.md-text',
    title: 'h1.title',
    categories: '#breadcrumb a.breadcrumb-link',
    tags: '.article-tags a.tag',
    excerpt: '.post-card .excerpt',
    avatar: 'img.avatar',
    marker: /hexo-theme-stellar/,
  },
  keep: {
    body: '.post-content.keep-markdown-body',
    title: '.post-title',
    categories: '.post-category a',
    tags: '.post-tag a',
    excerpt: '.home-post-content',
    page: '.page-content.keep-markdown-body',
    menu: '.menu-item a',
    avatar: 'a.logo-image img',
    marker: /hexo-theme-keep/,
  },
  redefine: {
    body: '.article-content',
    title: '.article-title h1',
    categories: '.article-categories a',
    tags: '.article-tags a',
    excerpt: '.home-article-content',
    page: '.page-template-content',
    menu: 'li.navbar-item a',
    avatar: '.avatar img',
    marker: /hexo-theme-redefine/,
  },
};

export const THEME_NAMES = Object.keys(THEMES);

/**
 * Name the theme that generated a post page, or null. A theme is a candidate
 * when its body selector matches; ties (a generic class shared by two themes)
 * go to the theme whose name appears in the page's asset paths or footer.
 */
export function detectTheme($, html) {
  const hits = THEME_NAMES.filter((n) => $(THEMES[n].body).length > 0);
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) return null;
  const marked = hits.filter((n) => THEMES[n].marker && THEMES[n].marker.test(html));
  return marked[0] || hits[0];
}

/**
 * The theme's version, from wherever the theme prints it: its repository link
 * ("hexo-theme-stellar/tree/1.44.0", "hexo-theme-volantis/#6.8.3"), a footer
 * credit ("Butterfly 5.7.0", "Redefine v2.9.0"), or for NexT the config object
 * it embeds. A bare "version" key is deliberately not trusted: Keep's page has
 * one, and it belongs to the Twikoo comment widget. Empty when nothing matches.
 */
export function themeVersion(name, html) {
  if (!name) return '';
  const V = '(\\d+\\.\\d+\\.\\d+)';
  const patterns = [
    new RegExp(`hexo-theme-${name}/(?:tree/|#|@)v?${V}`),
    new RegExp(`\\b${name}(?:\\.\\w+)?\\s+v?${V}\\b`, 'i'),
  ];
  if (name === 'next') patterns.push(new RegExp(`"scheme":"\\w+","darkmode":(?:true|false),"version":"${V}"`));
  if (name === 'fluid') patterns.push(new RegExp(`Fluid\\.ctx[\\s\\S]{0,300}?"version":"${V}"`));
  // Footer credits often split name and version across tags ("NexT.Muse</a> v5.1.4").
  const text = html.replace(/<[^>]+>/g, ' ');
  for (const re of patterns) { const m = html.match(re) || text.match(re); if (m) return m[1]; }
  return '';
}

/** Selectors for a theme, with explicit overrides (e.g. --body-selector) on top. */
export function selectorsFor(name, overrides = {}) {
  const base = name && THEMES[name] ? THEMES[name] : {};
  const out = { ...base };
  for (const [k, v] of Object.entries(overrides)) if (v) out[k] = v;
  return out;
}
