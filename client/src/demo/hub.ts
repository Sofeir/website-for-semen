// Замена серверного SSE-хаба: события идут в тот же браузер через EventTarget.
export const demoEvents = new EventTarget();

export function subscribe() {
  return () => {};
}

/** Кто сейчас открыт в этой вкладке: его уведомления показываем сразу, остальным они ждут до входа. */
export const demoViewer: { userId: number | null } = { userId: null };

export function sendTo(userId: number, event: string, data: unknown) {
  demoEvents.dispatchEvent(new CustomEvent(event, { detail: { userId, data } }));
  return demoViewer.userId === userId ? 1 : 0;
}

export function broadcast(event: string, data: unknown) {
  demoEvents.dispatchEvent(new CustomEvent(event, { detail: { userId: null, data } }));
}

export function connectedCount() {
  return 1;
}
