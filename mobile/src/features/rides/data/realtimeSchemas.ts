import { z, type ZodSafeParseResult } from 'zod';

import type {
  RealtimeEventMetadata,
  StreamCheckpoint,
} from '@/core/realtime/replayGate';
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

const offersSnapshotMessageSchema = z.object({
  type: z.literal('offers_snapshot'),
  data: z.array(offerDtoSchema),
});
const offerCreatedMessageSchema = z.object({
  type: z.literal('offer_created'),
  data: offerDtoSchema,
});
const offerWithdrawnMessageSchema = z.object({
  type: z.literal('offer_withdrawn'),
  data: z.object({
    driver_id: uuidSchema,
    offer_id: uuidSchema.nullable().optional(),
    reason: z.enum(['superseded', 'driver_offline']).nullable().optional(),
  }),
});
const offerExpiredMessageSchema = z.object({
  type: z.literal('offer_expired'),
  data: offerExpiredDataSchema,
});
const rideStatusMessageSchema = z.object({
  type: z.literal('ride_status'),
  data: rideDtoSchema,
});

const passengerEventMessageSchema = z.discriminatedUnion('type', [
  offerCreatedMessageSchema,
  offerWithdrawnMessageSchema,
  offerExpiredMessageSchema,
  rideStatusMessageSchema,
]);

export const passengerSocketMessageSchema = z.discriminatedUnion('type', [
  offersSnapshotMessageSchema,
  offerCreatedMessageSchema,
  offerWithdrawnMessageSchema,
  offerExpiredMessageSchema,
  rideStatusMessageSchema,
]);

const openRidesSnapshotMessageSchema = z.object({
  type: z.literal('open_rides_snapshot'),
  data: openRidePageDtoSchema,
});
const pausedRidesSnapshotMessageSchema = z.object({
  type: z.literal('paused_rides_snapshot'),
  data: z.array(openRideDtoSchema),
});
const driverOffersSnapshotMessageSchema = z.object({
  type: z.literal('driver_offers_snapshot'),
  data: z.array(offerDtoSchema),
});
const rideCreatedMessageSchema = z.object({
  type: z.literal('ride_created'),
  data: openRideDtoSchema,
});
const rideClosedMessageSchema = z.object({
  type: z.literal('ride_closed'),
  data: z
    .object({
      ride_id: uuidSchema,
      // Opcionales durante el despliegue; los productores nuevos siempre los emiten.
      pool_version: z.number().int().positive().optional(),
      reason: z.enum(['paused', 'terminal']).optional(),
    })
    .superRefine((data, context) => {
      if ((data.pool_version === undefined) !== (data.reason === undefined)) {
        context.addIssue({
          code: 'custom',
          message: 'ride_closed requiere pool_version y reason juntos.',
        });
      }
    }),
});
const ridePausedMessageSchema = z.object({
  type: z.literal('ride_paused'),
  data: openRideDtoSchema.extend({ offer_id: uuidSchema }),
});
const offerAcceptedMessageSchema = z.object({
  type: z.literal('offer_accepted'),
  data: rideDtoSchema,
});
const offerRejectedMessageSchema = z.object({
  type: z.literal('offer_rejected'),
  data: z.object({
    ride_id: uuidSchema,
    offer_id: uuidSchema.nullable(),
    reason: z.enum(['declined', 'ride_taken', 'ride_cancelled']),
  }),
});
const driverActiveRideMessageSchema = z.object({
  type: z.literal('driver_active_ride'),
  data: rideDtoSchema,
});
const offersWithdrawnMessageSchema = z.object({
  type: z.literal('offers_withdrawn'),
  data: z
    .object({
      ride_ids: z.array(uuidSchema),
      // Compatibilidad legacy: los productores nuevos añaden las identidades
      // exactas para no retirar una reoferta posterior del mismo ride.
      offers: z
        .array(
          z.object({
            ride_id: uuidSchema,
            offer_id: uuidSchema,
          }),
        )
        .optional(),
      reason: z.literal('driver_offline').nullable().optional(),
    })
    .superRefine((data, context) => {
      if (data.offers === undefined) return;
      const matchesExactly =
        data.ride_ids.length === data.offers.length &&
        data.ride_ids.every(
          (rideId, index) => rideId === data.offers?.[index]?.ride_id,
        );
      if (!matchesExactly) {
        context.addIssue({
          code: 'custom',
          message: 'ride_ids debe coincidir en orden con offers.',
          path: ['ride_ids'],
        });
      }
    }),
});

const driverEventMessageSchema = z.discriminatedUnion('type', [
  rideCreatedMessageSchema,
  rideClosedMessageSchema,
  ridePausedMessageSchema,
  offerAcceptedMessageSchema,
  offerExpiredMessageSchema,
  offerRejectedMessageSchema,
  offersWithdrawnMessageSchema,
  rideStatusMessageSchema,
]);

