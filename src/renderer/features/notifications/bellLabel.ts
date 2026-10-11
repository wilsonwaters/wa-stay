/** The bell's accessible name: "Notifications, 23 unread", or "Notifications". */
export function bellLabel(unread: number): string {
  return unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';
}

/** The bell's badge, capped at "99+"; null when nothing is unread. */
export function badgeText(unread: number): string | null {
  if (!(unread > 0)) return null;
  return unread > 99 ? '99+' : String(unread);
}
