import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { controles, fontSize, fontWeight, radius, spacing, useEstilos, type Tema } from '@/core/theme';
import { SERVICE_META } from '@/features/booking/domain/serviceCatalog';
import { formatBolivianos } from '../domain/money';
import type { Ride } from '../domain/types';

/** The agreed trip remains readable during pickup, travel and closing. */
export function TripSummary({ ride, compact = false, showCurrentPlace = true }: {
  ride: Ride; compact?: boolean; showCurrentPlace?: boolean;
}) {
  const { colors, styles, estiloFoco } = useEstilos(createStyles);
  const [expanded, setExpanded] = useState(false);
  const [focused, setFocused] = useState(false);
  const atDestination = ride.status === 'in_progress' || ride.status === 'completed';
  const currentPlace = atDestination ? ride.destination : ride.origin;
  return (
    <View style={[styles.card, compact && styles.compact]}>
      <View style={styles.header}>
        <View style={styles.service}>
          <Ionicons accessible={false} name={SERVICE_META[ride.service].icon} size={20} color={colors.primary} />
          <Text style={styles.serviceText}>{SERVICE_META[ride.service].label}</Text>
        </View>
        <View style={[styles.price, compact && styles.compactPrice]}>
          {!compact && <Text style={styles.label}>{ride.status === 'searching' ? 'Precio propuesto' : 'Precio acordado'}</Text>}
          <Text style={styles.priceText} accessibilityLabel={`${ride.status === 'searching' ? 'Precio propuesto' : 'Precio acordado'}: ${formatBolivianos(ride.acceptedPrice ?? ride.fare)} bolivianos`}>
            Bs {formatBolivianos(ride.acceptedPrice ?? ride.fare)}
          </Text>
          {compact && <Text style={styles.label}>{ride.payment === 'qr' ? 'Pago con QR' : 'En efectivo'}</Text>}
        </View>
      </View>
      {compact && !expanded ? showCurrentPlace && <View style={styles.place}>
        <Text style={styles.label}>{atDestination ? 'Destino del viaje' : 'Punto de recogida'}</Text>
        <Text style={styles.value}>{currentPlace.name}</Text>
        {!!currentPlace.address && currentPlace.address !== currentPlace.name && <Text style={styles.address}>{currentPlace.address}</Text>}
      </View> : <>
      <View style={styles.place}>
        <Text style={styles.label}>Recogida</Text>
        <Text style={styles.value}>{ride.origin.name}</Text>
        {!!ride.origin.address && ride.origin.address !== ride.origin.name && <Text style={styles.address}>{ride.origin.address}</Text>}
      </View>
      <View style={styles.place}>
        <Text style={styles.label}>Destino</Text>
        <Text style={styles.value}>{ride.destination.name}</Text>
        {!!ride.destination.address && ride.destination.address !== ride.destination.name && <Text style={styles.address}>{ride.destination.address}</Text>}
      </View>
      <Text style={styles.payment}>Pago acordado: {ride.payment === 'qr' ? 'QR' : 'Efectivo'}</Text>
      </>}
      {compact && <Pressable accessibilityRole="button" accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? 'Ocultar detalles del viaje' : 'Ver ruta y detalles del viaje'}
        onPress={() => setExpanded(value => !value)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={({ pressed }) => [styles.detailsButton, pressed && styles.pressed, focused && estiloFoco]}>
        <Text style={styles.detailsLabel}>{expanded ? 'Ocultar detalles' : 'Ver ruta y detalles'}</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.primary} />
      </Pressable>}
    </View>
  );
}

const createStyles = ({ colors }: Tema) => StyleSheet.create({
  card: { padding: spacing.md, gap: spacing.md, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  compact: { padding: spacing.sm, gap: spacing.sm },
  compactPrice: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  detailsButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: controles.altoMinimo, gap: spacing.sm },
  detailsLabel: { flexShrink: 1, fontSize: fontSize.sm, color: colors.primary, fontWeight: fontWeight.medium },
  pressed: { opacity: 0.65 },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  service: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, maxWidth: '100%' },
  serviceText: { flexShrink: 1, fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.primary },
  price: { gap: spacing.xs },
  label: { fontSize: fontSize.sm, color: colors.textSecondary },
  priceText: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  place: { gap: spacing.xs },
  value: { fontSize: fontSize.md, fontWeight: fontWeight.medium, color: colors.text },
  address: { fontSize: fontSize.sm, color: colors.textSecondary },
  payment: { fontSize: fontSize.sm, color: colors.textSecondary },
});
