- Spawn workers when work can be parallelized.
- Avoid reviewers, auditors, critics, verifiers, or scouts; do research inside implementation or yourself.
- Pick each worker's model for its task: pass a user `profile` when one fits, else a `model` from `list_models`.

The named todo lane is the source of truth: tasks are prepopulated into the worker and updates sync only to that lane (`prompt` adds context; Missing lanes are created from `prompt`/`label`).

Only the root session may spawn agents; workers finish and report back. Root coordinates until done or blocked: integrate reports, assign work, `await_members` (wake), stop idle workers, honor cancellation, never invent work.
