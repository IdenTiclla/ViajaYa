import { z } from 'zod';
import { api } from '@/core/http/client';
import type { DriverLocation } from '../domain/driverLocation';

export const driverLocationSchema = z.object({
  ride_id: z.uuid(), driver_id: z.uuid(),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy_meters: z.number().finite().min(0).max(100),
  heading: z.number().finite().min(0).lt(360).nullable(),
  captured_at: z.iso.datetime({ offset: true }), received_at: z.iso.datetime({ offset: true }),
});
export const driverLocationMessageSchema = z.object({ type: z.literal('driver_location'), data: driverLocationSchema.nullable() });
export type DriverLocationInput = Pick<z.infer<typeof driverLocationSchema>, 'latitude' | 'longitude' | 'accuracy_meters' | 'heading' | 'captured_at'>;

export function toDriverLocation(dto: z.infer<typeof driverLocationSchema>): DriverLocation {
  return { rideId: dto.ride_id, driverId: dto.driver_id, latitude: dto.latitude, longitude: dto.longitude,
    accuracyMeters: dto.accuracy_meters, heading: dto.heading, capturedAt: dto.captured_at, receivedAt: dto.received_at };
}
export const driverLocationRepository = {
  async get(rideId: string, signal?: AbortSignal): Promise<DriverLocation | null> {
    const { data } = await api.get(`/rides/${rideId}/driver-location`, { signal });
    return data === null ? null : toDriverLocation(driverLocationSchema.parse(data));
  },
  async report(rideId: string, input: DriverLocationInput, signal?: AbortSignal): Promise<void> {
    await api.put(`/rides/${rideId}/driver-location`, input, { signal });
  },
};
