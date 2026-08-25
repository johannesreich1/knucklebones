const jobSource = (workflow: string, jobName: string): string => {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  if (start < 0) return '';
  const end = lines.findIndex((line, index) =>
    index > start && /^  [a-zA-Z0-9_-]+:\s*$/.test(line));
  return lines.slice(start, end < 0 ? lines.length : end).join('\n');
};

const runBlocks = (job: string): Array<{ at: number; command: string }> => {
  const lines = job.split('\n');
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }

  const blocks: Array<{ at: number; command: string }> = [];
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index]!.match(/^(\s*)(?:-\s+)?run:\s*(.*)$/);
    if (!match) continue;
    const at = offsets[index]!;
    const indentation = match[1]!.length;
    const value = match[2]!.trim();
    if (!/^[|>][+-]?$/.test(value)) {
      blocks.push({ at, command: value });
      continue;
    }

    const body: string[] = [];
    for (let bodyIndex = index + 1; bodyIndex < lines.length; bodyIndex++) {
      const bodyLine = lines[bodyIndex]!;
      if (bodyLine.trim() && (bodyLine.match(/^\s*/)?.[0].length ?? 0) <= indentation) break;
      body.push(bodyLine);
      index = bodyIndex;
    }
    blocks.push({ at, command: body.join('\n') });
  }
  return blocks;
};

const isNodeCommand = (command: string): boolean => {
  const withoutComments = command.split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, '$1'))
    .join('\n');
  return /(?:^|[\n;&|])\s*(?:(?:env|command|exec)\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*(?:node|npm|npx|vite|cap|capacitor)\b/m
    .test(withoutComments);
};

/** Keep every Node-consuming job self-contained and on the repository pin. */
export function nodeJobsUsePinnedNode(workflow: string): boolean {
  if (/node-version:\s*['"]?\d/.test(workflow)) return false;
  const jobNames = [...workflow.matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gm)]
    .map((match) => match[1]);
  const nodeJobs = jobNames
    .map((name) => jobSource(workflow, name))
    .map((job) => ({ job, commands: runBlocks(job).filter(({ command }) => isNodeCommand(command)) }))
    .filter(({ commands }) => commands.length > 0);
  return nodeJobs.length > 0 && nodeJobs.every((job) => {
    const setupAt = job.job.search(/uses:\s*actions\/setup-node@v5/);
    const pinAt = job.job.search(/node-version-file:\s*\.nvmrc\b/);
    const firstNodeCommandAt = job.commands[0]!.at;
    return setupAt >= 0 && pinAt > setupAt && firstNodeCommandAt > pinAt;
  });
}
