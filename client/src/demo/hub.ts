// Замена серверного SSE-хаба: события идут в тот же браузер через EventTarget.
export const demoEvents = new EventTarget();

export function subscribe() {
  return () => {};
}

export function sendTo(userId: number, event: string, data: unknown) {
  demoEvents.dispatchEvent(new CustomEvent(event, { detail: { userId, data } }));
}

export function broadcast(event: string, data: unknown) {
  demoEvents.dispatchEvent(new CustomEvent(event, { detail: { userId: null, data } }));
}

export function connectedCount() {
  return 1;
}
