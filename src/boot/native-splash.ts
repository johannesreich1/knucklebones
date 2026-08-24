// The native splash is a runtime capability, not a web dependency. Reading the
// global Capacitor bridge keeps standalone/PWA/widget bundles free of plugin
// imports; on the web the scheduled task is simply a no-op.

export const NATIVE_SPLASH_FADE_MS = 200;

interface SplashScreenBridge {
  hide(options: { fadeOutDuration: number }): Promise<void>;
}

interface CapacitorSplashBridge {
  Plugins?: { SplashScreen?: SplashScreenBridge };
}

type ReadSplash = () => SplashScreenBridge | undefined;
type ScheduleTask = (task: () => void) => void;

const globalSplash = (): SplashScreenBridge | undefined =>
  (globalThis as typeof globalThis & { Capacitor?: CapacitorSplashBridge })
    .Capacitor?.Plugins?.SplashScreen;

const nextTask: ScheduleTask = (task) => { setTimeout(task, 0); };

export function createNativeSplashRelease(
  readSplash: ReadSplash = globalSplash,
  scheduleTask: ScheduleTask = nextTask,
): () => void {
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    scheduleTask(() => {
      const splash = readSplash();
      if (!splash) return;
      try {
        void splash.hide({ fadeOutDuration: NATIVE_SPLASH_FADE_MS }).catch(() => undefined);
      } catch {
        // A malformed bridge must not trap the player behind the launch screen.
      }
    });
  };
}

const scheduleNativeSplashHide = createNativeSplashRelease();

/* The callback stays synchronous: Home is composed before a single next-task
   hide, while a thrown boot/hook error still arms the native watchdog release. */
export function releaseNativeSplashAfter(
  compose: () => void,
  release: () => void = scheduleNativeSplashHide,
): void {
  try {
    compose();
  } finally {
    release();
  }
}
