// GitHub Pages не знает про маршруты SPA: для глубоких ссылок отдаём index.html как 404.html.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '../dist-demo');
fs.copyFileSync(path.join(dir, 'index.html'), path.join(dir, '404.html'));
fs.writeFileSync(path.join(dir, '.nojekyll'), '');
console.log('✓ 404.html и .nojekyll добавлены');
