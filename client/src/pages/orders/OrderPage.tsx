import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ArrowRightLeft, Eye, EyeOff, FilePlus2, FileText, ListPlus, Phone, Printer, RotateCcw } from 'lucide-react';
import { formatMoney, formatPhone } from '@sd/shared';
import { useAuth, useMe } from '@/app/auth';
import { useDictionaries, useInvalidate, useOrder } from '@/api/queries';
import { fmtWhen } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import { AdvanceSheet, ReassignSheet, ReopenSheet } from '@/components/AdvanceSheet';
import { AttachHint, AttachmentList, UploadButton } from '@/components/Attachments';
import { DeviceJournalSheet } from '@/components/DeviceJournalSheet';
import { StageRail } from '@/components/StageRail';
import { TaskRow } from '@/components/TaskRow';
import { TaskSheet } from '@/components/TaskSheet';
import { TaskFormSheet } from '@/components/TaskFormSheet';
import { Button, ButtonLink, IconButton, cx } from '@/ui/Button';
import { Card, CardHead, DescList, EmptyState, ErrorBox, NumberTag, Pill, Plate, Spinner, StagePill } from '@/ui/Display';
import s from './OrderPage.module.css';

export default function OrderPage() {
  const id = Number(useParams().id);
  const q = useOrder(id);
  const dict = useDictionaries();
  const me = useMe();
  const { can } = useAuth();
  const inv = useInvalidate();
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [taskId, setTaskId] = useState<number | null>(null);
  const [newTask, setNewTask] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const o = q.data;
  useDocumentTitle(o ? `№${o.number}` : 'Заявка');

  if (q.isLoading || !dict.data) return <Spinner />;
  if (q.isError || !o) return <ErrorBox error={q.error} />;

  const stages = dict.data.stages.filter((st) => st.isActive);
  const isIssued = Boolean(o.issuedAt);
  const canReassign = !isIssued && (can('orders.assign') || o.responsibleId === me.id);
  const target = { ...o, hasAct: o.acts.length > 0 };
  const history = [...o.history].reverse();

  return (
    <div className={s.page}>
      <Link to="/orders" className={s.back}>
        <ArrowLeft size={18} aria-hidden />
        Все заявки
      </Link>

      <header className={s.head}>
        <div className={s.headMain}>
          <div className={s.headTags}>
            <NumberTag>{o.number}</NumberTag>
            <StagePill name={o.stageName} color={o.stageColor} />
            {o.overdue && (
              <Pill tone="red" dot>
                Срок этапа прошёл
              </Pill>
            )}
            {o.clientKind === 'legal' && <Pill tone="outline">юрлицо</Pill>}
            {o.outcome === 'declined' && <Pill tone="outline">без ремонта</Pill>}
            {o.reopenCount > 0 && <Pill tone="outline">повторно: {o.reopenCount}</Pill>}
          </div>
          <h1 className={s.title}>{o.deviceTitle}</h1>
          <p className={s.sub}>
            <Link to={`/clients/${o.clientId}`}>{o.clientName}</Link>
            {o.clientPhone && (
              <>
                {', '}
                <a href={`tel:+${o.clientPhone.replace(/\D/g, '')}`} className={s.tel}>
                  <Phone size={14} aria-hidden />
                  {formatPhone(o.clientPhone)}
                </a>
              </>
            )}
          </p>
        </div>
      </header>

      <Card className={s.railCard}>
        <StageRail stages={stages} currentId={o.stageId} />
      </Card>

      <div className={s.actions}>
        {o.canAdvance && o.nextStage && (
          <Button
            icon={<ArrowRight size={18} aria-hidden />}
            onClick={() => setAdvanceOpen(true)}
            variant={o.nextStage.isFinal ? 'success' : 'primary'}
          >
            {o.nextStage.isFinal ? 'Выдать технику' : `Дальше: ${o.nextStage.name}`}
          </Button>
        )}
        {canReassign && (
          <Button variant="secondary" icon={<ArrowRightLeft size={18} aria-hidden />} onClick={() => setReassignOpen(true)}>
            Передать
          </Button>
        )}
        {o.canReopen && (
          <Button variant="secondary" icon={<RotateCcw size={18} aria-hidden />} onClick={() => setReopenOpen(true)}>
            Открыть заново
          </Button>
        )}
        {can('acts.edit') && (
          <ButtonLink to={`/acts/new?order=${o.id}`} variant="secondary" icon={<FilePlus2 size={18} aria-hidden />}>
            Акт работ
          </ButtonLink>
        )}
        {o.receiptUrl && (
          <a className={s.linkBtn} href={o.receiptUrl} target="_blank" rel="noreferrer">
            <Printer size={18} aria-hidden />
            Квитанция
          </a>
        )}
      </div>

      <div className={s.grid}>
        <div className={s.col}>
          <Card>
            <CardHead title="Техника">
              <Button variant="ghost" size="sm" onClick={() => setJournalOpen(true)}>
                Журнал и паспорт
              </Button>
            </CardHead>
            <DescList
              items={[
                ['Номер', o.device.inventoryNo],
                ['Где стоит', o.device.location],
                ['Тип', o.device.deviceType],
                ['Марка и модель', [o.device.brand, o.device.model].filter(Boolean).join(' ') || '—'],
                ['Серийный номер', o.device.serial || 'не указан'],
                ['Филиал', o.branch],
                ['Заявку подал', o.requesterName],
                ['Отдел', o.department],
                ['Неисправность', o.fault],
                [
                  'Внешний вид',
                  (o.appearance.length || o.appearanceNote) && (
                    <span className={s.chips}>
                      {o.appearance.map((a) => (
                        <Pill key={a}>{a}</Pill>
                      ))}
                      {o.appearanceNote && <span className={s.note}>{o.appearanceNote}</span>}
                    </span>
                  ),
                ],
                [
                  'Комплектность',
                  (o.kit.length || o.kitNote) && (
                    <span className={s.chips}>
                      {o.kit.map((a) => (
                        <Pill key={a}>{a}</Pill>
                      ))}
                      {o.kitNote && <span className={s.note}>{o.kitNote}</span>}
                    </span>
                  ),
                ],
                [
                  'Пароль устройства',
                  o.devicePassword ? (
                    <span className="row" style={{ gap: 4 }}>
                      <code className={s.password}>{showPassword ? o.devicePassword : '••••••'}</code>
                      <IconButton
                        label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff /> : <Eye />}
                      </IconButton>
                    </span>
                  ) : (
                    'не сообщали'
                  ),
                ],
                ['Примерная стоимость', o.estimatedCost !== null && formatMoney(o.estimatedCost)],
                ['Комментарий', o.comment],
                ['Принял', o.acceptedByName && `${o.acceptedByName}, ${fmtWhen(o.createdAt)}`],
                ['Техника возвращена', o.deviceReturnedAt && fmtWhen(o.deviceReturnedAt)],
              ]}
            />
          </Card>

          <Card>
            <CardHead title="Задачи по заявке" count={o.tasks.length}>
              <Button variant="ghost" size="sm" icon={<ListPlus size={18} aria-hidden />} onClick={() => setNewTask(true)}>
                Задача
              </Button>
            </CardHead>
            {o.tasks.length ? (
              <div>
                {o.tasks.map((t) => (
                  <TaskRow key={t.id} task={t} onOpen={() => setTaskId(t.id)} showAssignee />
                ))}
              </div>
            ) : (
              <p className="muted">Задач нет.</p>
            )}
          </Card>

          <Card>
            <CardHead title="Акты выполненных работ" count={o.acts.length} />
            {o.acts.length ? (
              <ul className={s.docs}>
                {o.acts.map((a) => (
                  <li key={a.id} className={s.doc}>
                    <FileText aria-hidden className={s.docIcon} />
                    <Link to={`/acts/${a.id}`} className={s.docMain}>
                      <b>Акт №{a.number}</b>
                      <span>
                        {formatMoney(a.total)}, изменён {fmtWhen(a.updatedAt)}
                      </span>
                    </Link>
                    <a href={`/api/documents/act/${a.id}.pdf`} target="_blank" rel="noreferrer" className={s.pdf}>
                      PDF
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={<FileText />}
                title="Акта пока нет"
                action={
                  can('acts.edit') ? (
                    <ButtonLink to={`/acts/new?order=${o.id}`} size="sm" icon={<FilePlus2 size={18} aria-hidden />}>
                      Оформить акт
                    </ButtonLink>
                  ) : undefined
                }
              >
                В одном акте может быть несколько работ из прайса и свои строки.
              </EmptyState>
            )}
          </Card>
        </div>

        <div className={s.col}>
          <Plate className={s.now}>
            <p className={s.nowLabel}>{isIssued ? 'Выдано клиенту' : 'Сейчас отвечает'}</p>
            <p className={s.nowName}>{o.responsibleName ?? '—'}</p>
            <dl className={s.nowDl}>
              <div>
                <dt>Этап</dt>
                <dd>{o.stageName}</dd>
              </div>
              <div>
                <dt>{isIssued ? 'Выдано' : 'Передано'}</dt>
                <dd>{fmtWhen(o.issuedAt ?? o.stageStartedAt)}</dd>
              </div>
              {!isIssued && (
                <div>
                  <dt>Срок</dt>
                  <dd className={cx(o.overdue && s.nowLate)}>{fmtWhen(o.stageDueAt)}</dd>
                </div>
              )}
            </dl>
          </Plate>

          <Card>
            <CardHead title="История" />
            <ol className={s.history}>
              {history.map((h) => (
                <li key={h.id} className={s.hItem} data-open={!h.finishedAt}>
                  <span className={s.hDot} aria-hidden />
                  <div className={s.hBody}>
                    <b>
                      {h.kind === 'transfer'
                        ? `Передано: ${h.responsibleName ?? '—'}`
                        : h.kind === 'reopen'
                          ? `Открыта заново: ${h.stageName}`
                          : h.stageName}
                      {h.kind !== 'transfer' && h.responsibleName && <span className={s.hWho}>, {h.responsibleName}</span>}
                    </b>
                    <span className={s.hMeta}>
                      {fmtWhen(h.startedAt)}
                      {h.fromUserName && h.kind !== 'stage' && `, от ${h.fromUserName}`}
                      {h.dueAt && !h.finishedAt && `, срок ${fmtWhen(h.dueAt)}`}
                    </span>
                    {h.comment && <span className={s.hComment}>{h.comment}</span>}
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          <Card>
            <CardHead title="Файлы" count={o.attachments.length}>
              <UploadButton target={{ orderId: o.id }} onUploaded={() => inv('order')} label="Добавить" />
            </CardHead>
            {o.attachments.length ? <AttachmentList items={o.attachments} onDeleted={() => inv('order')} /> : <AttachHint />}
          </Card>
        </div>
      </div>

      <AdvanceSheet order={advanceOpen ? target : null} next={o.nextStage} onClose={() => setAdvanceOpen(false)} />
      <ReassignSheet order={reassignOpen ? target : null} onClose={() => setReassignOpen(false)} />
      <ReopenSheet order={reopenOpen ? target : null} onClose={() => setReopenOpen(false)} />
      <DeviceJournalSheet device={journalOpen ? o.device : null} orderId={o.id} onClose={() => setJournalOpen(false)} />
      <TaskSheet taskId={taskId} onClose={() => setTaskId(null)} />
      <TaskFormSheet
        open={newTask}
        onClose={() => setNewTask(false)}
        orderId={o.id}
        clientId={o.clientId}
        presetTitle={`По заявке №${o.number}: `}
      />
    </div>
  );
}
