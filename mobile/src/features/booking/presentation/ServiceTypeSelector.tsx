import { SERVICE_OPTIONS } from '@/features/booking/domain/serviceCatalog';
import type { ServiceType } from '@/features/booking/domain/types';
import {
  SelectableOptionCards,
  type SelectableOption,
} from '@/features/booking/presentation/SelectableOptionCards';

type Props = {
  value: ServiceType;
  onChange: (service: ServiceType) => void;
};

const OPTIONS: readonly SelectableOption<ServiceType>[] = SERVICE_OPTIONS.map((option) => ({
  id: option.id,
  label: option.shortLabel,
  icon: option.icon,
  accessibilityLabel: option.label,
}));

/** Selector visual único para el servicio de la solicitud del pasajero. */
export function ServiceTypeSelector({ value, onChange }: Props) {
  return <SelectableOptionCards options={OPTIONS} value={value} onChange={onChange} columns={2} />;
}
