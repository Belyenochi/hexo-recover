/** Turn a generated Hexo site back into a Hexo project. */
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { Converter, getText } from './convert.js';
import { THEMES, detectTheme, themeVersion, selectorsFor } from './themes.js';

const POST_DIR = /^\d{4}\/\d{2}\/\d{2}\/[^/]+$/;

export const defaultOptions = () => ({
  url: null,
  private: {},   // path -> reason, written to _private/
  drop: {},      // path -> reason, written nowhere
  theme: 'auto', // a key of THEMES, or 'auto' to detect from the first post page
  selectors: {}, // explicit overrides on top of the theme's selectors (body, title)
  postGlob: null, // null = YYYY/MM/DD/slug/index.html
});

const read = (p) => fs.readFileSync(p, 'utf8');
const load = (p) => cheerio.load(read(p));
const yamlStr = (s) => JSON.stringify(s);
const norm = (s) => s.replace(/\s+/g, ' ').trim();

function* postPages(deploy, postGlob) {
  if (postGlob) {
    for (const f of fs.globSync ? fs.globSync(postGlob, { cwd: deploy }) : []) yield path.join(deploy, f);
    return;
  }
  const isDir = (p) => fs.existsSync(p) && fs.statSync(p).isDirectory();
  for (const y of fs.readdirSync(deploy).filter((d) => /^\d{4}$/.test(d)).sort()) {
    if (!isDir(path.join(deploy, y))) continue;
    for (const m of fs.readdirSync(path.join(deploy, y)).filter((d) => /^\d{2}$/.test(d)).sort()) {
      for (const d of fs.readdirSync(path.join(deploy, y, m)).filter((x) => /^\d{2}$/.test(x)).sort()) {
        const dayDir = path.join(deploy, y, m, d);
        if (!isDir(dayDir)) continue;
        for (const slug of fs.readdirSync(dayDir).sort()) {
          const idx = path.join(dayDir, slug, 'index.html');
          if (fs.existsSync(idx)) yield idx;
        }
      }
    }
  }
}

// ------------------------------------------------------- theme-independent meta
/**
 * What Hexo itself writes into every page regardless of theme: the open_graph()
 * helper's meta tags, and (in several themes) a JSON-LD BlogPosting. Both are
 * more reliable than theme markup, so they are read first.
 */
export function pageMeta($) {
  const meta = (attr, v) => $(`meta[${attr}='${v}']`).first().attr('content') || '';
  const m = {
    title: meta('property', 'og:title'),
    siteName: meta('property', 'og:site_name'),
    url: meta('property', 'og:url') || $('link[rel=canonical]').attr('href') || '',
    published: meta('property', 'article:published_time'),
    modified: meta('property', 'article:modified_time'),
    tags: $("meta[property='article:tag']").map((_, e) => $(e).attr('content')).get(),
    author: meta('name', 'author'),
    description: meta('name', 'description'),
    generator: meta('name', 'generator'),
    ld: {},
  };
  $("script[type='application/ld+json']").each((_, s) => {
    let data;
    try { data = JSON.parse($(s).text()); } catch { return; }
    for (const d of Array.isArray(data) ? data : [data]) {
      if (d && (d['@type'] === 'BlogPosting' || d['@type'] === 'Article')) m.ld = d;
    }
  });
  return m;
}

const HOUR = 3600 * 1000;
const pad2 = (x) => String(x).padStart(2, '0');

/**
 * The date to write in front matter. Hexo shows dates in the site's timezone,
 * and that local rendering is what the front matter has to say back; the
 * Open Graph time is the same instant in UTC. So: a timestamp with an explicit
 * offset is used as-is; a visible local time is accepted when it names the
 * same instant as the UTC one up to a whole timezone offset; failing both, the
 * UTC instant is written in ISO form, which Hexo reads correctly even though
 * the day in the permalink then depends on the rebuilding machine's timezone.
 */
