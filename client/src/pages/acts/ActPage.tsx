import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, FileDown, Plus, Save, Search, Trash2 } from 'lucide-react';
import { actTotal, formatMoney, type ActItem } from '@sd/shared';
import { useAuth } from '@/app/auth';
import { api, ApiError } from '@/api/http';
import { useAct, useDictionaries, useInvalidate, useOrder, useSaveAct } from '@/api/queries';
import { fmtWhen } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import { Button, IconButton, cx } from '@/ui/Button';
import { Card, CardHead, ErrorBox, NumberTag, Spinner } from '@/ui/Display';
import { Checkbox, Field, Input, Select, Textarea } from '@/ui/Form';
import { useConfirm } from '@/ui/Confirm';
import { useToast } from '@/ui/Toast';
import s from './Acts.module.css';

interface Row extends ActItem {
  key: number;
}

let seq = 0;
const newRow = (r: Partial<ActItem> = {}): Row => ({ key: ++seq, serviceId: null, name: '', qty: 1, price: 0, ...r });

export default function ActPage() {
  const params = useParams();
  const [search] = useSearchParams();
  const actId = Number(params.id) || 0;
  const act = useAct(actId);
  const orderId = act.data?.orderId ?? (Number(search.get('order')) || 0);
  const order = useOrder(orderId);
  const dict = useDictionaries();
  const { can } = useAuth();
  const save = useSaveAct(actId || undefined);
  const inv = useInvalidate();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();

  const [rows, setRows] = useState<Row[]>([]);
  const [warranty, setWarranty] = useState<number>(1);
  const [discount, setDiscount] = useState(false);
  const [note, setNote] = useState('');
  const [svcQuery, setSvcQuery] = useState('');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  useDocumentTitle(actId ? `Акт №${act.data?.number ?? ''}` : 'Новый акт');

  useEffect(() => {
    if (loaded || !dict.data) return;
    if (actId && act.data) {
      setRows(act.data.items.map((i) => newRow(i)));
      setWarranty(act.data.warrantyMonths);
      setDiscount(act.data.printRepeatDiscount);
      setNote(act.data.note ?? '');
      setLoaded(true);
    } else if (!actId) {
      const def = dict.data.warranties.find((w) => w.isDefault && w.isActive);
      setWarranty(def?.months ?? 1);
      setRows([]);
      setLoaded(true);
    }
  }, [actId, act.data, dict.data, loaded]);

  const deviceTypeId = order.data?.device.deviceTypeId;
  const services = useMemo(() => {
    const list = (dict.data?.services ?? []).filter((x) => x.isActive);
    const q = svcQuery.trim().toLowerCase();
    return list
      .filter((x) => !q || x.name.toLowerCase().includes(q))
      .sort((a, b) => Number(b.parentId === deviceTypeId) - Number(a.parentId === deviceTypeId));
  }, [dict.data, svcQuery, deviceTypeId]);

  if (!orderId) return <ErrorBox>Акт оформляется из заявки. Откройте заявку и нажмите «Акт работ».</ErrorBox>;
  if ((actId && act.isLoading) || order.isLoading || !dict.data) return <Spinner />;
  if (act.isError) return <ErrorBox error={act.error} />;
  if (order.isError || !order.data) return <ErrorBox error={order.error} />;

  const o = order.data;
  const total = actTotal(rows);
  const update = (key: number, patch: Partial<ActItem>) =>
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const num = (v: string) => {
    const n = Number(v.replace(',', '.').replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  const submit = async () => {
    setError('');
    const items = rows.filter((r) => r.name.trim());
    if (!items.length) return setError('Добавьте хотя бы одну работу');
    try {
      const saved = await save.mutateAsync({
        orderId,
        items: items.map(({ serviceId, name, qty, price }) => ({ serviceId, name: name.trim(), qty: qty || 1, price })),
        warrantyMonths: warranty,
        printRepeatDiscount: discount,
        note: note || null,
      });
      toast.success(actId ? 'Акт сохранён. PDF пересоздан.' : `Акт №${saved.number} создан`);
      if (!actId) navigate(`/acts/${saved.id}`, { replace: true });
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const remove = async () => {
    if (
      !(await confirm({
        title: `Удалить акт №${act.data?.number}?`,
        body: 'Документ пропадёт из заявки и карточки клиента.',
        confirm: 'Удалить',
        danger: true,
      }))
    )
      return;
    try {
      await api.del(`/acts/${actId}`);
      inv('acts', 'order', 'client');
      toast.success('Акт удалён');
      navigate(`/orders/${orderId}`);
    } catch (e) {
      toast.error('Не удалось удалить', (e as ApiError).message);
    }
  };

  return (
    <div className={s.page}>
      <Link to={`/orders/${orderId}`} className={s.back}>
        <ArrowLeft size={18} aria-hidden />
        Заявка №{o.number}
      </Link>
      <header className={s.head}>
        <div className={s.headTags}>
          {act.data && <NumberTag>{act.data.number}</NumberTag>}
          {act.data && <span className="muted">изменён {fmtWhen(act.data.updatedAt)}</span>}
        </div>
        <h1 className={s.title}>{actId ? 'Акт выполненных работ' : 'Новый акт'}</h1>
        <p className={s.sub}>
          {o.deviceTitle}, {o.clientName}
        </p>
      </header>

      <div className={s.layout}>
        <div className={s.main}>
          <Card>
            <CardHead title="Работы" count={rows.length}>
              <Button
                variant="ghost"
                size="sm"
                icon={<Plus size={16} aria-hidden />}
                onClick={() => setRows((l) => [...l, newRow()])}
              >
                Своя строка
              </Button>
            </CardHead>
            {error && <ErrorBox>{error}</ErrorBox>}
            <div className={s.items}>
              <div className={s.itemsHead} aria-hidden>
                <span>Работа</span>
                <span>Кол-во</span>
                <span>Цена, ₽</span>
                <span>Сумма</span>
                <span />
              </div>
              {rows.map((r, i) => (
                <div key={r.key} className={s.item}>
                  <label className={s.itemName}>
                    <span className={s.cellLabel}>Работа {i + 1}</span>
                    <Input value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} placeholder="Что сделали" />
                  </label>
                  <label className={s.cell}>
                    <span className={s.cellLabel}>Кол-во</span>
                    <Input
                      inputMode="decimal"
                      value={String(r.qty)}
                      onChange={(e) => update(r.key, { qty: num(e.target.value) })}
                    />
                  </label>
                  <label className={s.cell}>
                    <span className={s.cellLabel}>Цена, ₽</span>
                    <Input
                      inputMode="decimal"
                      value={String(r.price)}
                      onChange={(e) => update(r.key, { price: num(e.target.value) })}
                    />
                  </label>
                  <span className={cx(s.cell, s.sum)}>
                    <span className={s.cellLabel}>Сумма</span>
                    <b className="num">{formatMoney(Math.round(r.qty * r.price * 100) / 100)}</b>
                  </span>
                  <span className={s.del}>
                    <IconButton
                      label={`Убрать строку ${r.name || i + 1}`}
                      onClick={() => setRows((l) => l.filter((x) => x.key !== r.key))}
                    >
                      <Trash2 />
                    </IconButton>
                  </span>
                </div>
              ))}
              {!rows.length && <p className={s.emptyItems}>Выберите работы из прайса ниже или добавьте свою строку.</p>}
            </div>
          </Card>

          <Card>
            <CardHead title="Прайс" />
            <Input
              icon={<Search aria-hidden />}
              type="search"
              placeholder="Найти услугу"
              aria-label="Поиск по прайсу"
              value={svcQuery}
              onChange={(e) => setSvcQuery(e.target.value)}
            />
            <ul className={s.services}>
              {services.map((svc) => (
                <li key={svc.id}>
                  <button
                    type="button"
                    className={s.service}
                    onClick={() =>
                      setRows((l) => [...l, newRow({ serviceId: svc.id, name: svc.name, price: Number(svc.price ?? 0) })])
                    }
                  >
                    <span className={s.serviceName}>{svc.name}</span>
                    <span className={s.servicePrice}>
                      {svc.priceFrom ? 'от ' : ''}
                      {formatMoney(svc.price ?? 0)}
                    </span>
                    <Plus aria-hidden className={s.servicePlus} />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <aside className={s.aside}>
          <Card className={s.totalCard}>
            <p className={s.totalLabel}>Итого</p>
            <p className={s.total}>{formatMoney(total)}</p>
            <div className="stack">
              <Field label="Гарантия">
                <Select value={warranty} onChange={(e) => setWarranty(Number(e.target.value))}>
                  {dict.data.warranties
                    .filter((w) => w.isActive || w.months === warranty)
                    .map((w) => (
                      <option key={w.id} value={w.months}>
                        {w.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Checkbox
                label="Печатать скидку при повторном обращении"
                checked={discount}
                onChange={(e) => setDiscount(e.target.checked)}
              />
              <Field label="Примечание в акте" optional>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
              </Field>
              <Button block loading={save.isPending} icon={<Save size={18} aria-hidden />} onClick={submit}>
                {actId ? 'Сохранить и пересоздать PDF' : 'Создать акт'}
              </Button>
              {actId > 0 && (
                <a className={s.pdfBtn} href={`/api/documents/act/${actId}.pdf`} target="_blank" rel="noreferrer">
                  <FileDown size={18} aria-hidden />
                  Открыть PDF
                </a>
              )}
              {actId > 0 && can('acts.delete') && (
                <Button variant="danger" block icon={<Trash2 size={18} aria-hidden />} onClick={remove}>
                  Удалить акт
                </Button>
              )}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
