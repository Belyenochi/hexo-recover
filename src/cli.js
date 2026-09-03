#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { THEME_PRESETS, defaultOptions, recover } from './recover.js';
import { verify } from './verify.js';

const { version } = createRequire(import.meta.url)('../package.json');

const USAGE = `hexo-recover ${version}
Rebuild a Hexo project from its generated HTML, and verify the rebuild.

  hexo-recover recover <site> <out> [options]
      --url URL                site URL for _config.yml (default: <link rel=canonical>, else example.com)
      --private PATH[=WHY]     write this post to _private/ instead of source/_posts/ (repeatable)
      --drop PATH[=WHY]        leave this post out entirely (repeatable)
      --theme next|landscape   selector preset for the theme's post markup (default: next)
      --body-selector CSS      article body selector; overrides the preset
      --title-selector CSS     article title selector; overrides the preset
      --post-glob GLOB         where post pages live (default: YYYY/MM/DD/slug/index.html)

  hexo-recover verify <original> <regenerated> [--body-selector CSS]
      exits 0 only when every post body is identical once spaces are removed and
      every structural tag count matches

PATH is the post's URL path, e.g. 2021/05/19/love.`;

/** --private 2021/05/19/love="removed by hand"  ->  {path: reason} */
function kv(items) {
  const out = {};
  for (const it of items || []) {
    const i = it.indexOf('=');
    const p = (i < 0 ? it : it.slice(0, i)).replace(/^\/+|\/+$/g, '');
    out[p] = i < 0 ? 'excluded' : it.slice(i + 1);
  }
  return out;
}

export function main(argv = process.argv.slice(2)) {
  const cmd = argv[0];
  if (!cmd || cmd === '-h' || cmd === '--help') { console.log(USAGE); return cmd ? 0 : 2; }
  if (cmd === '--version' || cmd === '-V') { console.log(`hexo-recover ${version}`); return 0; }

  if (cmd === 'recover') {
    const { values: v, positionals } = parseArgs({
      args: argv.slice(1), allowPositionals: true,
      options: {
        url: { type: 'string' }, private: { type: 'string', multiple: true }, drop: { type: 'string', multiple: true },
        theme: { type: 'string', default: 'next' }, 'body-selector': { type: 'string' },
        'title-selector': { type: 'string' }, 'post-glob': { type: 'string' },
      },
    });
    if (positionals.length !== 2) { console.error(USAGE); return 2; }
    if (!THEME_PRESETS[v.theme]) { console.error(`unknown --theme ${v.theme}; one of ${Object.keys(THEME_PRESETS).join(', ')}`); return 2; }
    const opt = defaultOptions();
    opt.url = v.url || null;
    opt.private = kv(v.private);
    opt.drop = kv(v.drop);
    opt.selectors = { ...THEME_PRESETS[v.theme] };
    if (v['body-selector']) opt.selectors.body = v['body-selector'];
    if (v['title-selector']) opt.selectors.title = v['title-selector'];
    if (v['post-glob']) opt.postGlob = v['post-glob'];
    const rep = recover(positionals[0], positionals[1], opt);
    const f = rep.site;
    console.log(`public posts : ${rep.public.length}`);
    console.log(`private posts: ${rep.private.length}`);
    console.log(`dropped      : ${rep.dropped.length}`);
    console.log(`images       : ${rep.images}`);
    console.log(`pages        : ${rep.about ? 'about ' : ''}${rep.pages.join(' ')}`);
    console.log(`site         : ${JSON.stringify(f.title)} by ${JSON.stringify(f.author)}, lang ${f.lang}, `
      + `theme ${f.theme || '?'} ${f.themeVersion}, excerpt ${f.excerptLength || 'none'}`);
    console.log(`report       : ${positionals[1]}/RECOVERY-REPORT.json`);
    return 0;
  }

  if (cmd === 'verify') {
    const { values: v, positionals } = parseArgs({
      args: argv.slice(1), allowPositionals: true,
      options: { 'body-selector': { type: 'string', default: '.post-body' } },
    });
    if (positionals.length !== 2) { console.error(USAGE); return 2; }
    return verify(positionals[0], positionals[1], v['body-selector']);
  }

  console.error(`unknown command ${cmd}\n\n${USAGE}`);
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/hexo-recover')) {
  process.exitCode = main();
}