export function resolveDate(instant, candidates) {
  const local = (s) => {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?([+-]\d{2}:?\d{2})$/);
    return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6] || '00'}` : null;
  };
  const naive = (s) => {
    const m = s.match(/^(\d{4})[-./](\d{2})[-./](\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
    return m ? [`${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`, m[6]] : null;
  };
  for (const c of candidates) { const l = local(c); if (l) return l; }
  const t = instant ? Math.floor(Date.parse(instant) / 1000) * 1000 : NaN;
  for (const c of candidates) {
    const n = naive(c);
    if (!n) continue;
    const [minute, sec] = n;
    if (Number.isNaN(t)) return `${minute}:${sec || '00'}`;
    // Compare at minute resolution: visible times often omit the seconds, and
    // timezone offsets are whole minutes, so the seconds come from the instant.
    const diff = Date.parse(minute.replace(' ', 'T') + ':00Z') - (t - (t % 60000));
    if (Math.abs(diff) <= 14 * HOUR && diff % (15 * 60 * 1000) === 0) return `${minute}:${pad2(new Date(t).getUTCSeconds())}`;
  }
  if (!Number.isNaN(t)) return new Date(t).toISOString();
  return null;
}

/**
 * Timestamps a page carries, most trustworthy first: <time datetime> and other
 * datetime attributes, schema.org microdata and JSON-LD dates (several themes
 * write those with the site's offset), then visible YYYY-MM-DD HH:mm[:ss] text.
 */
function dateCandidates($, ld) {
  const out = [];
  $('[datetime]').each((_, t) => out.push($(t).attr('datetime')));
  $('[itemprop*=date], [itemprop*=Date]').each((_, e) => out.push($(e).attr('content') || $(e).attr('datetime') || ''));
  for (const k of ['datePublished', 'dateCreated', 'dateModified']) if (typeof ld[k] === 'string') out.push(ld[k]);
  const text = $('body').clone().find('script, style').remove().end().text();
  for (const m of text.matchAll(/\d{4}[-./]\d{2}[-./]\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:[+-]\d{2}:?\d{2})?/g)) out.push(m[0]);
  return out.filter(Boolean);
}

const uniq = (xs) => [...new Set(xs.map((x) => x && x.trim()).filter(Boolean))];
const NAMED = (kind) => new RegExp(`/${kind}/[^/]+/?$`);

/** Links to /categories/<name>/ or /tags/<name>/ outside sidebars and navigation. */
function namedLinks($, kind) {
  return $(`a[href*='/${kind}/']`).filter((_, a) => NAMED(kind).test($(a).attr('href') || '')
    && !$(a).closest('nav, aside, footer, .widget, .sidebar').length).map((_, a) => $(a).text()).get();
}

export function parsePost(file, rel, sel) {
  const $ = load(file);
  const meta = pageMeta($);
  const fromSel = (css) => (css && $(css).first().length ? norm($(css).first().text()) : '');
  // The theme's title element first: it is verified per theme, whereas og:title
  // is whatever the theme passed to open_graph() -- NexT 5 wrote the site name
  // there for some posts. Open Graph is the fallback for unknown markup.
  const ogTitle = meta.title && meta.title !== meta.siteName ? meta.title : '';
  const title = fromSel(sel.title) || ogTitle || meta.ld.headline
    || ($('title').text() || '').split(/ \| | - /)[0].trim();

  const cands = dateCandidates($, meta.ld);
  const published = meta.published || meta.ld.datePublished || '';
  let date = resolveDate(published, cands);
  if (!date) date = rel.slice(0, 10).split('/').join('-') + ' 00:00:00';
  const modified = meta.modified || meta.ld.dateModified || '';
  // The updated time is only worth writing when the page distinguishes it;
  // otherwise Hexo would show the file's mtime, which is what it did before.
  let updated = null;
  if (modified && Date.parse(modified) !== Date.parse(published)) {
    const minute = date.slice(0, 16); // 'YYYY-MM-DD HH:mm'; drop the candidates that named the created time
    const rest = cands.filter((c) => !c.replace('T', ' ').replace(/[./]/g, '-').startsWith(minute));
    updated = resolveDate(modified, rest);
  }

  const categories = uniq(sel.categories ? $(sel.categories).map((_, a) => $(a).text()).get() : namedLinks($, 'categories'));
  let tags = uniq(sel.tags ? $(sel.tags).map((_, a) => $(a).text().replace(/^#/, '')).get() : []);
  if (!tags.length) tags = uniq(meta.tags.length ? meta.tags : namedLinks($, 'tags'));

  const body = $(sel.body).first().get(0);
  if (!body) throw new Error(`${rel}: no element matches ${JSON.stringify(sel.body)}; pass --theme or --body-selector`);
  const markdown = new Converter().convert(body);
  const plainLen = norm(getText(body)).length;
  return { slug: rel.split('/').pop(), path: rel, title, date, updated, categories, tags, markdown, plainLen };
}

export function writePost(post, dest) {
  const fm = [`title: ${yamlStr(post.title || post.slug)}`, `date: ${post.date}`];
  if (post.updated) fm.push(`updated: ${post.updated}`);
  for (const key of ['categories', 'tags']) {
    if (post[key].length) {
      fm.push(`${key}:`);
      for (const v of post[key]) fm.push(`  - ${yamlStr(v)}`);
    }
  }
  fs.writeFileSync(dest, '---\n' + fm.join('\n') + '\n---\n\n' + post.markdown, 'utf8');
}

// ----------------------------------------------------------------------- site
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const SOCIAL_HOSTS = /github\.com|twitter\.com|x\.com|zhihu\.com|weibo\.com|youtube\.com|stackoverflow\.com|linkedin\.com|mastodon|bilibili\.com|telegram|t\.me|^mailto:|atom\.xml|rss/;
const READ_MORE = "a[href*='#more'], .readmore, .home-read-more, .article-more, .post-button a, .read-more, a.more, a.btn";

/**
 * Menu: links in the navigation to pages of this site. Without a theme
 * selector, anything inside nav/header/menu-like containers whose href is a
 * short local path and whose text is a short label.
 */
function menuLinks($, css) {
  const els = css ? $(css) : $('nav a, header a, [class*=menu] a, [class*=nav] a');
  const seen = new Set();
  const out = [];
  els.each((_, a) => {
    const href = ($(a).attr('href') || '').replace(/[?#].*$/, '');
    const text = norm($(a).text());
    if (!/^\/[^/]*\/?([^/]*\/?)?$/.test(href) || /\.\w+$/.test(href)) return;
    if (!text || text.length > 24 || seen.has(href)) return;
    seen.add(href);
    out.push([text, href]);
  });
  return out;
}

/** Social links: the theme's list, else any link to a known network outside the article, minus the theme's own repo. */
function socialLinks($, css) {
  const els = css ? $(css) : $('header a, aside a, footer a, [class*=social] a, [class*=author] a');
  const seen = new Set();
  const out = [];
  els.each((_, a) => {
    const href = $(a).attr('href') || '';
    if (!href || seen.has(href) || /hexo-theme|hexo\.io|github\.com\/hexojs/.test(href)) return;
    if (!/^(https?:|mailto:)/.test(href) && !/\.xml$/.test(href)) return; // a local page is not a social link
    if (!css && !SOCIAL_HOSTS.test(href)) return;
    seen.add(href);
    out.push([norm($(a).text()) || $(a).attr('title') || $(a).attr('aria-label') || '', href]);
  });
  return out;
}

/** Everything about the site that leaves a trace in the generated HTML. */
export function siteFacts(deploy, sel, theme = null, samplePost = null, postLengths = new Map()) {
  const index = path.join(deploy, 'index.html');
  const html = fs.existsSync(index) ? read(index) : '';
  const $ = cheerio.load(html);
  const g = (css, a) => {
    const e = css ? $(css).first() : $();
    if (!e.length) return '';
    return a ? e.attr(a) || '' : e.text().trim();
  };
  // Hexo's open_graph() writes the site name, author and description into every
  // page; the index of some themes omits it, so a post page is read as well.
  const meta = pageMeta($);
  const postMeta = samplePost ? pageMeta(load(samplePost)) : { siteName: '', author: '', generator: '' };
  const postHtml = samplePost ? read(samplePost) : '';
  const facts = {
    title: meta.siteName || postMeta.siteName || g(sel.siteTitle) || (g('title') ? g('title').split(' | ').pop() : ''),
    subtitle: g('.site-subtitle'),
    author: g(sel.author) || meta.author || postMeta.author,
    description: g(sel.description) || meta.description,
    avatar: [g(sel.avatar, 'src'), g("img[class*=avatar], .avatar img, img[src*=avatar], img[alt*=avatar]", 'src')]
      .find((u) => u && u !== 'undefined' && !u.startsWith('data:')) || '',
    lang: $('html').attr('lang') || 'en',
    generator: meta.generator || postMeta.generator,
    canonical: meta.url,
    menu: menuLinks($, sel.menu),
    social: socialLinks($, sel.social),
    hasSearchXml: fs.existsSync(path.join(deploy, 'search.xml')),
    hasBusuanzi: html.includes('busuanzi'),
    theme: theme || '', themeVersion: themeVersion(theme, html + postHtml), scheme: undefined, excerptLength: null,
  };
  const m = $.root().text().match(/NexT\.(\w+) v([\d.]+)/);
  if (m) facts.scheme = m[1];
  // Excerpt length: the median visible length of the index cards that were cut.
  // A card was cut if it carries a read-more link, or if it is clearly shorter
  // than the post it links to (themes whose whole card is the link have no
  // button). Cards that show the whole post say nothing about the setting.
  const cut = [];
  const pages = [index];
  const pageDir = path.join(deploy, 'page');
  if (fs.existsSync(pageDir)) for (const d of fs.readdirSync(pageDir).sort()) pages.push(path.join(pageDir, d, 'index.html'));
  for (const pg of pages) {
    if (!fs.existsSync(pg) || !sel.excerpt) continue;
    const $p = load(pg);
    $p(sel.excerpt).each((_, b) => {
      let card = $p(b);
      let post = null;
      for (let up = 0; up < 4 && card.length && !post; up++, card = card.parent()) {
        card.find('a[href]').addBack('a[href]').each((__, a) => {
          const key = ($p(a).attr('href') || '').replace(/^https?:\/\/[^/]+/, '').replace(/#.*$/, '').replace(/^\/|\/$/g, '');
          if (postLengths.has(key)) post = key;
        });
      }
      const hasButton = $p(b).find(READ_MORE).length || $p(b).parent().find(READ_MORE).length;
      $p(b).find(READ_MORE).remove();
      const len = norm($p(b).text()).length;
      if (hasButton || (post && len < postLengths.get(post) * 0.9)) cut.push(len);
    });
  }
  if (cut.length) facts.excerptLength = Math.round(median(cut) / 10) * 10; // 148..154 -> 150
  return facts;
}

const MENU_ICONS = { home: 'fa fa-home', categories: 'fa fa-th', archives: 'fa fa-archive', tags: 'fa fa-tags',
  about: 'fa fa-user', schedule: 'fa fa-calendar', sitemap: 'fa fa-sitemap' };
const MENU_ZH = { 首页: 'home', 分类: 'categories', 归档: 'archives', 标签: 'tags', 关于: 'about', 搜索: 'search' };
const LANG_NEXT8 = { 'zh-Hans': 'zh-CN', 'zh-hans': 'zh-CN', 'zh-Hant': 'zh-TW', 'zh-hant': 'zh-TW' };

function socialIcon(href) {
  const table = [['github.com', 'fab fa-github'], ['twitter.com', 'fab fa-twitter'], ['x.com', 'fab fa-x-twitter'],
    ['zhihu.com', 'fab fa-zhihu'], ['weibo.com', 'fab fa-weibo'], ['youtube.com', 'fab fa-youtube'],
    ['stackoverflow.com', 'fab fa-stack-overflow'], ['linkedin.com', 'fab fa-linkedin']];
  for (const [dom, icon] of table) if (href.includes(dom)) return icon;
  return href.includes('@') ? 'fa fa-envelope' : 'fa fa-link';
}

export function writeSiteConfig(out, f, url, permalink) {
  const lang = LANG_NEXT8[f.lang] || f.lang;
  const lines = [
    '# Rebuilt by hexo-recover from the generated site. Values marked (read) were',
    '# taken from the deployed HTML; everything else is a Hexo 8 default.',
    `title: ${yamlStr(f.title)}          # (read)`,
    `subtitle: ${yamlStr(f.subtitle)}`,
    `description: ${yamlStr(f.description)}`,
    'keywords:',
    `author: ${yamlStr(f.author)}        # (read)`,
    `language: ${yamlStr(lang)}        # (read as ${f.lang}; NexT 8 names the language files zh-CN / zh-TW)`,
    "timezone: ''",
    '',
    `url: ${url}`,
    '# (read) The deployed URLs follow this shape; changing it breaks every inbound link.',
    `permalink: ${permalink}`,
    'permalink_defaults:',
    'pretty_urls:',
    '  trailing_index: true',
    '  trailing_html: true',
    '',
    'source_dir: source', 'public_dir: public', 'tag_dir: tags', 'archive_dir: archives', 'category_dir: categories',
    'code_dir: downloads/code', 'i18n_dir: :lang', 'skip_render:',
    '',
    'new_post_name: :title.md', 'default_layout: post', 'titlecase: false',
    'external_link:', '  enable: true', '  field: site', "  exclude: ''",
    'filename_case: 0', 'render_drafts: false', 'post_asset_folder: false', 'relative_link: false', 'future: true',
    '',
    'syntax_highlighter: highlight.js',
    'highlight:', '  line_number: true', '  auto_detect: false', "  tab_replace: ''", '  wrap: true', '  hljs: false',
    '',
    'index_generator:', "  path: ''", '  per_page: 10', '  order_by: -date',
    '',
    'per_page: 10', 'pagination_dir: page',
    '',
    'theme: next',
  ];
  if (f.hasSearchXml) lines.push('', '# (read) The site shipped a search.xml, i.e. hexo-generator-searchdb was installed.',
    'search:', '  path: search.xml', '  field: post', '  content: true', '  format: html');
  if (f.excerptLength) lines.push('', `# (read) Index excerpts were cut at about ${f.excerptLength} characters with a read-more`,
    '# button. hexo-auto-excerpt reproduces that without a <!-- more --> tag in any post.',
    `excerpt_length: ${f.excerptLength}`);
  lines.push('', 'deploy:', '  type: git', '  repo: <your github pages repo>', '  branch: master', '');
  fs.writeFileSync(path.join(out, '_config.yml'), lines.join('\n'), 'utf8');
}

