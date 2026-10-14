import s from './AppShell.module.css';
import { cx } from '@/ui/Button';

/** Эмблема ASOFT с подписью сервиса. */
export function Brand({ compact, name = 'ASOFT Сервис', className }: { compact?: boolean; name?: string; className?: string }) {
  const [first, ...rest] = name.split(' ');
  return (
    <span className={cx(s.brand, compact && s.brandCompact, className)}>
      <img src={`${import.meta.env.BASE_URL}logo-96.webp`} alt="" width={40} height={40} className={s.brandMark} />
      {!compact && (
        <span className={s.brandText}>
          <span className={s.brandName}>{first}</span>
          {rest.length > 0 && <span className={s.brandSub}>{rest.join(' ')}</span>}
        </span>
      )}
    </span>
  );
}
