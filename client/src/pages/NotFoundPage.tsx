import { Compass } from 'lucide-react';
import { ButtonLink } from '@/ui/Button';
import { Card, EmptyState } from '@/ui/Display';

export default function NotFoundPage() {
  return (
    <Card>
      <EmptyState icon={<Compass />} title="Такой страницы нет" action={<ButtonLink to="/">На главную</ButtonLink>}>
        Возможно, ссылка устарела или в адресе опечатка.
      </EmptyState>
    </Card>
  );
}
