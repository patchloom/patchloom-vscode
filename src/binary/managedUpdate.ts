import { comparePatchloomVersions, parsePatchloomVersion, type PatchloomStatus } from "./patchloom.js";

export type ManagedUpdateDecision =
  | { readonly kind: "current"; readonly version: string }
  | { readonly kind: "available"; readonly from?: string; readonly to: string };

/** Compare latest GitHub release to the managed binary, not PATH or settings. */
export function decideManagedUpdate(
  latestVersion: string,
  managedVersion: string | undefined
): ManagedUpdateDecision {
  if (managedVersion !== undefined && comparePatchloomVersions(latestVersion, managedVersion) <= 0) {
    return { kind: "current", version: managedVersion };
  }
  if (managedVersion !== undefined) {
    return { kind: "available", from: managedVersion, to: latestVersion };
  }
  return { kind: "available", to: latestVersion };
}

export async function resolveManagedBinaryVersion(
  status: Pick<PatchloomStatus, "source" | "detectedVersion" | "managedInstall">,
  getVersion: (binaryPath: string) => Promise<string | undefined>
): Promise<string | undefined> {
  if (status.source === "managed") {
    return status.detectedVersion;
  }
  const managedPath = status.managedInstall?.exists ? status.managedInstall.binaryPath : undefined;
  if (managedPath === undefined) {
    return undefined;
  }
  try {
    const versionText = await getVersion(managedPath);
    return parsePatchloomVersion(versionText);
  } catch {
    return undefined;
  }
}
