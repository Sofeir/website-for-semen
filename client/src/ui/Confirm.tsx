import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Sheet } from './Sheet';

interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirm?: string;
  cancel?: string;
  danger?: boolean;
}

const ConfirmContext = createContext<((o: ConfirmOptions) => Promise<boolean>) | null>(null);

/** Подтверждение опасных действий: `if (await confirm({...})) …`. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<(v: boolean) => void>();

  const confirm = useCallback((o: ConfirmOptions) => {
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (v: boolean) => {
    resolver.current?.(v);
    setOpts(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Sheet
        open={Boolean(opts)}
        onClose={() => close(false)}
        title={opts?.title ?? ''}
        width={440}
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>
              {opts?.cancel ?? 'Отмена'}
            </Button>
            <Button variant={opts?.danger ? 'danger' : 'primary'} onClick={() => close(true)} data-autofocus>
              {opts?.confirm ?? 'Подтвердить'}
            </Button>
          </>
        }
      >
        {opts?.body && <div style={{ color: 'var(--text-2)' }}>{opts.body}</div>}
      </Sheet>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm вне ConfirmProvider');
  return ctx;
}
