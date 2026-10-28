// Turns the single-file Vite build into a page body for hosts that supply their own
// <html>/<head>/<body> skeleton (such as a claude.ai artifact): drops the document
// wrapper tags and the charset/viewport metas, keeps everything else in order.
import { readFileSync, writeFileSync } from 'node:fs';

const src = new URL('../dist/index.html', import.meta.url);
const out = new URL('../dist/shardfall-artifact.html', import.meta.url);

const html = readFileSync(src, 'utf8')
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<\/?html[^>]*>\s*/gi, '')
  .replace(/<\/?head>\s*/gi, '')
  .replace(/<\/?body>\s*/gi, '')
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');

writeFileSync(out, html);
console.log(`wrote ${out.pathname} (${(html.length / 1024).toFixed(0)} KB)`);
