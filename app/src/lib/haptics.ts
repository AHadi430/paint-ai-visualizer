import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

// Small vibrations on the iPhone that make taps feel physical. They do
// nothing in a browser.

const native = Capacitor.isNativePlatform();

export function tapFeedback() {
  if (native) {
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  }
}

export function successFeedback() {
  if (native) {
    Haptics.notification({ type: NotificationType.Success }).catch(() => {});
  }
}