export const driverSocketMessageSchema = z.discriminatedUnion('type', [
  openRidesSnapshotMessageSchema,
  pausedRidesSnapshotMessageSchema,
  driverOffersSnapshotMessageSchema,
  rideCreatedMessageSchema,
  rideClosedMessageSchema,
  ridePausedMessageSchema,
  offerAcceptedMessageSchema,
  offerExpiredMessageSchema,
  offerRejectedMessageSchema,
  driverActiveRideMessageSchema,
  offersWithdrawnMessageSchema,
  rideStatusMessageSchema,
]);

const poolStreamSchema = z.enum(['pool:taxi', 'pool:moto', 'pool:delivery']);
const entityStreamSchema = z.string().refine((value) => {
  const [prefix, rawId, extra] = value.split(':');
  return (
    extra === undefined &&
    (prefix === 'ride' || prefix === 'driver') &&
    uuidSchema.safeParse(rawId).success
  );
}, 'Stream de tiempo real inválido.');
const streamSchema = z.union([poolStreamSchema, entityStreamSchema]);

const versionedEventMetadataSchema = z.object({
  schema_version: z.literal(2),
  kind: z.literal('event'),
  event_id: uuidSchema,
  batch_id: uuidSchema,
  // Durante el rolling deploy, el backend anterior todavía omite este campo.
  correlation_id: uuidSchema.optional(),
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  aggregate_type: z.enum(['ride', 'driver']),
  aggregate_id: uuidSchema,
  aggregate_version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  stream: streamSchema,
  stream_version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  occurred_at: z.string().datetime({ offset: true }),
});

const eventStreamPrefixes: Record<string, ReadonlySet<string>> = {
  ride_created: new Set(['pool']),
  ride_closed: new Set(['pool']),
  ride_paused: new Set(['driver']),
  offer_created: new Set(['ride']),
  offer_rejected: new Set(['driver']),
  offer_withdrawn: new Set(['ride']),
  offer_accepted: new Set(['driver']),
  offers_withdrawn: new Set(['driver']),
  offer_expired: new Set(['ride', 'driver']),
  ride_status: new Set(['ride', 'driver']),
};
const rideIdFieldByEvent: Record<string, string> = {
  ride_created: 'id',
  ride_closed: 'ride_id',
  ride_paused: 'id',
  offer_created: 'ride_id',
  offer_rejected: 'ride_id',
  offer_accepted: 'id',
  offer_expired: 'ride_id',
  ride_status: 'id',
};

type VersionedEventCandidate = {
  type: string;
  data: unknown;
  aggregate_type: 'ride' | 'driver';
  aggregate_id: string;
  stream: string;
};

function validateVersionedEventSemantics(
  event: VersionedEventCandidate,
  context: z.RefinementCtx,
): void {
  const [streamPrefix, streamId] = event.stream.split(':');
  if (!eventStreamPrefixes[event.type]?.has(streamPrefix)) {
    context.addIssue({
      code: 'custom',
      message: 'El tipo de evento no admite el stream indicado.',
      path: ['stream'],
    });
  }

  const expectedAggregateType = event.type === 'offers_withdrawn' ? 'driver' : 'ride';
  if (event.aggregate_type !== expectedAggregateType) {
    context.addIssue({
      code: 'custom',
      message: 'El agregado no coincide con el tipo de evento.',
      path: ['aggregate_type'],
    });
  }
  if (streamPrefix === event.aggregate_type && streamId !== event.aggregate_id) {
    context.addIssue({
      code: 'custom',
      message: 'El stream no coincide con el agregado.',
      path: ['stream'],
    });
  }

  const data = event.data as Record<string, unknown>;
  const rideIdField = rideIdFieldByEvent[event.type];
  if (
    event.aggregate_type === 'ride' &&
    rideIdField !== undefined &&
    data[rideIdField] !== event.aggregate_id
  ) {
    context.addIssue({
      code: 'custom',
      message: 'El payload no coincide con el agregado.',
      path: ['data', rideIdField],
    });
  }
  if (
    event.type === 'ride_created' &&
    event.stream !== `pool:${String(data.service_type)}`
  ) {
    context.addIssue({
      code: 'custom',
      message: 'El servicio del payload no coincide con el pool.',
      path: ['stream'],
    });
  }
  if (event.type === 'ride_closed') {
    if (data.pool_version === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'ride_closed v2 requiere pool_version.',
        path: ['data', 'pool_version'],
      });
    }
    if (data.reason === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'ride_closed v2 requiere reason.',
        path: ['data', 'reason'],
      });
    }
  }
  if (
    event.type === 'offers_withdrawn' &&
    data.offers === undefined
  ) {
    context.addIssue({
      code: 'custom',
      message: 'offers_withdrawn v2 requiere offers.',
      path: ['data', 'offers'],
    });
  }
}

