/**
 * Releases as they actually are: versions from the project's changelog (Keep-a-Changelog
 * shape, `## [1.8.1] - 2026-08-18` with `### Added/Changed/Fixed/Removed`), the
 * `[Unreleased]` block as the next release, and the pull requests merged since the last
 * shipped version, per repo. Cached per project for config.liveCacheMs.
 */
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { config } from "./config.ts";
import { reposUnder } from "./git.ts";
import type { Project } from "./projects.ts";

const run = promisify(execFile);

export type ChangeKind = "Added" | "Changed" | "Fixed" | "Removed";

export interface ChangeBullet {
  kind: ChangeKind;
  text: string;
  key?: string;
}

export interface MergedPr {
  repo: string;
  number: number;
  title: string;
  url: string;
  mergedAt: string;
  /** feature | fix | other, from the conventional-commit prefix of the title. */
  kind: "feature" | "fix" | "other";
}

export interface Release {
  /** "Unreleased" for the next one. */
  version: string;
  date?: string;
  bullets: ChangeBullet[];
  counts: { added: number; changed: number; fixed: number; removed: number; prs: number; prFeatures: number; prFixes: number };
  prs: MergedPr[];
  /** GitHub compare links per repo: previous tag to this tag (or latest tag to develop for the next release). */
  compare: Array<{ repo: string; url: string }>;
}

export interface ReleasesView {
  changelog?: string;
  next?: Release;
  shipped: Release[];
  fetchedAt: string;
}

const CHANGELOG_CANDIDATES = ["contracts/CHANGELOG.md", "CHANGELOG.md", "docs/CHANGELOG.md"];

const findChangelog = async (projectPath: string): Promise<string | undefined> => {
  for (const rel of CHANGELOG_CANDIDATES) {
    const full = join(projectPath, rel);
    try {
      await access(full);
      return full;
    } catch {
      /* next candidate */
    }
  }
  return undefined;
};

