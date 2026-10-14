import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { formatMoney } from '@sd/shared';
import { useActs } from '@/api/queries';
import { fmtWhen } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import { ArrowLink } from '@/ui/Button';
import { Card, EmptyState, ErrorBox, NumberTag, PageHeader, Spinner } from '@/ui/Display';
import s from './Acts.module.css';

export default function ActsPage() {
  useDocumentTitle('Акты');
  const acts = useActs();
  return (
    <>
      <PageHeader
        title="Акты выполненных работ"
        subtitle="Акт оформляется из заявки и правится в любой момент — PDF собирается заново."
      />
      {acts.isError ? (
        <ErrorBox error={acts.error} />
      ) : !acts.data ? (
        <Spinner />
      ) : !acts.data.length ? (
        <Card>
          <EmptyState icon={<FileText />} title="Актов пока нет">
            Откройте заявку и нажмите «Акт работ».
          </EmptyState>
        </Card>
      ) : (
        <Card className={s.list}>
          {acts.data.map((a) => (
            <div key={a.id} className={s.row}>
              <Link to={`/acts/${a.id}`} className={s.rowLink}>
                <NumberTag>{a.number}</NumberTag>
                <span className={s.rowMain}>
                  <b>{a.deviceTitle}</b>
                  <span>
                    {a.clientName}, заявка №{a.orderNumber}, {fmtWhen(a.updatedAt)}
                  </span>
                </span>
                <b className={s.rowSum}>{formatMoney(a.total)}</b>
              </Link>
              <a
                href={`/api/documents/act/${a.id}.pdf`}
                target="_blank"
                rel="noreferrer"
                className={s.pdf}
                aria-label={`PDF акта ${a.number}`}
              >
                PDF
              </a>
              <span className={s.hideSm}>
                <ArrowLink to={`/acts/${a.id}`} label={`Открыть акт ${a.number}`} light />
              </span>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
