import { Button } from '@/shared/components';

/** Keep cancellation available without competing with the next trip action. */
export function TripSecondaryAction({ title, onPress, disabled = false }: {
  title: string; onPress: () => void; disabled?: boolean;
}) {
  return <Button title={title} variant="text" onPress={onPress} disabled={disabled} />;
}
