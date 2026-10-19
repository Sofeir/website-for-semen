import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button, IconButton } from '@/ui/Button';
import { Input } from '@/ui/Form';
import s from './ChecklistEditor.module.css';

/** Редактор списка пунктов: строка — один пункт, можно добавить и убрать. */
export function ChecklistEditor({
  items,
  onChange,
  placeholder = 'Например, проверить резервные копии',
  disabled,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onChange([...items, v]);
    setDraft('');
  };
  return (
    <div className={s.wrap}>
      {items.length > 0 && (
        <ol className={s.list}>
          {items.map((it, i) => (
            <li key={i} className={s.row}>
              <span className={s.num}>{i + 1}</span>
              <Input
                value={it}
                disabled={disabled}
                aria-label={`Пункт ${i + 1}`}
                onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
              />
              {!disabled && (
                <IconButton label={`Убрать пункт ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
                  <X />
                </IconButton>
              )}
            </li>
          ))}
        </ol>
      )}
      {!disabled && (
        <div className={s.add}>
          <Input
            value={draft}
            placeholder={placeholder}
            aria-label="Новый пункт"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button variant="secondary" icon={<Plus size={18} aria-hidden />} onClick={add} disabled={!draft.trim()}>
            Добавить
          </Button>
        </div>
      )}
    </div>
  );
}
