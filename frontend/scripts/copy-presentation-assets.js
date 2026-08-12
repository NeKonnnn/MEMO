/**
 * Копирует ассеты презентаций ГПБ в public/static:
 * - dom-to-pptx.bundle.js из node_modules
 * - иконки/шрифты из ../../pptx/icons (если каталог заполнен)
 *
 * Запуск: node scripts/copy-presentation-assets.js
 * Вызывается автоматически из prestart/prebuild в package.json.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC_STATIC = path.join(ROOT, 'public', 'static');
const PPTX_ICONS = path.join(ROOT, '..', 'pptx', 'icons');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) return false;
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  return true;
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return 0;
  ensureDir(dest);
  let count = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyDir(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
      count += 1;
    }
  }
  return count;
}

function main() {
  ensureDir(PUBLIC_STATIC);
  ensureDir(path.join(PUBLIC_STATIC, 'icons'));
  ensureDir(path.join(PUBLIC_STATIC, 'icons_new'));
  ensureDir(path.join(PUBLIC_STATIC, 'fonts'));

  const domCandidates = [
    path.join(ROOT, 'node_modules', 'dom-to-pptx', 'dist', 'dom-to-pptx.bundle.js'),
    path.join(ROOT, 'node_modules', 'dom-to-pptx', 'dist', 'dom-to-pptx.bundle_patched.js'),
  ];
  let domCopied = false;
  for (const src of domCandidates) {
    if (copyFile(src, path.join(PUBLIC_STATIC, 'dom-to-pptx.bundle.js'))) {
      domCopied = true;
      console.log('[presentation-assets] dom-to-pptx:', src);
      break;
    }
  }
  if (!domCopied) {
    console.warn('[presentation-assets] dom-to-pptx не найден — выполните npm install dom-to-pptx');
  }

  const iconMappings = [
    { from: path.join(PPTX_ICONS, 'icons'), to: path.join(PUBLIC_STATIC, 'icons') },
    { from: path.join(PPTX_ICONS, 'icons_new'), to: path.join(PUBLIC_STATIC, 'icons_new') },
    { from: path.join(PPTX_ICONS, 'fonts'), to: path.join(PUBLIC_STATIC, 'fonts') },
  ];

  for (const { from, to } of iconMappings) {
    const n = copyDir(from, to);
    if (n > 0) {
      console.log(`[presentation-assets] скопировано ${n} файлов: ${from} -> ${to}`);
    }
  }

  const requiredBrandIcons = ['gpb_small.png', 'gpb_big.png', 'side.png'];
  const iconsDir = path.join(PUBLIC_STATIC, 'icons');
  const missing = requiredBrandIcons.filter((name) => !fs.existsSync(path.join(iconsDir, name)));
  if (missing.length) {
    console.warn(
      `[presentation-assets] Не хватает брендовых иконок в public/static/icons: ${missing.join(', ')}`
    );
    console.warn('[presentation-assets] Скопируйте их из pptx/icons/icons/ (внутри контура).');
  }
}

main();
