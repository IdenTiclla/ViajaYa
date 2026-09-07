import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { formatBolivianos } from '@/features/rides/domain/money';
import type { OfferTag } from '@/features/rides/domain/offerTags';
import type { Offer } from '@/features/rides/domain/types';
import { OfferLifeTimer } from '@/features/rides/presentation/OfferLifeTimer';
import { Button } from '@/shared/components';

type Props = {
  offer: Offer;
  tag: OfferTag | null;
  now: number;
  acceptingId: string | null;
  decisionsLocked: boolean;
  onAccept: () => void;
  onReject: () => void;
};

const VEHICULOS = { taxi: 'Taxi', moto: 'Moto' } as const;

/** Separa identidad, precio, llegada y vencimiento para comparar las ofertas. */
export function TarjetaOferta({
  offer, tag, now, acceptingId, decisionsLocked, onAccept, onReject,
}: Props) {
  const { fontScale } = useWindowDimensions();
  const { driver } = offer;
  const segundos = offer.expiresAt == null
    ? null
    : Math.max(0, Math.ceil((Date.parse(offer.expiresAt) - now) / 1000));
  const vencida = segundos === 0;
  const aceptando = acceptingId === offer.id;
  const bloqueada = decisionsLocked || vencida;
  const enColumna = fontScale > 1.3;
  const vehiculo = [
    driver.vehicleType && VEHICULOS[driver.vehicleType], driver.vehicleModel, driver.plate,
  ].filter(Boolean).join(' · ');

  return (
    <View style={styles.tarjeta}>
      <View style={styles.cabecera}>
        {!enColumna && (
          <View style={styles.avatar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Text style={styles.inicial}>{driver.fullName.trim().charAt(0).toUpperCase() || 'C'}</Text>
          </View>
        )}
        <View style={styles.identidad}>
          <Text style={styles.nombre}>{driver.fullName}</Text>
          {vehiculo ? <Text style={styles.vehiculo}>{vehiculo}</Text> : null}
        </View>
      </View>

      <View style={styles.indicadores}>
        <View style={styles.valoracion} accessible accessibilityLabel={driver.rating == null ? 'Sin calificaciones todavía' : `Calificación: ${driver.rating.toFixed(1)} de 5 estrellas`}>
          <Ionicons accessible={false} name="star" size={14} color={colors.primary} />
          <Text style={styles.textoIndicador}>{driver.rating == null ? 'Sin calificaciones' : `${driver.rating.toFixed(1)} de 5`}</Text>
        </View>
        {tag && (
          <View style={styles.etiqueta}>
            <Ionicons accessible={false} name={tag.kind === 'cheapest' ? 'pricetag-outline' : tag.kind === 'fastest' ? 'time-outline' : 'star-outline'} size={14} color={colors.primary} />
            <Text style={styles.textoEtiqueta}>{tag.subLabel}</Text>
          </View>
        )}
      </View>

      <View style={[styles.condiciones, enColumna && styles.columna]}>
        <View style={styles.dato}>
          <Text style={styles.rotulo}>Precio total</Text>
          <Text style={styles.precio}>Bs {formatBolivianos(offer.price)}</Text>
        </View>
        <View style={styles.dato}>
          <Text style={styles.rotulo}>Llegada estimada</Text>
          <Text style={styles.llegada}>{offer.etaMin == null ? 'Sin estimación' : `${offer.etaMin} min`}</Text>
        </View>
      </View>

      <OfferLifeTimer secondsLeft={segundos} label="Oferta vence en" />

      <View style={[styles.acciones, enColumna && styles.columna]}>
        <Button
          title="Descartar"
          variant="secondary"
          onPress={onReject}
          disabled={bloqueada}
          accessibilityLabel={`Descartar oferta de ${driver.fullName}`}
          style={!enColumna && styles.accion}
        />
        <Button
          title={vencida ? 'Oferta vencida' : 'Aceptar'}
          onPress={onAccept}
          disabled={bloqueada}
          loading={aceptando}
          loadingLabel="Aceptando…"
          accessibilityLabel={`Aceptar oferta de ${driver.fullName} por Bs ${formatBolivianos(offer.price)}`}
          style={!enColumna && styles.accion}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tarjeta: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  cabecera: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.primarioSuave, justifyContent: 'center', alignItems: 'center' },
  inicial: { fontSize: fontSize.md, color: colors.primary, fontWeight: fontWeight.bold },
  identidad: { flex: 1, minWidth: 0, gap: spacing.xs },
  nombre: { fontSize: fontSize.md, color: colors.text, fontWeight: fontWeight.semibold },
  vehiculo: { fontSize: fontSize.sm, color: colors.textSecondary },
  indicadores: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  valoracion: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  textoIndicador: { flexShrink: 1, fontSize: fontSize.sm, color: colors.textSecondary },
  etiqueta: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, backgroundColor: colors.primarioSuave, borderRadius: radius.sm },
  textoEtiqueta: { flexShrink: 1, fontSize: fontSize.xs, color: colors.primary, fontWeight: fontWeight.semibold },
  condiciones: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  dato: { flexShrink: 1, gap: spacing.xs },
  rotulo: { fontSize: fontSize.xs, color: colors.textSecondary },
  precio: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.primary },
  llegada: { fontSize: fontSize.md, color: colors.text, fontWeight: fontWeight.semibold },
  acciones: { flexDirection: 'row', gap: spacing.sm },
  columna: { flexDirection: 'column' },
  accion: { flex: 1 },
});
