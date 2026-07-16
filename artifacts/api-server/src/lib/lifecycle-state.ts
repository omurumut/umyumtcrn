type ApplicationLifecycleState = {
  isReady: boolean;
  isShuttingDown: boolean;
};

const state: ApplicationLifecycleState = {
  isReady: false,
  isShuttingDown: false,
};

export function markApplicationReady(): void {
  if (!state.isShuttingDown) state.isReady = true;
}

export function beginApplicationShutdown(): boolean {
  if (state.isShuttingDown) return false;
  state.isShuttingDown = true;
  state.isReady = false;
  return true;
}

export function applicationLifecycleState(): Readonly<ApplicationLifecycleState> {
  return state;
}
