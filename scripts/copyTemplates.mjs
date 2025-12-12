import { mkdir, readdir, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const SRC_TEMPLATES = path.join(ROOT, 'src', 'templates');
const DIST_TEMPLATES = path.join(ROOT, 'dist', 'templates');

async function existsDir(dir) {
  try {
    const s = await stat(dir);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function main() {
  if (!(await existsDir(SRC_TEMPLATES))) {
    // No templates directory (shouldn't happen), but don't fail the build.
    console.warn(`[copyTemplates] src/templates not found at ${SRC_TEMPLATES}`);
    return;
  }

  await mkdir(DIST_TEMPLATES, { recursive: true });

  const entries = await readdir(SRC_TEMPLATES, { withFileTypes: true });
  const htmlFiles = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.html'))
    .map((e) => e.name);

  if (htmlFiles.length === 0) {
    console.warn('[copyTemplates] No .html templates found to copy');
    return;
  }

  await Promise.all(
    htmlFiles.map((name) =>
      copyFile(path.join(SRC_TEMPLATES, name), path.join(DIST_TEMPLATES, name))
    )
  );

  console.log(`[copyTemplates] Copied ${htmlFiles.length} template(s) to dist/templates`);
}

main().catch((err) => {
  console.error('[copyTemplates] Failed to copy templates:', err);
  process.exitCode = 1;
});


