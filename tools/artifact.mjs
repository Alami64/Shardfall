// Turns dist/index.html into dist/shardfall.html: the same page without the document
// wrapper tags, for hosts that add their own <html>, <head> and <body>.
import { readFileSync, writeFileSync } from 'node:fs';

let html = readFileSync('dist/index.html', 'utf8');
html = html
  .replace(/<!doctype html>/i, '')
  .replace(/<\/?(html|head|body)[^>]*>/gi, '')
  .replace(/<meta charset[^>]*>/i, '')
  .replace(/<meta name="viewport"[^>]*>/i, '')
  .trim();
writeFileSync('dist/shardfall.html', html + '\n');
console.log('dist/shardfall.html', (html.length / 1024).toFixed(0) + ' kB');