const parseChangelog = (text: string): Array<{ version: string; date?: string; bullets: ChangeBullet[] }> => {
  const out: Array<{ version: string; date?: string; bullets: ChangeBullet[] }> = [];
  let current: { version: string; date?: string; bullets: ChangeBullet[] } | null = null;
  let kind: ChangeKind | null = null;
  for (const line of text.split("\n")) {
    const version = line.match(/^## \[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/);
    if (version) {
      current = { version: version[1], date: version[2], bullets: [] };
      out.push(current);
      kind = null;
      continue;
    }
    const section = line.match(/^### (Added|Changed|Fixed|Removed)/);
    if (section) {
      kind = section[1] as ChangeKind;
      continue;
    }
    if (current && kind && line.startsWith("- ")) {
      const key = line.match(/<!--\s*changelog-key:\s*([^\s]+)\s*-->/)?.[1];
      const textOnly = line.slice(2).replace(/<!--.*?-->/g, "").trim();
      current.bullets.push({ kind, text: textOnly, ...(key ? { key } : {}) });
    }
  }
  return out;
};

const prKind = (title: string): MergedPr["kind"] => {
  if (/^(feat|feature)\b/i.test(title)) return "feature";
  if (/^(fix|hotfix|bugfix)\b/i.test(title)) return "fix";
  return "other";
};

const mergedPrs = async (repoLabel: string, repoPath: string): Promise<MergedPr[]> => {
  try {
    const { stdout } = await run(
      "gh",
      ["pr", "list", "--state", "merged", "--limit", "400", "--json", "number,title,url,mergedAt"],
      { cwd: repoPath },
    );
    const rows = JSON.parse(stdout) as Array<{ number: number; title: string; url: string; mergedAt: string }>;
    return rows.map((r) => ({ repo: repoLabel, number: r.number, title: r.title, url: r.url, mergedAt: r.mergedAt, kind: prKind(r.title) }));
  } catch {
    return [];
  }
};

/** When the tag for a version was cut in a repo. Undefined when the repo does not carry it. */
const tagDate = async (repoPath: string, version: string): Promise<string | undefined> => {
  for (const tag of [`v${version}`, version]) {
    try {
      const { stdout } = await run("git", ["-C", repoPath, "log", "-1", "--format=%cI", tag]);
      if (stdout.trim()) return new Date(stdout.trim()).toISOString();
    } catch {
      /* no such tag here */
    }
  }
  return undefined;
};

const githubUrl = async (repoPath: string): Promise<string | undefined> => {
  try {
    const { stdout } = await run("git", ["-C", repoPath, "remote", "get-url", "origin"]);
    const m = stdout.trim().match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/);
    return m ? `https://github.com/${m[1]}/${m[2]}` : undefined;
  } catch {
    return undefined;
  }
};

const counts = (bullets: ChangeBullet[], prs: MergedPr[]): Release["counts"] => ({
  added: bullets.filter((b) => b.kind === "Added").length,
  changed: bullets.filter((b) => b.kind === "Changed").length,
  fixed: bullets.filter((b) => b.kind === "Fixed").length,
  removed: bullets.filter((b) => b.kind === "Removed").length,
  prs: prs.length,
  prFeatures: prs.filter((p) => p.kind === "feature").length,
  prFixes: prs.filter((p) => p.kind === "fix").length,
});

const cache = new Map<string, { at: number; value: ReleasesView }>();

export const releasesFor = async (project: Project, force = false): Promise<ReleasesView> => {
  const hit = cache.get(project.id);
  if (hit && !force && Date.now() - hit.at < config.liveCacheMs) return hit.value;

  const changelog = await findChangelog(project.path);
  const versions = changelog ? parseChangelog(await readFile(changelog, "utf8")) : [];
  const unreleased = versions.find((v) => v.version.toLowerCase() === "unreleased");
  const shipped = versions.filter((v) => v.version.toLowerCase() !== "unreleased");
  const last = shipped[0];

  // Per repo: every merged PR, the tag date of each shipped version, and the GitHub base URL.
  // A PR belongs to the first version whose tag was cut at or after its merge; after the latest tag, it is unreleased.
  const repos = (await reposUnder(project.path)).filter((r) => r.label !== "root" && r.label !== "contracts");
  const perRepo = await Promise.all(
    repos.map(async (repo) => {
      const tags = new Map<string, string>();
      for (const v of shipped.slice(0, 7)) {
        const at = await tagDate(repo.path, v.version);
        if (at) tags.set(v.version, at);
      }
      if (!tags.size) return null; // a docs or marketing repo without version tags does not ship
      return { repo, tags, prs: await mergedPrs(repo.label, repo.path), url: await githubUrl(repo.path) };
    }),
  );
  const shipping = perRepo.filter((r): r is NonNullable<typeof r> => r !== null);

  const prsFor = (version: string | null): MergedPr[] =>
    shipping.flatMap(({ tags, prs }) => {
      const ordered = shipped.map((v) => v.version).filter((v) => tags.has(v)); // newest first
      return prs.filter((pr) => {
        const owner = [...ordered].reverse().find((v) => pr.mergedAt <= (tags.get(v) as string)) ?? null;
        return owner === version;
      });
    }).sort((a, b) => a.mergedAt.localeCompare(b.mergedAt));

  const compareFor = (version: string | null): Release["compare"] =>
    shipping.flatMap(({ repo, tags, url }) => {
      if (!url) return [];
      const ordered = shipped.map((v) => v.version).filter((v) => tags.has(v));
      if (version === null) return ordered[0] ? [{ repo: repo.label, url: `${url}/compare/v${ordered[0]}...develop` }] : [];
      const i = ordered.indexOf(version);
      if (i < 0) return [];
      const prev = ordered[i + 1];
      return [{ repo: repo.label, url: prev ? `${url}/compare/v${prev}...v${version}` : `${url}/releases/tag/v${version}` }];
    });

  const nextPrs = prsFor(null);
  const value: ReleasesView = {
    changelog,
    next: unreleased ? { version: "Unreleased", bullets: unreleased.bullets, counts: counts(unreleased.bullets, nextPrs), prs: nextPrs, compare: compareFor(null) } : undefined,
    shipped: shipped.slice(0, 6).map((v) => {
      const prs = prsFor(v.version);
      return { version: v.version, date: v.date, bullets: v.bullets, counts: counts(v.bullets, prs), prs, compare: compareFor(v.version) };
    }),
    fetchedAt: new Date().toISOString(),
  };
  cache.set(project.id, { at: Date.now(), value });
  return value;
};
