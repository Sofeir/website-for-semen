import { useMemo, useState } from 'react';
import { Check, Pencil, Plus, X } from 'lucide-react';
import { STAGE_COLORS, formatMoney, type DictItem, type DictionaryName } from '@sd/shared';
import { api, ApiError } from '@/api/http';
import { useDictionaries, useInvalidate } from '@/api/queries';
import { Button, IconButton, cx } from '@/ui/Button';
import { Pill } from '@/ui/Display';
import { Checkbox, Input, Select } from '@/ui/Form';
import { useToast } from '@/ui/Toast';
import s from './Settings.module.css';

const COLOR_LABELS: Record<string, string> = {
  sky: 'Голубой',
  violet: 'Фиолетовый',
  amber: 'Янтарный',
  blue: 'Синий',
  teal: 'Бирюзовый',
  slate: 'Серый',
};

export interface DictConfig {
  name: DictionaryName;
  title: string;
  hint?: string;
  parent?: { label: string; options: DictItem[]; required?: boolean; anyLabel?: string };
  price?: boolean;
  months?: boolean;
  stage?: boolean;
}

interface Draft {
  name: string;
  parentId: string;
  price: string;
  priceFrom: boolean;
  months: string;
  isDefault: boolean;
  color: string;
  slaHours: string;
  sort: string;
}

const toDraft = (it?: DictItem): Draft => ({
  name: it?.name ?? '',
  parentId: it?.parentId ? String(it.parentId) : '',
  price: it?.price != null ? String(it.price) : '',
  priceFrom: it?.priceFrom ?? false,
  months: it?.months != null ? String(it.months) : '',
  isDefault: it?.isDefault ?? false,
  color: it?.color ?? 'blue',
  slaHours: it?.slaHours != null ? String(it.slaHours) : '24',
  sort: it?.sort != null ? String(it.sort) : '',
});

/** Универсальный редактор справочника: добавить, переименовать, скрыть. Удаления нет, чтобы не ломать историю. */
export function DictionaryEditor({ config, items }: { config: DictConfig; items: DictItem[] }) {
  const inv = useInvalidate();
  const toast = useToast();
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(toDraft());
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);

  const visible = useMemo(
    () => (config.parent && filter ? items.filter((i) => String(i.parentId ?? '') === filter) : items),
    [items, filter, config.parent],
  );
  const parentName = (id?: number | null) => config.parent?.options.find((o) => o.id === id)?.name;

  const payload = (d: Draft, extra: Partial<{ isActive: boolean }> = {}) => ({
    name: d.name.trim(),
    ...(d.sort ? { sort: Number(d.sort) } : {}),
    ...(config.parent ? { parentId: d.parentId ? Number(d.parentId) : null } : {}),
    ...(config.price ? { price: Number(d.price.replace(',', '.')) || 0, priceFrom: d.priceFrom } : {}),
    ...(config.months ? { months: Number(d.months) || 0, isDefault: d.isDefault } : {}),
    ...(config.stage ? { color: d.color, slaHours: Number(d.slaHours) || 24 } : {}),
    ...extra,
  });

  const saveItem = async () => {
    if (!draft.name.trim()) return toast.error('Введите название');
    setBusy(true);
    try {
      if (editing === 'new') await api.post(`/dictionaries/${config.name}`, payload(draft));
      else await api.put(`/dictionaries/${config.name}/${editing}`, payload(draft));
      await inv('dictionaries');
      toast.success('Сохранено');
      setEditing(null);
    } catch (e) {
      toast.error('Не сохранилось', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (it: DictItem) => {
    try {
      await api.put(`/dictionaries/${config.name}/${it.id}`, payload(toDraft(it), { isActive: !it.isActive }));
      await inv('dictionaries');
    } catch (e) {
      toast.error('Не получилось', (e as ApiError).message);
    }
  };

  const form = (
    <div className={s.dictForm}>
      <Input
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        placeholder="Название"
        aria-label="Название"
        autoFocus
      />
      {config.parent && (
        <Select
          value={draft.parentId}
          onChange={(e) => setDraft({ ...draft, parentId: e.target.value })}
          aria-label={config.parent.label}
        >
          <option value="">{config.parent.anyLabel ?? `${config.parent.label}: выберите`}</option>
          {config.parent.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      )}
      {config.price && (
        <>
          <Input
            inputMode="decimal"
            value={draft.price}
            onChange={(e) => setDraft({ ...draft, price: e.target.value })}
            placeholder="Цена, ₽"
            aria-label="Цена"
          />
          <Checkbox
            label="Цена «от»"
            checked={draft.priceFrom}
            onChange={(e) => setDraft({ ...draft, priceFrom: e.target.checked })}
          />
        </>
      )}
      {config.months && (
        <>
          <Input
            inputMode="numeric"
            value={draft.months}
            onChange={(e) => setDraft({ ...draft, months: e.target.value })}
            placeholder="Месяцев"
            aria-label="Срок, месяцев"
          />
          <Checkbox
            label="По умолчанию"
            checked={draft.isDefault}
            onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })}
          />
        </>
      )}
      {config.stage && (
        <>
          <Select value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} aria-label="Цвет">
            {STAGE_COLORS.map((c) => (
              <option key={c} value={c}>
                {COLOR_LABELS[c]}
              </option>
            ))}
          </Select>
          <Input
            inputMode="numeric"
            value={draft.slaHours}
            onChange={(e) => setDraft({ ...draft, slaHours: e.target.value })}
            placeholder="Срок, часов"
            aria-label="Срок этапа по умолчанию, часов"
          />
          <Input
            inputMode="numeric"
            value={draft.sort}
            onChange={(e) => setDraft({ ...draft, sort: e.target.value })}
            placeholder="Порядок"
            aria-label="Порядок этапа"
          />
        </>
      )}
      <div className={s.dictFormActions}>
        <Button size="sm" loading={busy} icon={<Check size={16} aria-hidden />} onClick={saveItem}>
          Сохранить
        </Button>
        <Button size="sm" variant="ghost" icon={<X size={16} aria-hidden />} onClick={() => setEditing(null)}>
          Отмена
        </Button>
      </div>
    </div>
  );

  return (
    <div className={s.dict}>
      <div className={s.dictHead}>
        <div>
          <h3 className={s.dictTitle}>{config.title}</h3>
          {config.hint && <p className={s.dictHint}>{config.hint}</p>}
        </div>
        <div className={s.dictTools}>
          {config.parent && (
            <Select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={`Фильтр: ${config.parent.label}`}>
              <option value="">{config.parent.anyLabel ? 'Все' : `${config.parent.label}: все`}</option>
              {config.parent.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          )}
          <Button
            size="sm"
            icon={<Plus size={16} aria-hidden />}
            onClick={() => {
              setDraft({ ...toDraft(), parentId: filter });
              setEditing('new');
            }}
          >
            Добавить
          </Button>
        </div>
      </div>
      {editing === 'new' && form}
      <ul className={s.dictList}>
        {visible.map((it, i) => (
          <li key={it.id} className={cx(s.dictItem, !it.isActive && s.inactive)}>
            {editing === it.id ? (
              form
            ) : (
              <>
                {config.stage && <span className={s.stageNo}>{String(i + 1).padStart(2, '0')}</span>}
                <span className={s.dictName}>
                  {it.name}
                  <span className={s.dictMeta}>
                    {config.parent && (parentName(it.parentId) ?? config.parent.anyLabel)}
                    {config.price && `${it.priceFrom ? 'от ' : ''}${formatMoney(it.price ?? 0)}`}
                    {config.months && `${it.months} мес.`}
                    {config.stage && `срок ${it.slaHours} ч`}
                  </span>
                </span>
                {it.isDefault && <Pill tone="teal">по умолчанию</Pill>}
                {config.stage && (
                  <Pill tone={it.color ?? 'blue'} dot>
                    {COLOR_LABELS[it.color ?? 'blue']}
                  </Pill>
                )}
                <Checkbox
                  label={<span className={s.activeLabel}>Активно</span>}
                  checked={it.isActive}
                  onChange={() => toggleActive(it)}
                />
                <IconButton
                  label={`Изменить «${it.name}»`}
                  onClick={() => {
                    setDraft(toDraft(it));
                    setEditing(it.id);
                  }}
                >
                  <Pencil />
                </IconButton>
              </>
            )}
          </li>
        ))}
        {!visible.length && <li className={s.dictEmpty}>Пока пусто</li>}
      </ul>
    </div>
  );
}

