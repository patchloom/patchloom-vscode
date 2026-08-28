/**
 * Drop a shared status probe and refresh surfaces that cache the CLI path.
 * Callers pass the concrete refresh functions so unit tests can assert order.
 */
export async function refreshAfterPatchloomInputChange(
  clearInflight: () => void,
  refreshStatus: () => Promise<void>,
  refreshMcp: () => Promise<void>
): Promise<void> {
  clearInflight();
  await refreshStatus();
  await refreshMcp();
}