export function writeThemeConfig(out, f) {
  const menu = [];
  for (const [name, hrefIn] of f.menu) {
    const key = MENU_ZH[name] || name.toLowerCase();
    if (key === 'search') continue; // NexT 8 renders search from local_search, not a menu page
    const last = hrefIn.split('/').pop();
    const href = hrefIn.endsWith('/') || last.includes('.') ? hrefIn : hrefIn + '/';
    menu.push(`  ${key}: ${href} || ${MENU_ICONS[key] || 'fa fa-link'}`);
  }
  const social = [];
  for (const [name, hrefIn] of f.social) {
    if (!hrefIn) continue;
    const href = hrefIn.includes('@') && !hrefIn.startsWith('mailto:') ? 'mailto:' + hrefIn : hrefIn;
    social.push(`  ${name || href}: ${href} || ${socialIcon(href)}`);
  }
  const origin = f.theme && f.theme !== 'next'
    ? `# The original site was generated with the ${f.theme} theme; the menu, avatar and\n# social links below were read from its pages and carried over to NexT.\n`
    : '';
  const text = `# NexT 8 theme config, rebuilt by hexo-recover. Put this at the root of the Hexo
# project as _config.next.yml (Hexo 5+ theme-config location). Every value below
# reproduces something visible on the old site; everything else is the NexT 8
# default (see node_modules/hexo-theme-next/_config.yml).
${origin}
scheme: ${f.scheme || 'Muse'}

menu:
${menu.join('\n') || '  home: / || fa fa-home'}

menu_settings:
  icons: true
  badges: false

avatar:
  url: ${f.avatar || '/images/avatar.jpg'}
  rounded: false
  rotated: false

social:
${social.join('\n') || '  # none found in the generated HTML'}

social_icons:
  enable: true
  icons_only: false

excerpt_description: true
read_more_btn: true

post_meta:
  item_text: true
  created_at: true
  updated_at:
    enable: false
  categories: true

codeblock:
  theme:
    light: default
    dark: stackoverflow-dark
  copy_button:
    enable: true

busuanzi_count:
  enable: ${f.hasBusuanzi ? 'true' : 'false'}

local_search:
  enable: ${f.hasSearchXml ? 'true' : 'false'}
  trigger: auto
  top_n_per_article: 1
`;
  fs.writeFileSync(path.join(out, '_config.next.yml'), text, 'utf8');
}

