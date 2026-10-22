export interface StatusPresentationInput {
  readonly extensionEnabled: boolean;
  readonly statusBarEnabled: boolean;
  readonly cliReady: boolean;
  readonly managedInstallExists: boolean;
  readonly projectInitialized: boolean;
}

export interface StatusContextKeys {
  readonly cliAvailable: boolean;
  readonly managedInstallExists: boolean;
  readonly projectInitialized: boolean;
}

export interface StatusPresentation {
  readonly showStatusBar: boolean;
  readonly runBackgroundChecks: boolean;
  readonly context: StatusContextKeys;
  readonly statusBarCommand: "patchloom.showStatus";
}

/**
 * Context keys are set whenever the CLI check finishes, including when the
 * status bar is hidden and when the extension is disabled. Palette `when`
 * clauses treat an unset key as false.
 */
export function decideStatusPresentation(input: StatusPresentationInput): StatusPresentation {
  return {
    showStatusBar: input.extensionEnabled && input.statusBarEnabled,
    runBackgroundChecks: input.extensionEnabled,
    context: {
      cliAvailable: input.cliReady,
      managedInstallExists: input.managedInstallExists,
      projectInitialized: input.projectInitialized
    },
    statusBarCommand: "patchloom.showStatus"
  };
}

export function shouldRunBackgroundChecks(extensionEnabled: boolean): boolean {
  return decideStatusPresentation({
    extensionEnabled,
    statusBarEnabled: true,
    cliReady: false,
    managedInstallExists: false,
    projectInitialized: false
  }).runBackgroundChecks;
}
