import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Contact } from '@sd/shared';
import { api, ApiError } from '@/api/http';
import { useInvalidate } from '@/api/queries';
import { useToast } from '@/ui/Toast';
import { ContactPicker } from './ContactPicker';

/** Пользователь техники в паспорте: выбирается из людей организации, меняется, когда техника переезжает. */
export function DeviceUser({ deviceId, clientId }: { deviceId: number; clientId: number }) {
  const qc = useQueryClient();
  const inv = useInvalidate();
  const toast = useToast();
  const key = ['deviceUser', deviceId];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<{ contact: Contact | null }>(`/devices/${deviceId}/user`) });

  const change = async (c: Contact | null) => {
    try {
      await api.put(`/devices/${deviceId}/user`, { contactId: c?.id ?? null });
      qc.setQueryData(key, { contact: c });
      inv('clients', 'client', 'orders', 'order');
      toast.success(c ? 'Пользователь записан' : 'Пользователь убран');
    } catch (e) {
      toast.error('Не получилось', (e as ApiError).message);
    }
  };

  if (q.isLoading) return <p className="muted">Загружаем…</p>;
  return <ContactPicker clientId={clientId} value={q.data?.contact ?? null} onChange={change} />;
}
