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

  const calendarResponse = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query($login: String!) { user(login: $login) { contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } } } } }`,
      variables: { login: username },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await calendarResponse.json();
  const calendar = result.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendarResponse.ok || result.errors || !calendar) throw new Error('Contribution calendar request failed');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const days = calendar.weeks.flatMap((week) => week.contributionDays).filter((day) => day.date <= today);
  let longest = 0;
  let streak = 0;
  for (const day of days) {
    streak = day.contributionCount ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  }
  let last = days.length - 1;
  // A new day does not break the current streak until that day has ended.
  if (days[last]?.date === today && !days[last].contributionCount) last--;
  let current = 0;
  for (; last >= 0 && days[last].contributionCount > 0; last--) current++;

  for (const [theme, suffix] of [['github', ''], ['github-dark', '-dark']]) {
    const dark = theme === 'github-dark';
    const background = dark ? '#0d1117' : '#f6f8fa';
    const border = dark ? '#212d3b' : '#d8e2ec';
    const foreground = dark ? '#f0f6fc' : '#1f2328';
    const muted = dark ? '#8b949e' : '#57606a';
    const accent = dark ? '#58d5e8' : '#087e98';
    const cards = [[calendar.totalContributions, 'CONTRIBUTIONS / YEAR'], [current, 'CURRENT STREAK / DAYS'], [longest, 'LONGEST STREAK / DAYS']];
    const stats = `<svg xmlns="http://www.w3.org/2000/svg" width="1166" height="180" viewBox="0 0 1166 180" role="img" aria-labelledby="title"><title id="title">GitHub contributions: ${calendar.totalContributions}; current streak: ${current} days; longest streak: ${longest} days</title><rect x="1" y="1" width="1164" height="178" rx="14" fill="${background}" stroke="${border}"/><path d="M389 32v116M777 32v116" stroke="${border}"/>${cards.map(([value, label], index) => `<text x="${194 + index * 389}" y="85" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif" font-size="44" font-weight="700" fill="${index === 1 ? accent : foreground}">${value}</text><text x="${194 + index * 389}" y="119" text-anchor="middle" font-family="monospace" font-size="12" letter-spacing="1.5" fill="${muted}">${label}</text>`).join('')}<text x="1138" y="162" text-anchor="end" font-family="monospace" font-size="10" fill="${muted}">UPDATED ${today} · UTC+8</text></svg>`;
    await writeFile(`dist/stats${suffix}.svg`, stats);
    console.log(`Generated dist/stats${suffix}.svg`);
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
