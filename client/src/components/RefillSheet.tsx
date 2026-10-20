import { WorkSheet } from './WorkSheet';

/** Заправка картриджей по клиенту: считаем по количеству, без привязки к конкретной технике. */
export function RefillSheet({ clientId, open, onClose }: { clientId: number; open: boolean; onClose: () => void }) {
  return (
    <WorkSheet
      open={open}
      onClose={onClose}
      target={{ clientId }}
      kinds={['refill']}
      chooseOrder
      subtitle="Попадёт в помесячный отчёт по клиенту"
    />
  );
}
