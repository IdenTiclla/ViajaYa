import { z } from 'zod';

import type {
  OfferDto,
  OpenRideDto,
  OpenRidePageDto,
  RideDto,
} from '@/features/rides/data/ridesRepository';

const uuidSchema = z.string().uuid();
const nullableDateTimeSchema = z.string().datetime({ offset: true }).nullable();
const ratingSchema = z.number().min(0).max(5).nullable();
const vehicleTypeSchema = z.enum(['taxi', 'moto']);
const serviceTypeSchema = z.enum(['taxi', 'moto', 'delivery']);
const paymentMethodSchema = z.enum(['qr', 'cash']);
const rideStatusSchema = z.enum([
  'searching',
  'accepted',
  'arriving',
  'in_progress',
  'completed',
  'cancelled',
]);
const offerStatusSchema = z.enum(['pending', 'accepted', 'rejected', 'expired']);
const positiveDecimalSchema = z.string().refine(
  (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0;
  },
  { message: 'Monto decimal inválido.' },
);

const pointDtoSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string().min(1),
  address: z.string().min(1),
  country_code: z.string().length(2).nullable().optional(),
});

export const offerDtoSchema = z.object({
  id: uuidSchema,
  ride_id: uuidSchema,
  price: positiveDecimalSchema,
  eta_min: z.number().int().min(0).max(240).nullable(),
  status: offerStatusSchema,
  driver: z.object({
    id: uuidSchema,
    full_name: z.string().min(1),
    rating: ratingSchema,
    vehicle_type: vehicleTypeSchema.nullable(),
    plate: z.string().nullable(),
    vehicle_model: z.string().nullable(),
  }),
  created_at: nullableDateTimeSchema,
  expires_at: nullableDateTimeSchema,
}) satisfies z.ZodType<OfferDto>;

export const openRideDtoSchema = z.object({
  id: uuidSchema,
  service_type: serviceTypeSchema,
  fare: positiveDecimalSchema,
  payment_method: paymentMethodSchema,
  origin: pointDtoSchema,
  destination: pointDtoSchema,
  rider: z.object({
    id: uuidSchema,
    full_name: z.string().min(1),
    rating: ratingSchema,
    trips_completed: z.number().int().nonnegative(),
  }),
  pool_version: z.number().int().positive(),
  created_at: nullableDateTimeSchema,
}) satisfies z.ZodType<OpenRideDto>;

export const openRidePageDtoSchema = z.object({
  items: z.array(openRideDtoSchema),
  next_cursor: z.string().min(1).nullable(),
}) satisfies z.ZodType<OpenRidePageDto>;

export const rideDtoSchema = z.object({
  id: uuidSchema,
  rider_id: uuidSchema,
  rider: z.object({
    id: uuidSchema,
    full_name: z.string().min(1),
    phone: z.string().nullable(),
    rating: ratingSchema,
  }),
  status: rideStatusSchema,
  paused: z.boolean(),
  service_type: serviceTypeSchema,
  fare: positiveDecimalSchema,
  payment_method: paymentMethodSchema,
  origin: pointDtoSchema,
  destination: pointDtoSchema,
  driver: z
    .object({
      id: uuidSchema,
      full_name: z.string().min(1),
      phone: z.string().nullable(),
      rating: ratingSchema,
      vehicle_type: vehicleTypeSchema.nullable(),
      plate: z.string().nullable(),
      vehicle_model: z.string().nullable(),
    })
    .nullable(),
  accepted_price: positiveDecimalSchema.nullable(),
  accepted_eta_min: z.number().int().min(0).max(240).nullable(),
  created_at: nullableDateTimeSchema,
  completed_at: nullableDateTimeSchema,
  cancelled_at: nullableDateTimeSchema,
}) satisfies z.ZodType<RideDto>;

const offerExpiredDataSchema = z.object({
  ride_id: uuidSchema,
  offer_id: uuidSchema,
  driver_id: uuidSchema,
  reason: z.literal('expired'),
});

export const passengerSocketMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('offers_snapshot'), data: z.array(offerDtoSchema) }),
  z.object({ type: z.literal('offer_created'), data: offerDtoSchema }),
  z.object({
    type: z.literal('offer_withdrawn'),
    data: z.object({
      driver_id: uuidSchema,
      offer_id: uuidSchema.nullable().optional(),
      reason: z.enum(['superseded', 'driver_offline']).nullable().optional(),
    }),
  }),
  z.object({ type: z.literal('offer_expired'), data: offerExpiredDataSchema }),
  z.object({ type: z.literal('ride_status'), data: rideDtoSchema }),
]);

export const driverSocketMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('open_rides_snapshot'), data: openRidePageDtoSchema }),
  z.object({ type: z.literal('paused_rides_snapshot'), data: z.array(openRideDtoSchema) }),
  z.object({ type: z.literal('driver_offers_snapshot'), data: z.array(offerDtoSchema) }),
  z.object({ type: z.literal('ride_created'), data: openRideDtoSchema }),
  z.object({
    type: z.literal('ride_closed'),
    data: z.object({ ride_id: uuidSchema }),
  }),
  z.object({
    type: z.literal('ride_paused'),
    data: openRideDtoSchema.extend({ offer_id: uuidSchema }),
  }),
  z.object({ type: z.literal('offer_accepted'), data: rideDtoSchema }),
  z.object({ type: z.literal('offer_expired'), data: offerExpiredDataSchema }),
  z.object({
    type: z.literal('offer_rejected'),
    data: z.object({
      ride_id: uuidSchema,
      offer_id: uuidSchema.nullable(),
      reason: z.enum(['declined', 'ride_taken', 'ride_cancelled']),
    }),
  }),
  z.object({ type: z.literal('driver_active_ride'), data: rideDtoSchema }),
  z.object({
    type: z.literal('offers_withdrawn'),
    data: z.object({
      ride_ids: z.array(uuidSchema),
      reason: z.literal('driver_offline').nullable().optional(),
    }),
  }),
  z.object({ type: z.literal('ride_status'), data: rideDtoSchema }),
]);

export type PassengerSocketMessage = z.infer<typeof passengerSocketMessageSchema>;
export type DriverSocketMessage = z.infer<typeof driverSocketMessageSchema>;
