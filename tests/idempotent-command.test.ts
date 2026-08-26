import { recoverIdempotentCommand } from '../src/online/idempotent-command.ts';

const problems: string[] = [];
const check = (condition: boolean, message: string, detail?: unknown): void => {
  if (!condition) problems.push(`${message} :: ${JSON.stringify(detail)}`);
};

/* Aim, cast, placement, and private selection all cross the same lost-response
   boundary. In every case an unchanged first read must keep the UI frozen and
   every replay must carry the original command id until the delayed commit is
   observed. */
for (const intent of ['aim', 'cast', 'place', 'select'] as const) {
  const commandId = `command:${intent}`;
  const sent: string[] = [commandId];
  let observed = false;
  let observeCalls = 0;
  let inputFrozen = true;
  const result = await recoverIdempotentCommand<{ committed: boolean }>(
    { status: 0, data: null },
    {
      owns: () => true,
      uncertain: (response) => !response || response.status === 0,
      observe: async () => {
        observeCalls++;
        if (!observed) check(inputFrozen,
          `${intent} input reopened after an unchanged authoritative read`);
        return observed;
      },
      replay: async () => {
        sent.push(commandId);
        observed = true; // the original delayed command commits without a response
        return { status: 0, data: null };
      },
      pause: async () => undefined,
    },
  );
  inputFrozen = false;
  check(result.kind === 'observed' && observeCalls === 2
      && sent.length === 2 && new Set(sent).size === 1,
  `${intent} recovery changed command id or accepted an unchanged read`,
  { result, observeCalls, sent });
}

let definitiveReplays = 0;
const rejected = await recoverIdempotentCommand(
  { status: 0, data: null },
  {
    owns: () => true,
    uncertain: (response) => !response || response.status === 0 || response.status >= 500,
    observe: async () => false,
    replay: async () => { definitiveReplays++; return { status: 409, data: null }; },
    pause: async () => undefined,
  },
);
check(rejected.kind === 'response' && rejected.response.status === 409
    && definitiveReplays === 1,
  'a definitive command rejection was replayed as transport uncertainty', rejected);

console.log(JSON.stringify({ problems }, null, 2));
if (problems.length) process.exitCode = 1;