function fingerprintRealtimePayload(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('El payload realtime no puede contener números no finitos.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(fingerprintRealtimePayload).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(
        ([key, entry]) =>
          `${JSON.stringify(key)}:${fingerprintRealtimePayload(entry)}`,
      )
      .join(',')}}`;
  }
  throw new Error('El payload realtime contiene un valor no serializable.');
}

export const passengerVersionedEventSchema = z.intersection(
  versionedEventMetadataSchema,
  passengerEventMessageSchema,
).superRefine(validateVersionedEventSemantics);
export const driverVersionedEventSchema = z.intersection(
  versionedEventMetadataSchema,
  driverEventMessageSchema,
).superRefine(validateVersionedEventSemantics);

export const streamWatermarkSchema = z.object({
  stream: streamSchema,
  stream_version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
const streamWatermarksSchema = z
  .array(streamWatermarkSchema)
  .min(1)
  .superRefine((watermarks, context) => {
    const seen = new Set<string>();
    watermarks.forEach((watermark, index) => {
      if (seen.has(watermark.stream)) {
        context.addIssue({
          code: 'custom',
          message: 'El snapshot repite un stream.',
          path: [index, 'stream'],
        });
      }
      seen.add(watermark.stream);
    });
  });

const versionedSnapshotMetadataSchema = z.object({
  schema_version: z.literal(2),
  kind: z.literal('snapshot'),
  snapshot_id: uuidSchema,
  captured_at: z.string().datetime({ offset: true }),
  watermarks: streamWatermarksSchema,
});

export const rideVersionedSnapshotSchema = versionedSnapshotMetadataSchema.extend({
  type: z.literal('ride_snapshot'),
  data: z
    .object({
      ride: rideDtoSchema,
      offers: z.array(offerDtoSchema),
    })
    .superRefine((data, context) => {
      data.offers.forEach((offer, index) => {
        if (offer.ride_id !== data.ride.id) {
          context.addIssue({
            code: 'custom',
            message: 'La oferta no pertenece al ride del snapshot.',
            path: ['offers', index, 'ride_id'],
          });
        }
      });
    }),
}).superRefine((snapshot, context) => {
  const expectedStream = `ride:${snapshot.data.ride.id}`;
  if (
    snapshot.watermarks.length !== 1 ||
    snapshot.watermarks[0]?.stream !== expectedStream
  ) {
    context.addIssue({
      code: 'custom',
      message: 'El snapshot requiere exactamente el watermark del ride.',
      path: ['watermarks'],
    });
  }
});

export const driverVersionedSnapshotSchema = versionedSnapshotMetadataSchema.extend({
  type: z.literal('driver_snapshot'),
  data: z.object({
    open_rides: openRidePageDtoSchema,
    paused_rides: z.array(openRideDtoSchema),
    offers: z.array(offerDtoSchema),
    active_ride: rideDtoSchema.nullable(),
  }),
}).superRefine((snapshot, context) => {
  const streams = new Set(snapshot.watermarks.map(({ stream }) => stream));
  const driverStreams = [...streams].filter((stream) => stream.startsWith('driver:'));
  const vehiclePools = [...streams].filter(
    (stream) => stream === 'pool:taxi' || stream === 'pool:moto',
  );
  if (
    streams.size !== 3 ||
    driverStreams.length !== 1 ||
    vehiclePools.length !== 1 ||
    !streams.has('pool:delivery')
  ) {
    context.addIssue({
      code: 'custom',
      message: 'El snapshot requiere los streams del conductor, delivery y su vehículo.',
      path: ['watermarks'],
    });
    return;
  }

  const driverId = driverStreams[0]?.slice('driver:'.length);
  const vehicleService = vehiclePools[0]?.slice('pool:'.length);
  const allowedServices = new Set([vehicleService, 'delivery']);
  const visibleRides = [
    ...snapshot.data.open_rides.items,
    ...snapshot.data.paused_rides,
    ...(snapshot.data.active_ride === null ? [] : [snapshot.data.active_ride]),
  ];
  visibleRides.forEach((ride, index) => {
    if (!allowedServices.has(ride.service_type)) {
      context.addIssue({
        code: 'custom',
        message: 'El ride no pertenece a los pools declarados por el snapshot.',
        path: ['data', 'rides', index, 'service_type'],
      });
    }
  });
  snapshot.data.offers.forEach((offer, index) => {
    if (offer.driver.id !== driverId) {
      context.addIssue({
        code: 'custom',
        message: 'La oferta no pertenece al conductor del snapshot.',
        path: ['data', 'offers', index, 'driver', 'id'],
      });
    }
  });
  if (
    snapshot.data.active_ride !== null &&
    snapshot.data.active_ride.driver?.id !== driverId
  ) {
    context.addIssue({
      code: 'custom',
      message: 'El ride activo no pertenece al conductor del snapshot.',
      path: ['data', 'active_ride', 'driver', 'id'],
    });
  }
});

export const versionedSocketSnapshotSchema = z.discriminatedUnion('type', [
  rideVersionedSnapshotSchema,
  driverVersionedSnapshotSchema,
]);
export const versionedSocketEventSchema = z.union([
  passengerVersionedEventSchema,
  driverVersionedEventSchema,
]);

export const passengerVersionedSocketMessageSchema = z.union([
  passengerVersionedEventSchema,
  rideVersionedSnapshotSchema,
]);
export const driverVersionedSocketMessageSchema = z.union([
  driverVersionedEventSchema,
  driverVersionedSnapshotSchema,
]);

const V2_KEYS = new Set([
  'schema_version',
  'kind',
  'event_id',
  'batch_id',
  'correlation_id',
  'sequence',
  'aggregate_type',
  'aggregate_id',
  'aggregate_version',
  'stream',
  'stream_version',
  'occurred_at',
  'snapshot_id',
  'captured_at',
  'watermarks',
]);

function hasVersionedKey(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.keys(value).some((key) => V2_KEYS.has(key));
}

type SocketWireMessage = { type: string; data: unknown };
type MessageSchema<T extends SocketWireMessage> = {
  safeParse: (value: unknown) => ZodSafeParseResult<T>;
};

/**
 * Elige el protocolo antes de validar. Si aparece cualquier clave reservada de
 * v2, el frame debe satisfacer v2 completo y nunca puede caer al parser legacy.
 */
function createDualMessageParser<
  TLegacy extends SocketWireMessage,
  TVersioned extends SocketWireMessage,
>(
  legacySchema: MessageSchema<TLegacy>,
  versionedSchema: MessageSchema<TVersioned>,
): MessageSchema<TLegacy | TVersioned> {
  return {
    safeParse(value: unknown): ZodSafeParseResult<TLegacy | TVersioned> {
      return hasVersionedKey(value)
        ? versionedSchema.safeParse(value)
        : legacySchema.safeParse(value);
    },
  };
}

export const passengerRealtimeMessageParser = createDualMessageParser(
  passengerSocketMessageSchema,
  passengerVersionedSocketMessageSchema,
);
export const driverRealtimeMessageParser = createDualMessageParser(
  driverSocketMessageSchema,
  driverVersionedSocketMessageSchema,
);

export type PassengerSocketMessage = z.infer<typeof passengerSocketMessageSchema>;
export type DriverSocketMessage = z.infer<typeof driverSocketMessageSchema>;
export type VersionedSocketEvent = z.infer<typeof versionedSocketEventSchema>;
export type VersionedSocketSnapshot = z.infer<typeof versionedSocketSnapshotSchema>;
export type StreamWatermark = z.infer<typeof streamWatermarkSchema>;
export type PassengerVersionedSocketMessage = z.infer<
  typeof passengerVersionedSocketMessageSchema
>;
export type DriverVersionedSocketMessage = z.infer<
  typeof driverVersionedSocketMessageSchema
>;
export type PassengerRealtimeMessage =
  | PassengerSocketMessage
  | PassengerVersionedSocketMessage;
export type DriverRealtimeMessage =
  | DriverSocketMessage
  | DriverVersionedSocketMessage;
export type RealtimeSocketMessage = PassengerRealtimeMessage | DriverRealtimeMessage;
export type VersionedSocketMessage = VersionedSocketEvent | VersionedSocketSnapshot;

export function isVersionedSocketMessage(
  message: RealtimeSocketMessage,
): message is VersionedSocketMessage {
  return 'schema_version' in message && message.schema_version === 2;
}

export function toReplayEventMetadata(
  message: VersionedSocketEvent,
): RealtimeEventMetadata {
  return {
    eventId: message.event_id,
    batchId: message.batch_id,
    correlationId: message.correlation_id ?? message.batch_id,
    sequence: message.sequence,
    eventType: message.type,
    aggregateType: message.aggregate_type,
    aggregateId: message.aggregate_id,
    aggregateVersion: message.aggregate_version,
    stream: message.stream,
    streamVersion: message.stream_version,
    occurredAt: message.occurred_at,
    payloadFingerprint: fingerprintRealtimePayload({
      type: message.type,
      data: message.data,
    }),
  };
}

export function toReplayStreamCheckpoints(
  message: VersionedSocketSnapshot,
): StreamCheckpoint[] {
  return message.watermarks.map((watermark) => ({
    stream: watermark.stream,
    version: watermark.stream_version,
  }));
}