export function writePackageJson(out, f) {
  const deps = {
    hexo: '^8.0.0', 'hexo-generator-archive': '^2.0.0', 'hexo-generator-category': '^2.0.0',
    'hexo-generator-index': '^4.0.0', 'hexo-generator-tag': '^2.0.0', 'hexo-renderer-ejs': '^2.0.0',
    'hexo-renderer-marked': '^7.0.0', 'hexo-renderer-stylus': '^3.0.1', 'hexo-server': '^3.0.0',
    'hexo-theme-next': '^8.0.0', 'hexo-deployer-git': '^4.0.0',
  };
  if (f.hasSearchXml) deps['hexo-generator-searchdb'] = '^1.5.0';
  if (f.excerptLength) deps['hexo-auto-excerpt'] = '^1.1.2';
  const pkg = {
    name: 'blog', private: true, hexo: { version: '8.0.0' },
    scripts: { build: 'hexo generate', clean: 'hexo clean', deploy: 'hexo deploy', server: 'hexo server' },
    dependencies: Object.fromEntries(Object.entries(deps).sort()),
  };
  fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

export function writePages(deploy, out, sel, report) {
  const about = path.join(deploy, 'about', 'index.html');
  if (fs.existsSync(about)) {
    const $ = load(about);
    const body = $(sel.body).first().get(0) || (sel.page ? $(sel.page).first().get(0) : null);
    if (body) {
      const t = sel.title ? $(sel.title).first() : $();
      const title = pageMeta($).title || (t.length ? t.text().trim() : 'about');
      const d = path.join(out, 'source', 'about');
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'index.md'),
        `---\ntitle: ${yamlStr(title)}\ndate: 2000-01-01 00:00:00\n---\n\n` + new Converter().convert(body), 'utf8');
      report.about = true;
    }
  }
  for (const kind of ['tags', 'categories']) {
    if (fs.existsSync(path.join(deploy, kind, 'index.html'))) {
      const d = path.join(out, 'source', kind);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'index.md'),
        `---\ntitle: ${kind}\ndate: 2000-01-01 00:00:00\ntype: ${kind}\ncomments: false\n---\n`, 'utf8');
      report.pages.push(kind);
    }
  }
}

