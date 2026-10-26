import { useEffect, useId, useState } from 'react';
import { Plus } from 'lucide-react';
import { inspectionKindOf } from '@sd/shared';
import { api, ApiError } from '@/api/http';
import { useDictionaries, useInvalidate } from '@/api/queries';
import { Button } from '@/ui/Button';
import { ErrorBox } from '@/ui/Display';
import { Field, Input, Select, formStyles } from '@/ui/Form';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';

/**
 * Добавить клиенту компьютер или принтер в список, по которому идёт выезд. Номер (как на наклейке) и отдел
 * нужны, чтобы инженер на месте нашёл нужное устройство: «Столовая 3, ПК-2».
 */
export function DeviceAddSheet({
  clientId,
  locations,
  open,
  onClose,
}: {
  clientId: number;
  /** Отделы, которые у клиента уже есть: подсказки при вводе. */
  locations: string[];
  open: boolean;
  onClose: () => void;
}) {
  const dict = useDictionaries();
  const inv = useInvalidate();
  const toast = useToast();
  const listId = useId();
  const types = (dict.data?.deviceTypes ?? []).filter((t) => t.isActive && inspectionKindOf(t.name));
  const [typeId, setTypeId] = useState('');
  const [model, setModel] = useState('');
  const [inventoryNo, setInventoryNo] = useState('');
  const [location, setLocation] = useState('');
  const [host, setHost] = useState('');
  const [serial, setSerial] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setModel('');
    setInventoryNo('');
    setHost('');
    setSerial('');
    setError('');
    // отдел остаётся от прошлого ввода: обычно добавляют несколько компьютеров подряд
  }, [open]);

  const chosen = types.find((t) => String(t.id) === typeId) ?? types[0];
  const printer = chosen ? inspectionKindOf(chosen.name) === 'printer' : false;

  const save = async (again: boolean) => {
    setError('');
    if (!chosen) return setError('Выберите тип техники');
    setBusy(true);
    try {
      await api.post(`/clients/${clientId}/devices`, {
        deviceTypeId: chosen.id,
        modelText: model.trim() || null,
        inventoryNo: inventoryNo.trim() || null,
        location: location.trim() || null,
        hostName: printer ? null : host.trim() || null,
        serial: serial.trim() || null,
      });
      inv('clients', 'client', 'clientDevices', 'visitDevices', 'clientInspections');
      toast.success('Техника добавлена', [inventoryNo.trim(), location.trim()].filter(Boolean).join(', ') || undefined);
      if (again) {
        setModel('');
        setInventoryNo('');
        setHost('');
        setSerial('');
      } else onClose();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Добавить технику"
      subtitle="Компьютер, ноутбук, принтер или МФУ клиента"
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="secondary" loading={busy} onClick={() => save(true)}>
            Сохранить и ещё одну
          </Button>
          <Button loading={busy} onClick={() => save(false)} icon={<Plus size={18} aria-hidden />}>
            Добавить
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <ErrorBox>{error}</ErrorBox>}
        <Field label="Тип">
          <Select value={chosen ? String(chosen.id) : ''} onChange={(e) => setTypeId(e.target.value)}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className={formStyles.grid2}>
          <Field label="Номер" optional hint="Как на наклейке: ПК-2, МФУ-1">
            <Input value={inventoryNo} onChange={(e) => setInventoryNo(e.target.value)} maxLength={60} autoComplete="off" />
          </Field>
          <Field label="Отдел или место" optional hint="Например: Столовая 3, бухгалтерия">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} list={listId} maxLength={200} autoComplete="off" />
          </Field>
        </div>
        <datalist id={listId}>
          {locations.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
        <Field label="Модель" optional>
          <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={printer ? 'Kyocera M2040dn' : 'Офисный ПК'} maxLength={150} />
        </Field>
        <div className={formStyles.grid2}>
          {!printer && (
            <Field label="Имя ПК" optional>
              <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="KASSA-1" maxLength={100} />
            </Field>
          )}
          <Field label="Серийный номер" optional>
            <Input value={serial} onChange={(e) => setSerial(e.target.value)} maxLength={100} />
          </Field>
        </div>
      </div>
    </Sheet>
  );
}