export function useDictConfigs(): DictConfig[] {
  const dict = useDictionaries();
  const d = dict.data;
  if (!d) return [];
  return [
    { name: 'device_types', title: 'Типы техники', hint: 'Первый уровень каскада в форме приёма' },
    { name: 'brands', title: 'Марки', parent: { label: 'Тип', options: d.deviceTypes, required: true } },
    {
      name: 'models',
      title: 'Модели',
      parent: {
        label: 'Марка',
        options: d.brands.map((b) => ({
          ...b,
          name: `${b.name} (${d.deviceTypes.find((t) => t.id === b.parentId)?.name ?? ''})`,
        })),
        required: true,
      },
    },
    { name: 'faults', title: 'Неисправности', parent: { label: 'Тип', options: d.deviceTypes, anyLabel: 'Любая техника' } },
    { name: 'appearance', title: 'Внешний вид', hint: 'Чипы в форме приёма' },
    { name: 'kit', title: 'Комплектность', hint: 'Чипы в форме приёма' },
    { name: 'inspect_pc', title: 'Проверка ПК', hint: 'Бланк каждого компьютера и ноутбука на выезде. Комментарий к пункту оставляет сам инженер' },
    { name: 'inspect_printer', title: 'Проверка МФУ', hint: 'Пункты чек-листа при проверке принтера или МФУ. Пробег вводится отдельным полем.' },
    {
      name: 'services',
      title: 'Услуги и цены',
      hint: 'Прайс для актов',
      price: true,
      parent: { label: 'Тип', options: d.deviceTypes, anyLabel: 'Любая техника' },
    },
    { name: 'warranties', title: 'Гарантии', hint: 'Срок по умолчанию подставляется в новый акт', months: true },
    {
      name: 'stages',
      title: 'Этапы ремонта',
      hint: 'Заявка проходит этапы строго по порядку. Первый и последний отключить нельзя.',
      stage: true,
    },
  ];
}
