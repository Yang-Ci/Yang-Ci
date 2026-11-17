import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Use the upstream renderer directly, without the action's leaderboard reporting.
// https://github.com/abozanona/pacman-contribution-graph
const revision = '70945878b1118303b37b88060fc7145e1a57d7b1';
const username = process.env.GITHUB_USER;
if (!username || !process.env.GITHUB_TOKEN) {
  throw new Error('GITHUB_USER and GITHUB_TOKEN are required');
}
const temporary = await mkdtemp(join(tmpdir(), 'contribution-snake-'));
try {
  const response = await fetch(
    `https://raw.githubusercontent.com/abozanona/pacman-contribution-graph/${revision}/dist/pacman-contribution-graph.js`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!response.ok) throw new Error(`Renderer download failed: ${response.status}`);
  const modulePath = join(temporary, 'renderer.mjs');
  await writeFile(modulePath, await response.text());
  const { ArcadeRenderer } = await import(pathToFileURL(modulePath).href);
  await mkdir('dist', { recursive: true });

  for (const [theme, suffix] of [['github', ''], ['github-dark', '-dark']]) {
    let animation;
    const renderer = new ArcadeRenderer({
      game: 'snake',
      platform: 'github',
      username,
      gameTheme: theme,
      showMonthLabels: true,
      githubSettings: { accessToken: process.env.GITHUB_TOKEN },
      svgCallback: (svg) => { animation = svg; },
      pointsIncreasedCallback: () => {},
    });
    await renderer.start();
    if (!animation?.includes('<svg')) throw new Error(`No SVG generated for ${theme}`);
    const output = `dist/snake-contribution-graph${suffix}.svg`;
    await writeFile(output, animation);
    console.log(`Generated ${output} (${animation.length} characters)`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
