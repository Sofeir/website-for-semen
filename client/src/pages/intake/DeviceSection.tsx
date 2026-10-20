import { useMemo } from 'react';
import { Controller, useWatch, type Control, type FieldErrors, type UseFormSetValue } from 'react-hook-form';
import { History, Trash2 } from 'lucide-react';
import type { Device, Dictionaries, IntakeInput } from '@sd/shared';
import { IconButton, cx } from '@/ui/Button';
import { Combobox } from '@/ui/Combobox';
import { ChipGroup, Field, Input, RadioChips, Textarea, formStyles } from '@/ui/Form';
import s from './Intake.module.css';

interface Props {
  index: number;
  control: Control<IntakeInput>;
  setValue: UseFormSetValue<IntakeInput>;
  errors: FieldErrors<IntakeInput>;
  dict: Dictionaries;
  pastDevices: Device[];
  legal: boolean;
  departments: string[];
  canRemove: boolean;
  onRemove: () => void;
  total: number;
}

/** Блок одной единицы техники: каскад «тип → марка → модель», неисправность, внешний вид, комплектность. */
export function DeviceSection({
  index,
  control,
  setValue,
  errors,
  dict,
  pastDevices,
  legal,
  departments,
  canRemove,
  onRemove,
  total,
}: Props) {
  const path = `devices.${index}` as const;
  const typeId = useWatch({ control, name: `${path}.device.deviceTypeId` });
  const brandId = useWatch({ control, name: `${path}.device.brandId` });
  const existingId = useWatch({ control, name: `${path}.device.id` });
  const err = errors.devices?.[index];
  const typeName = dict.deviceTypes.find((t) => t.id === Number(typeId))?.name;
  const serialRequired = typeName === 'Ноутбук' || typeName === 'Принтеры/МФУ';

  const types = dict.deviceTypes.filter((t) => t.isActive);
  const brands = useMemo(() => dict.brands.filter((b) => b.isActive && b.parentId === Number(typeId)), [dict.brands, typeId]);
  const models = useMemo(() => dict.models.filter((m) => m.isActive && m.parentId === Number(brandId)), [dict.models, brandId]);
  const faults = useMemo(
    () => dict.faults.filter((f) => f.isActive && (f.parentId == null || f.parentId === Number(typeId))),
    [dict.faults, typeId],
  );
  const appearance = dict.appearance.filter((a) => a.isActive).map((a) => a.name);
  const kit = dict.kit.filter((a) => a.isActive).map((a) => a.name);

  const usePast = (d: Device) => {
    setValue(`${path}.device`, {
      id: d.id,
      deviceTypeId: d.deviceTypeId,
      brandId: d.brandId,
      brandText: d.brandId ? null : d.brand,
      modelId: d.modelId,
      modelText: d.modelId ? null : d.model,
      serial: d.serial,
    });
  };

  const resetExisting = () => setValue(`${path}.device.id`, null);

  return (
    <div className={s.device}>
      {total > 1 && (
        <div className={s.deviceHead}>
          <span className={s.deviceNum}>{String(index + 1).padStart(2, '0')}</span>
          <b>Техника {index + 1}</b>
          {canRemove && (
            <IconButton label={`Убрать технику ${index + 1}`} onClick={onRemove}>
              <Trash2 />
            </IconButton>
          )}
        </div>
      )}

      {pastDevices.length > 0 && (
        <div className={s.past}>
          <span className={s.pastLabel}>
            <History size={16} aria-hidden /> Уже сдавал
          </span>
          <div className={formStyles.chips}>
            {pastDevices.slice(0, 6).map((d) => (
              <button
                type="button"
                key={d.id}
                className={cx(formStyles.chip, existingId === d.id && formStyles.chipOn)}
                aria-pressed={existingId === d.id}
                onClick={() => usePast(d)}
              >
                {d.title}
                {d.serial ? `, ${d.serial}` : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      <Field label="Тип техники" error={err?.device?.deviceTypeId?.message} group>
        <Controller
          control={control}
          name={`${path}.device.deviceTypeId`}
          render={({ field }) => (
            <RadioChips
              label="Тип техники"
              options={types}
              value={Number(field.value) || null}
              invalid={Boolean(err?.device?.deviceTypeId)}
              onChange={(id) => {
                field.onChange(id);
                resetExisting();
                setValue(`${path}.device.brandId`, null);
                setValue(`${path}.device.modelId`, null);
                setValue(`${path}.faultIds`, []);
              }}
            />
          )}
        />
      </Field>

      <div className={formStyles.grid3}>
        <Field label="Марка">
          {(cp) => (
            <Controller
              control={control}
              name={`${path}.device.brandId`}
              render={({ field }) => (
                <Controller
                  control={control}
                  name={`${path}.device.brandText`}
                  render={({ field: textField }) => (
                    <Combobox
                      {...cp}
                      options={brands}
                      valueId={field.value}
                      text={textField.value ?? ''}
                      placeholder={typeId ? 'Выберите или впишите' : 'Сначала тип'}
                      onChange={({ id, text }) => {
                        field.onChange(id);
                        textField.onChange(id ? null : text);
                        resetExisting();
                        setValue(`${path}.device.modelId`, null);
                      }}
                    />
                  )}
                />
              )}
            />
          )}
        </Field>
        <Field label="Модель">
          {(cp) => (
            <Controller
              control={control}
              name={`${path}.device.modelId`}
              render={({ field }) => (
                <Controller
                  control={control}
                  name={`${path}.device.modelText`}
                  render={({ field: textField }) => (
                    <Combobox
                      {...cp}
                      options={models}
                      valueId={field.value}
                      text={textField.value ?? ''}
                      placeholder="Например, Aspire 5"
                      onChange={({ id, text }) => {
                        field.onChange(id);
                        textField.onChange(id ? null : text);
                        resetExisting();
                      }}
                    />
                  )}
                />
              )}
            />
          )}
        </Field>
        <Field
          label="Серийный номер"
          optional={!serialRequired}
          error={err?.device?.serial?.message}
          hint={typeName === 'Компьютер' ? 'Если номера нет, система присвоит свой (ПК-0001)' : undefined}
        >
          {(cp) => (
            <Controller
              control={control}
              name={`${path}.device.serial`}
              render={({ field }) => (
                <Input
                  {...cp}
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="S/N или IMEI"
                />
              )}
            />
          )}
        </Field>
      </div>

      <Field label="Неисправность" error={err?.faultText?.message} group>
        <div className="stack" style={{ gap: 'var(--s-3)' }}>
          <Controller
            control={control}
            name={`${path}.faultIds`}
            render={({ field }) => (
              <ChipGroup
                label="Типовые неисправности"
                options={faults.map((f) => f.name)}
                value={(field.value ?? []).map((id: number) => faults.find((f) => f.id === id)?.name ?? '').filter(Boolean)}
                onChange={(names) => field.onChange(names.map((n) => faults.find((f) => f.name === n)!.id))}
              />
            )}
          />
          <Controller
            control={control}
            name={`${path}.faultText`}
            render={({ field }) => (
              <Textarea
                value={field.value ?? ''}
                onChange={field.onChange}
                rows={2}
                placeholder="Со слов клиента: что случилось и когда"
                aria-label="Описание неисправности"
                aria-invalid={Boolean(err?.faultText)}
              />
            )}
          />
        </div>
      </Field>

      <Field label="Внешний вид" group>
        <div className="stack" style={{ gap: 'var(--s-3)' }}>
          <Controller
            control={control}
            name={`${path}.appearance`}
            render={({ field }) => (
              <ChipGroup label="Внешний вид" options={appearance} value={field.value ?? []} onChange={field.onChange} />
            )}
          />
          <Controller
            control={control}
            name={`${path}.appearanceNote`}
            render={({ field }) => (
              <Input
                value={field.value ?? ''}
                onChange={field.onChange}
                placeholder="Уточнение, например: скол на крышке справа"
                aria-label="Уточнение по внешнему виду"
              />
            )}
          />
        </div>
      </Field>

      <Field label="Комплектность" group>
        <div className="stack" style={{ gap: 'var(--s-3)' }}>
          <Controller
            control={control}
            name={`${path}.kit`}
            render={({ field }) => (
              <ChipGroup label="Комплектность" options={kit} value={field.value ?? []} onChange={field.onChange} />
            )}
          />
          <Controller
            control={control}
            name={`${path}.kitNote`}
            render={({ field }) => (
              <Input
                value={field.value ?? ''}
                onChange={field.onChange}
                placeholder="Что ещё оставили"
                aria-label="Уточнение по комплектности"
              />
            )}
          />
        </div>
      </Field>

      <div className={formStyles.grid2}>
        <Field label="Пароль устройства" optional hint="Мастер увидит его в заявке. В квитанции не печатается.">
          {(cp) => (
            <Controller
              control={control}
              name={`${path}.devicePassword`}
              render={({ field }) => (
                <Input
                  {...cp}
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="none"
                  data-lpignore="true"
                />
              )}
            />
          )}
        </Field>
        {legal && (
          <Field label="Отдел" optional>
            {(cp) => (
              <Controller
                control={control}
                name={`${path}.department`}
                render={({ field }) => (
                  <Combobox
                    {...cp}
                    options={departments.map((d, i) => ({ id: i + 1, name: d }))}
                    valueId={null}
                    text={field.value ?? ''}
                    placeholder="Например, бухгалтерия"
                    onChange={({ text }) => field.onChange(text)}
                  />
                )}
              />
            )}
          </Field>
        )}
      </div>
    </div>
  );
}
