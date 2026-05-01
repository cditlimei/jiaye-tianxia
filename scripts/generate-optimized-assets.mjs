import { execFile } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

const jobs = [
  {
    sourceDir: 'assets/lords',
    targetDir: 'public/optimized/lords',
    widths: [160, 320, 640],
    outputFormat: 'jpg',
    sipsFormat: 'jpeg',
    quality: '74'
  },
  {
    sourceDir: 'assets/partners',
    targetDir: 'public/optimized/partners',
    widths: [320, 640],
    outputFormat: 'jpg',
    sipsFormat: 'jpeg',
    quality: '74'
  },
  {
    sourceDir: 'assets/homes',
    targetDir: 'public/optimized/homes',
    widths: [640, 960],
    outputFormat: 'jpg',
    sipsFormat: 'jpeg',
    quality: '74'
  },
  {
    sourceDir: 'assets/weapons',
    targetDir: 'public/optimized/weapons',
    widths: [256, 512],
    outputFormat: 'png'
  },
  {
    sourceDir: 'assets/ui',
    targetDir: 'public/optimized/ui',
    widths: [256, 512],
    outputFormat: 'png'
  }
];

let generated = 0;

for (const job of jobs) {
  const sourceDir = join(root, job.sourceDir);
  const targetDir = join(root, job.targetDir);
  await mkdir(targetDir, { recursive: true });

  const files = (await readdir(sourceDir)).filter((file) => /\.(png|jpe?g)$/i.test(file));
  for (const file of files) {
    const input = join(sourceDir, file);
    const name = basename(file, extname(file));

    for (const width of job.widths) {
      const output = join(targetDir, `${name}-${width}.${job.outputFormat}`);
      const args = ['-Z', String(width)];

      if (job.sipsFormat) {
        args.push('-s', 'format', job.sipsFormat);
      }

      if (job.quality) {
        args.push('-s', 'formatOptions', job.quality);
      }

      args.push(input, '--out', output);
      await execFileAsync('sips', args);
      generated += 1;
    }
  }
}

console.log(`optimized_assets_generated=${generated}`);
