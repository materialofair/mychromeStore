export interface ViewState {
  latestVersion: string;
  extensionId: string;
  folderName: string | null;
  diskVersion: string | null;
  runtimeVersion: string | null;
  phase:
    | "idle"
    | "checking"
    | "writing"
    | "reloading"
    | "success"
    | "error"
    | "manual";
  message: string;
  busy: boolean;
  progress: number;
  hasBackup: boolean;
  recoveryNeeded: boolean;
  supported: boolean;
}
export interface Actions {
  bind(): Promise<void>;
  update(): Promise<void>;
  refresh(): Promise<void>;
  restore(): Promise<void>;
  downloadBackup(): Promise<void>;
}
