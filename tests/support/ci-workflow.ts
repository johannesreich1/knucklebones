const jobSource = (workflow: string, jobName: string): string => {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  if (start < 0) return '';
  const end = lines.findIndex((line, index) =>
    index > start && /^  [a-zA-Z0-9_-]+:\s*$/.test(line));
  return lines.slice(start, end < 0 ? lines.length : end).join('\n');
};

/** Keep every Node-consuming job self-contained and on the repository pin. */
export function nodeJobsUsePinnedNode(workflow: string): boolean {
  if (/node-version:\s*['"]?\d/.test(workflow)) return false;
  const jobNames = [...workflow.matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gm)]
    .map((match) => match[1]);
  const nodeJobs = jobNames
    .map((name) => jobSource(workflow, name))
    .filter((job) => /^\s+- run:\s*(?:node|npm|npx)\b/m.test(job));
  return nodeJobs.length > 0 && nodeJobs.every((job) => {
    const setupAt = job.search(/uses:\s*actions\/setup-node@v5/);
    const pinAt = job.search(/node-version-file:\s*\.nvmrc\b/);
    const firstNodeCommandAt = job.search(/^\s+- run:\s*(?:node|npm|npx)\b/m);
    return setupAt >= 0 && pinAt > setupAt && firstNodeCommandAt > pinAt;
  });
}
