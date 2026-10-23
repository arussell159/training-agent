import { confirmOnDesktop } from "@/components/desktop-confirm";

// Compatibility name for existing callers. One shared accessible dialog owns
// confirmations at every width; opening it never waits for a feature runtime.
export function confirmWithFramework7(title: string, message: string) {
  return confirmOnDesktop(title, message);
}
