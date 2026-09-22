import type { ServiceType } from './types';

export function routeTravelMode(service: ServiceType): 'DRIVE' | 'TWO_WHEELER' {
  return service === 'moto' ? 'TWO_WHEELER' : 'DRIVE';
}
