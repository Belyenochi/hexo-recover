/** Turn a generated Hexo site back into a Hexo project. */
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { Converter, getText } from './convert.js';

const POST_DIR = /^\d{4}\/\d{2}\/\d{2}\/[^/]+$/;

/** CSS selectors for the theme's post markup. Defaults are NexT's. */
export const THEME_PRESETS = {
  next: {
    body: '.post-body',
    title: '.post-title',
    metaTime: '.post-meta time',
    categories: ".post-meta a[href^='/categories/']",
    tags: '.post-tags a',
    indexArticle: 'article',
  },
  landscape: {
    body: '.article-entry',
    title: '.article-title',
    metaTime: '.article-meta time',
    categories: '.article-category-link',
    tags: '.article-tag-list-link',
    indexArticle: 'article',
  },
};

export const defaultOptions = () => ({
  url: null,
  private: {},   // path -> reason, written to _private/
  drop: {},      // path -> reason, written nowhere
  selectors: { ...THEME_PRESETS.next },
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

export function parsePost(file, rel, sel) {
  const $ = load(file);
  const titleEl = $(sel.title).first();
  const title = titleEl.length ? norm(titleEl.text()) : '';
  let date = null;
  let upd = null;
  $(sel.metaTime).each((_, t) => {
    const dt = $(t).attr('datetime');
    if (!dt) return;
    const item = $(t).closest('.post-meta-item');
    const txt = item.length ? norm(item.text()) : $(t).text();
    if (txt.includes('更新') || txt.includes('Edited') || txt.toLowerCase().includes('updated')) upd = dt;
    else if (date === null) date = dt;
  });
  if (date === null) date = rel.slice(0, 10).split('/').join('-') + 'T00:00:00+08:00';
  const uniq = (xs) => [...new Set(xs.filter(Boolean))];
  const categories = uniq($(sel.categories).map((_, a) => $(a).text().trim()).get());
  const tags = uniq($(sel.tags).map((_, a) => $(a).text().trim().replace(/^#/, '').trim()).get());
  const body = $(sel.body).first().get(0);
  if (!body) throw new Error(`${rel}: no element matches ${JSON.stringify(sel.body)}; pass --body-selector for this theme`);
  const markdown = new Converter().convert(body);
  const plainLen = norm(getText(body)).length;
  return { slug: rel.split('/').pop(), path: rel, title, date, updated: upd, categories, tags, markdown, plainLen };
}

export function writePost(post, dest) {
  const fm = [`title: ${yamlStr(post.title || post.slug)}`, `date: ${post.date.slice(0, 19).replace('T', ' ')}`];
  if (post.updated) fm.push(`updated: ${post.updated.slice(0, 19).replace('T', ' ')}`);
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

/** Everything about the site that leaves a trace in the generated HTML. */
export function siteFacts(deploy, sel) {
  const index = path.join(deploy, 'index.html');
  const html = fs.existsSync(index) ? read(index) : '';
  const $ = cheerio.load(html);
  const g = (css, a) => {
    const e = $(css).first();
    if (!e.length) return '';
    return a ? e.attr(a) || '' : e.text().trim();
  };
  const facts = {
    title: g('.site-title') || (g('title') ? g('title').split(' | ').pop() : ''),
    subtitle: g('.site-subtitle'),
    author: g('.site-author-name'),
    description: g('.site-description'),
    avatar: g('.site-author-image', 'src'),
    lang: $('html').attr('lang') || 'en',
    generator: g('meta[name=generator]', 'content'),
    canonical: g('link[rel=canonical]', 'href') || g("meta[property='og:url']", 'content'),
    menu: $('.menu-item a').map((_, a) => [[norm($(a).text()), $(a).attr('href') || '']]).get(),
    social: $('.links-of-author-item a, .social-link, .links-of-author a')
      .map((_, a) => [[norm($(a).text()) || $(a).attr('title') || '', $(a).attr('href') || '']]).get(),
    hasSearchXml: fs.existsSync(path.join(deploy, 'search.xml')),
    hasBusuanzi: html.includes('busuanzi'),
    theme: '', themeVersion: '', scheme: undefined, excerptLength: null,
  };
  let m = $.root().text().match(/NexT\.(\w+) v([\d.]+)/);
  if (m) { facts.theme = 'next'; facts.scheme = m[1]; facts.themeVersion = m[2]; }
  else if ((m = html.match(/hexo-theme-next\/([\d.]+)/))) { facts.theme = 'next'; facts.themeVersion = m[1]; }
  // Excerpt length: the median visible length of the index excerpts. If every
  // entry on the index is a full post there is no excerpting to reproduce.
  const lens = [];
  let buttons = 0;
  const pages = [index];
  const pageDir = path.join(deploy, 'page');
  if (fs.existsSync(pageDir)) for (const d of fs.readdirSync(pageDir).sort()) pages.push(path.join(pageDir, d, 'index.html'));
  for (const pg of pages) {
    if (!fs.existsSync(pg)) continue;
    const $p = load(pg);
    $p(sel.indexArticle).each((_, art) => {
      const b = $p(art).find(sel.body).first();
      if (!b.length) return;
      if ($p(art).find("a.btn[href*='#more'], .post-button a").length) buttons += 1;
      b.find('a.btn').remove();
      lens.push(norm(b.text()).length);
    });
  }
  if (lens.length && buttons) facts.excerptLength = Math.round(median(lens) / 10) * 10; // 148..154 -> 150
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
  const text = `# NexT 8 theme config, rebuilt by hexo-recover. Put this at the root of the Hexo
# project as _config.next.yml (Hexo 5+ theme-config location). Every value below
# reproduces something visible on the old site; everything else is the NexT 8
# default (see node_modules/hexo-theme-next/_config.yml).

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
    const body = $(sel.body).first().get(0);
    if (body) {
      const t = $(sel.title).first();
      const title = t.length ? t.text().trim() : 'about';
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

export function recover(deployDir, outDir, opt = defaultOptions()) {
  const deploy = path.resolve(deployDir);
  const out = path.resolve(outDir);
  const sel = opt.selectors;
  fs.mkdirSync(path.join(out, 'source', '_posts'), { recursive: true });
  fs.mkdirSync(path.join(out, 'scaffolds'), { recursive: true });
  const report = { public: [], private: [], dropped: [], images: 0, about: false, pages: [] };

  const posts = [];
  for (const idx of postPages(deploy, opt.postGlob)) {
    const rel = path.relative(deploy, path.dirname(idx)).split(path.sep).join('/');
    if (POST_DIR.test(rel)) posts.push(parsePost(idx, rel, sel));
  }

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

  const facts = siteFacts(deploy, sel);
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
