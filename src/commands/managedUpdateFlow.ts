export type ManagedUpdatePhase = "check" | "confirm" | "install";

/**
 * Check finishes before the confirm question. Install runs only after confirm
 * returns true, so a progress toast is not held open over the question.
 */
export async function runCheckedInstall<T>(input: {
  readonly check: () => PromiseLike<T>;
  readonly confirm: (value: T) => PromiseLike<boolean>;
  readonly install: (value: T) => PromiseLike<void>;
  readonly onPhase?: (phase: ManagedUpdatePhase) => void;
}): Promise<void> {
  input.onPhase?.("check");
  const value = await input.check();
  input.onPhase?.("confirm");
  const accepted = await input.confirm(value);
  if (!accepted) {
    return;
  }
  input.onPhase?.("install");
  await input.install(value);
}
