import { EmulatorService } from "../emulator/EmulatorService";

export async function startEmulatorCommand(): Promise<void> {
  await EmulatorService.getInstance().startEmulator();
}

export async function stopEmulatorCommand(): Promise<void> {
  await EmulatorService.getInstance().stopEmulator();
}

export async function restartEmulatorCommand(): Promise<void> {
  await EmulatorService.getInstance().restartEmulator();
}

export async function openEmulatorUiCommand(): Promise<void> {
  await EmulatorService.getInstance().openEmulatorUi();
}

export async function discoverEmulatorsCommand(): Promise<void> {
  await EmulatorService.getInstance().discoverAndConnect(true);
}

export async function emulatorStatusMenuCommand(): Promise<void> {
  await EmulatorService.getInstance().showStatusMenu();
}
