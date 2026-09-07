'use client';

export const FOLLOW_CHANGED = 'velvet:follow-changed';
export const NOTIFICATIONS_CHANGED = 'velvet:notifications-changed';

export function announceFollowChange(): void {
  window.dispatchEvent(new Event(FOLLOW_CHANGED));
}

export function announceNotificationsChange(): void {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
}

export function onFollowChange(handler: () => void): () => void {
  window.addEventListener(FOLLOW_CHANGED, handler);
  return () => window.removeEventListener(FOLLOW_CHANGED, handler);
}

export function onNotificationsChange(handler: () => void): () => void {
  window.addEventListener(NOTIFICATIONS_CHANGED, handler);
  return () => window.removeEventListener(NOTIFICATIONS_CHANGED, handler);
}
