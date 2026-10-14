import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { NotificationItem } from '@sd/shared';
import { keys, SCOPE_KEYS } from '@/api/queries';
import { useToast } from '@/ui/Toast';

/**
 * Живые обновления через SSE: всплывающее уведомление + обновление списков,
 * когда кто-то другой двигает заявки и закрывает задачи.
 */
export function useServerEvents(enabled: boolean) {
  const qc = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    if (!enabled) return;
    let pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const flush = () => {
      const roots = new Set<string>();
      pending.forEach((scope) => (SCOPE_KEYS[scope] ?? [scope]).forEach((r) => roots.add(r)));
      pending = new Set();
      qc.invalidateQueries({ predicate: (q) => roots.has(String(q.queryKey[0])) });
    };

    const onNotification = (e: Event) => {
      const n = (e as MessageEvent).data as NotificationItem & { toast?: boolean };
      qc.setQueryData<{ items: NotificationItem[]; unread: number }>(keys.notifications, (old) =>
        old ? { items: [n, ...old.items].slice(0, 60), unread: old.unread + 1 } : old,
      );
      if (n.toast !== false) toast.show({ tone: 'info', title: n.title, body: n.body, link: n.link });
    };

    const onChanged = (e: Event) => {
      const { scopes } = (e as MessageEvent).data as { scopes: string[] };
      scopes.forEach((s) => pending.add(s));
      clearTimeout(timer);
      timer = setTimeout(flush, 300);
    };

    let close = () => {};
    if (import.meta.env.VITE_DEMO) {
      // Демо: события приходят из серверного кода в этой же вкладке.
      let off = false;
      import('@/demo/runtime').then(({ demoEvents }) => {
        if (off) return;
        const me = qc.getQueryData<{ user?: { id: number } }>(keys.me)?.user?.id;
        const wrap = (fn: (e: Event) => void) => (e: Event) => {
          const { userId, data } = (e as CustomEvent).detail;
          if (userId === null || userId === me) fn({ data } as MessageEvent);
        };
        const n = wrap(onNotification);
        const c = wrap(onChanged);
        demoEvents.addEventListener('notification', n);
        demoEvents.addEventListener('changed', c);
        close = () => {
          demoEvents.removeEventListener('notification', n);
          demoEvents.removeEventListener('changed', c);
        };
      });
      return () => {
        off = true;
        clearTimeout(timer);
        close();
      };
    }
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/events');
    es.addEventListener('notification', (e) =>
      onNotification({ data: JSON.parse((e as MessageEvent).data) } as unknown as MessageEvent),
    );
    es.addEventListener('changed', (e) => onChanged({ data: JSON.parse((e as MessageEvent).data) } as unknown as MessageEvent));
    close = () => es.close();

    return () => {
      clearTimeout(timer);
      close();
    };
  }, [enabled, qc, toast]);
}
