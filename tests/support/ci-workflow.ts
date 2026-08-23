const jobSource = (workflow: string, jobName: string): string => {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  if (start < 0) return '';
  const end = lines.findIndex((line, index) =>
    index > start && /^  [a-zA-Z0-9_-]+:\s*$/.test(line));
  return lines.slice(start, end < 0 ? lines.length : end).join('\n');
};

/** Keep the database job self-contained and on the repository's Node pin. */
export function databaseJobUsesPinnedNode(workflow: string): boolean {
  if (/node-version:\s*['"]?\d/.test(workflow)) return false;
  const database = jobSource(workflow, 'database');
  const setupAt = database.search(/uses:\s*actions\/setup-node@v5/);
  const pinAt = database.search(/node-version-file:\s*\.nvmrc\b/);
  const startAt = database.search(/run:\s*npm run db:start\b/);
  return setupAt >= 0 && pinAt > setupAt && startAt > pinAt;
}
