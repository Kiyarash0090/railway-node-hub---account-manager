/**
 * Parses a Dockerfile to extract Railway-relevant configuration:
 * - Start Command (from CMD/ENTRYPOINT)
 * - Build Command (not directly in Dockerfile, but we can detect common patterns)
 * - Root Directory (from WORKDIR)
 * - Healthcheck path (from HEALTHCHECK)
 */

export interface DockerfileConfig {
  startCommand?: string;
  buildCommand?: string;
  rootDirectory?: string;
  healthcheckPath?: string;
  /** The raw Dockerfile content for debugging */
  rawContent?: string;
}

/**
 * Parses a Dockerfile string and extracts configuration relevant to Railway.
 * Railway uses these settings when building/deploying from source.
 */
export function parseDockerfile(content: string): DockerfileConfig {
  const lines = content.split('\n');
  const config: DockerfileConfig = {
    rawContent: content,
  };

  let currentWorkdir = '';
  let cmdParts: string[] = [];
  let entrypointParts: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    // Skip comments and empty lines
    if (!line || line.startsWith('#')) continue;

    // Handle line continuations (backslash at end)
    while (line.endsWith('\\') && i + 1 < lines.length) {
      line = line.slice(0, -1).trim() + ' ' + lines[++i].trim();
    }

    const upperLine = line.toUpperCase();

    // WORKDIR - sets the working directory (Root Directory for Railway)
    if (upperLine.startsWith('WORKDIR ')) {
      const workdir = line.slice(8).trim();
      // Remove quotes if present
      currentWorkdir = workdir.replace(/^["']|["']$/g, '');
      config.rootDirectory = currentWorkdir;
      continue;
    }

    // CMD - default command to run
    if (upperLine.startsWith('CMD ')) {
      const cmdContent = line.slice(4).trim();
      cmdParts = parseDockerCommand(cmdContent);
      continue;
    }

    // ENTRYPOINT - executable to run
    if (upperLine.startsWith('ENTRYPOINT ')) {
      const entrypointContent = line.slice(11).trim();
      entrypointParts = parseDockerCommand(entrypointContent);
      continue;
    }

    // HEALTHCHECK - health check configuration
    if (upperLine.startsWith('HEALTHCHECK ')) {
      const healthcheckContent = line.slice(12).trim();
      const healthPath = extractHealthcheckPath(healthcheckContent);
      if (healthPath) {
        config.healthcheckPath = healthPath;
      }
      continue;
    }

    // ARG and ENV might give hints about build process, but not directly used
  }

  // Determine start command: CMD takes precedence, but ENTRYPOINT + CMD combines
  // For Railway's startCommand, we want the final command that runs
  if (entrypointParts.length > 0 && cmdParts.length > 0) {
    // ENTRYPOINT ["executable"] CMD ["param1", "param2"] -> combined
    config.startCommand = [...entrypointParts, ...cmdParts].join(' ');
  } else if (entrypointParts.length > 0) {
    // Only ENTRYPOINT
    config.startCommand = entrypointParts.join(' ');
  } else if (cmdParts.length > 0) {
    // Only CMD
    config.startCommand = cmdParts.join(' ');
  }

  // For build command, we can't really extract from Dockerfile directly
  // but we can detect if it's a multi-stage build or has build-time commands
  // This is informational only - Railway will use its own build detection
  config.buildCommand = detectBuildCommand(lines);

  return config;
}

/**
 * Parses a Docker CMD/ENTRYPOINT command in either exec form or shell form.
 * Exec form: CMD ["executable", "param1", "param2"]
 * Shell form: CMD executable param1 param2
 */
function parseDockerCommand(content: string): string[] {
  // Try exec form (JSON array)
  const execMatch = content.match(/^\[(.*)\]$/s);
  if (execMatch) {
    try {
      // Parse as JSON array
      const parsed = JSON.parse(`[${execMatch[1]}]`);
      if (Array.isArray(parsed)) {
        return parsed.map(String).filter(Boolean);
      }
    } catch {
      // Fall through to shell form parsing
    }
  }

  // Shell form - split by spaces but respect quotes
  return parseShellCommand(content);
}

/**
 * Parses a shell-style command respecting quotes.
 */
function parseShellCommand(cmd: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];

    if ((ch === '"' || ch === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = ch;
    } else if (ch === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = '';
    } else if (ch === ' ' && !inQuotes) {
      if (current) {
        result.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }

  if (current) result.push(current);
  return result;
}

/**
 * Extracts the HTTP path from a HEALTHCHECK command.
 * HEALTHCHECK CMD curl -f http://localhost:3000/health || exit 1
 */
function extractHealthcheckPath(healthcheckContent: string): string | undefined {
  // Look for HTTP URLs in the command
  const urlMatch = healthcheckContent.match(/https?:\/\/[^/\s]+(:(\d+))?(\/[^\s]*)?/);
  if (urlMatch) {
    const path = urlMatch[3] || '/';
    return path;
  }

  // Also check for just a path like /health
  const pathMatch = healthcheckContent.match(/(\/[a-zA-Z0-9_\-\/]+)/);
  if (pathMatch) {
    return pathMatch[1];
  }

  return undefined;
}

/**
 * Attempts to detect a build command from Dockerfile content.
 * This is heuristic - Railway will use its own builders (Nixpacks, etc.)
 */
function detectBuildCommand(lines: string[]): string | undefined {
  // Look for common build patterns in RUN commands
  const runCommands = lines
    .map(l => l.trim())
    .filter(l => l.toUpperCase().startsWith('RUN '));

  // Common build commands
  const buildPatterns = [
    /npm\s+run\s+build/i,
    /yarn\s+build/i,
    /pnpm\s+run\s+build/i,
    /make\s+build/i,
    /gradle\s+build/i,
    /mvn\s+package/i,
    /go\s+build/i,
    /cargo\s+build/i,
    /dotnet\s+build/i,
    /pip\s+install/i,
    /composer\s+install/i,
  ];

  for (const runCmd of runCommands) {
    for (const pattern of buildPatterns) {
      if (pattern.test(runCmd)) {
        // Extract the actual command part
        const cmd = runCmd.slice(4).trim();
        return cmd;
      }
    }
  }

  return undefined;
}

/**
 * Checks if a Dockerfile exists in the source entries and parses it.
 */
export function findAndParseDockerfile(entries: { path: string; data: Uint8Array | null; directory?: boolean }[]): DockerfileConfig | null {
  const dockerfileEntry = entries.find(e =>
    !e.directory && e.data &&
    (e.path.toLowerCase() === 'dockerfile' ||
     e.path.toLowerCase().endsWith('/dockerfile') ||
     e.path.toLowerCase().match(/dockerfile\.[a-z]+$/i))
  );

  if (!dockerfileEntry || !dockerfileEntry.data) {
    return null;
  }

  const content = new TextDecoder().decode(dockerfileEntry.data);
  return parseDockerfile(content);
}