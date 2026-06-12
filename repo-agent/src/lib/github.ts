const GITHUB_API = "https://api.github.com";

interface GitHubRepo {
  name: string;
  full_name: string;
  owner: { login: string };
  default_branch: string;
  fork: boolean;
  archived: boolean;
  disabled: boolean;
}

interface GitHubTreeItem {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
}

interface GitHubTreeResponse {
  sha: string;
  tree: GitHubTreeItem[];
  truncated: boolean;
}

interface GitHubRef {
  ref: string;
  object: { sha: string; type: string };
}

interface GitHubCommitObject {
  sha: string;
  tree: { sha: string };
}

interface GitHubBlobResponse {
  content: string;
  encoding: string;
  sha: string;
  size: number;
}

interface GitHubNewTreeResponse {
  sha: string;
}

interface GitHubNewCommitResponse {
  sha: string;
}

export interface CommitResult {
  sha: string;
  url: string;
}

const SKIP_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".webp",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".zip", ".tar", ".gz", ".bz2",
  ".pdf", ".doc", ".docx",
  ".mp3", ".mp4", ".mov", ".avi",
  ".exe", ".dll", ".so", ".dylib",
  ".pyc", ".class", ".o",
  ".lock",
]);

const SKIP_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "composer.lock",
  "Gemfile.lock",
  "Cargo.lock",
  "poetry.lock",
  ".env",
  ".env.local",
  ".env.production",
  ".DS_Store",
  "Thumbs.db",
]);

const MAX_FILE_SIZE = 100_000;

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function ghFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: { ...headers(token), ...init?.headers },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status} on ${path}: ${body}`);
  }

  return res.json() as Promise<T>;
}

export async function verifyToken(token: string): Promise<string> {
  const user = await ghFetch<{ login: string }>(token, "/user");
  return user.login;
}

export async function listRepos(token: string): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  let page = 1;

  while (true) {
    const batch = await ghFetch<GitHubRepo[]>(
      token,
      `/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner`
    );

    if (batch.length === 0) break;

    for (const repo of batch) {
      if (!repo.fork && !repo.archived && !repo.disabled) {
        repos.push(repo);
      }
    }

    if (batch.length < 100) break;
    page++;
  }

  return repos;
}

export async function fetchTree(
  token: string,
  owner: string,
  repo: string,
  branch: string = "main"
): Promise<{ sha: string; files: GitHubTreeItem[] }> {
  const tree = await ghFetch<GitHubTreeResponse>(
    token,
    `/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`
  );

  const files = tree.tree.filter((item) => {
    if (item.type !== "blob") return false;
    if (item.size && item.size > MAX_FILE_SIZE) return false;

    const name = item.path.split("/").pop() || "";
    if (SKIP_FILES.has(name)) return false;

    const ext = name.includes(".") ? "." + name.split(".").pop()!.toLowerCase() : "";
    if (SKIP_EXTENSIONS.has(ext)) return false;

    const parts = item.path.split("/");
    for (const part of parts) {
      if (part.startsWith(".") && part !== ".") return false;
      if (part === "node_modules") return false;
      if (part === "vendor") return false;
      if (part === "dist") return false;
      if (part === "build") return false;
      if (part === "__pycache__") return false;
    }

    return true;
  });

  return { sha: tree.sha, files };
}

export async function fetchFileContent(
  token: string,
  owner: string,
  repo: string,
  fileSha: string
): Promise<string> {
  const blob = await ghFetch<GitHubBlobResponse>(
    token,
    `/repos/${owner}/${repo}/git/blobs/${fileSha}`
  );

  if (blob.encoding === "base64") {
    return Buffer.from(blob.content, "base64").toString("utf-8");
  }

  return blob.content;
}

export async function createCommit(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  filePath: string,
  newContent: string,
  commitMessage: string
): Promise<CommitResult> {
  const ref = await ghFetch<GitHubRef>(
    token,
    `/repos/${owner}/${repo}/git/ref/heads/${branch}`
  );
  const latestSha = ref.object.sha;

  const parentCommit = await ghFetch<GitHubCommitObject>(
    token,
    `/repos/${owner}/${repo}/git/commits/${latestSha}`
  );

  const blob = await ghFetch<{ sha: string }>(
    token,
    `/repos/${owner}/${repo}/git/blobs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: Buffer.from(newContent, "utf-8").toString("base64"),
        encoding: "base64",
      }),
    }
  );

  const newTree = await ghFetch<GitHubNewTreeResponse>(
    token,
    `/repos/${owner}/${repo}/git/trees`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base_tree: parentCommit.tree.sha,
        tree: [
          {
            path: filePath,
            mode: "100644",
            type: "blob",
            sha: blob.sha,
          },
        ],
      }),
    }
  );

  const newCommit = await ghFetch<GitHubNewCommitResponse>(
    token,
    `/repos/${owner}/${repo}/git/commits`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: commitMessage,
        tree: newTree.sha,
        parents: [latestSha],
      }),
    }
  );

  await ghFetch<GitHubRef>(
    token,
    `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha: newCommit.sha }),
    }
  );

  return {
    sha: newCommit.sha,
    url: `https://github.com/${owner}/${repo}/commit/${newCommit.sha}`,
  };
}

export function applyUnifiedDiff(original: string, diff: string): string {
  const lines = original.split("\n");
  const diffLines = diff.split("\n");
  const hunks: { start: number; remove: string[]; add: string[] }[] = [];

  let i = 0;
  while (i < diffLines.length) {
    const line = diffLines[i];
    const match = line.match(/^@@\s*-(\d+)(?:,\d+)?\s*\+\d+(?:,\d+)?\s*@@/);
    if (match) {
      const start = parseInt(match[1], 10);
      const remove: string[] = [];
      const add: string[] = [];
      i++;
      while (i < diffLines.length && !diffLines[i].startsWith("@@")) {
        const dl = diffLines[i];
        if (dl.startsWith("-")) {
          remove.push(dl.slice(1));
        } else if (dl.startsWith("+")) {
          add.push(dl.slice(1));
        }
        i++;
      }
      hunks.push({ start, remove, add });
    } else {
      i++;
    }
  }

  hunks.sort((a, b) => b.start - a.start);

  for (const hunk of hunks) {
    const idx = hunk.start - 1;
    lines.splice(idx, hunk.remove.length, ...hunk.add);
  }

  return lines.join("\n");
}