/**
 * The theme to read the site with: the requested one, or the one the first
 * post page was generated by. Explicit --body-selector/--title-selector win
 * over the theme's own selectors either way.
 */
export function resolveTheme(pages, opt) {
  let name = opt.theme && opt.theme !== 'auto' ? opt.theme : null;
  if (name && !THEMES[name]) throw new Error(`unknown theme ${JSON.stringify(name)}; one of ${Object.keys(THEMES).join(', ')}`);
  if (!name && pages.length) {
    const html = read(pages[0]);
    name = detectTheme(cheerio.load(html), html);
  }
  const sel = selectorsFor(name, opt.selectors);
  if (!sel.body) {
    throw new Error(`could not tell which theme generated ${pages[0] || 'the site'} (known: ${Object.keys(THEMES).join(', ')}); `
      + 'pass --theme, or --body-selector with the CSS selector of the article body');
  }
  return { name, sel };
}

export function recover(deployDir, outDir, opt = defaultOptions()) {
  const deploy = path.resolve(deployDir);
  const out = path.resolve(outDir);
  fs.mkdirSync(path.join(out, 'source', '_posts'), { recursive: true });
  fs.mkdirSync(path.join(out, 'scaffolds'), { recursive: true });
  const report = { public: [], private: [], dropped: [], images: 0, about: false, pages: [] };

  const pages = [];
  for (const idx of postPages(deploy, opt.postGlob)) {
    const rel = path.relative(deploy, path.dirname(idx)).split(path.sep).join('/');
    if (POST_DIR.test(rel)) pages.push(idx);
  }
  const { name: themeName, sel } = resolveTheme(pages, opt);
  const posts = pages.map((idx) => parsePost(idx, path.relative(deploy, path.dirname(idx)).split(path.sep).join('/'), sel));

  const used = new Set();
  for (const p of posts) {
    if (opt.drop[p.path] !== undefined) {
      report.dropped.push({ path: p.path, why: opt.drop[p.path] });
      continue;
    }
    const slug = used.has(p.slug) ? p.date.slice(0, 10) + '-' + p.slug : p.slug;
    used.add(slug);
    if (opt.private[p.path] !== undefined) {
      fs.mkdirSync(path.join(out, '_private'), { recursive: true });
      writePost(p, path.join(out, '_private', `${slug}.md`));
      report.private.push({ path: p.path, title: p.title, why: opt.private[p.path] });
    } else {
      const dest = path.join(out, 'source', '_posts', `${slug}.md`);
      writePost(p, dest);
      report.public.push({ path: p.path, title: p.title, date: p.date, chars: p.plainLen, categories: p.categories,
        tags: p.tags, code_blocks: (p.markdown.split('\n```').length - 1) >> 1, file: path.basename(dest) });
    }
  }

  for (const assetDir of ['images', 'img', 'uploads']) {
    const src = path.join(deploy, assetDir);
    if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
      const dst = path.join(out, 'source', assetDir);
      fs.rmSync(dst, { recursive: true, force: true });
      fs.cpSync(src, dst, { recursive: true });
      report.images += countFiles(dst);
    }
  }
  if (fs.existsSync(path.join(deploy, 'favicon.ico'))) fs.copyFileSync(path.join(deploy, 'favicon.ico'), path.join(out, 'source', 'favicon.ico'));

  const facts = siteFacts(deploy, sel, themeName, pages[0] || null, new Map(posts.map((p) => [p.path, p.plainLen])));
  const url = opt.url || (facts.canonical ? facts.canonical.replace(/\/$/, '').replace(/\/[^/]*$/, '') : 'http://example.com');
  writeSiteConfig(out, facts, url, ':year/:month/:day/:title/');
  writeThemeConfig(out, facts);
  writePackageJson(out, facts);
  writePages(deploy, out, sel, report);
  fs.writeFileSync(path.join(out, 'scaffolds', 'post.md'), '---\ntitle: {{ title }}\ndate: {{ date }}\ncategories:\ntags:\n---\n', 'utf8');
  fs.writeFileSync(path.join(out, '.gitignore'), 'node_modules/\npublic/\ndb.json\n.deploy_git/\n_private/\n', 'utf8');
  report.site = facts;
  fs.writeFileSync(path.join(out, 'RECOVERY-REPORT.json'), JSON.stringify(report, null, 2), 'utf8');
  return report;
}

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  return n;
}
