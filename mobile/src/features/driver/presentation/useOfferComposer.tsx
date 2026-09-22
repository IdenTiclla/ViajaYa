import { StyleSheet, Text, View } from 'react-native';

import { getApiErrorMessage, getApiErrorStatus } from '@/core/errors/apiError';
import { fontSize, radius, spacing, useEstilos, type Tema } from '@/core/theme';
import { useConcurrentOffers } from '../application/useConcurrentOffers';
import { Button } from '@/shared/components';

/** Nonblocking feedback lets other negotiations continue during GPS and HTTP. */
export function useOfferComposer() {
  const offers = useConcurrentOffers();
  const { styles } = useEstilos(createStyles);
  return {
    ...offers,
    offerFeedback: offers.failures.length > 0 ? (
      <View style={styles.errors}>
        {offers.failures.map(({ input, callbacks, error }) => (
          <View key={input.rideId} style={styles.error} accessibilityLiveRegion="polite">
            <Text style={styles.message}>{input.riderName ? `${input.riderName}: ` : ''}{getApiErrorMessage(error, error.message)}</Text>
            <View style={styles.actions}>
              {getApiErrorStatus(error) !== 409 && (
                <Button title="Reintentar oferta" variant="secondary" onPress={() => offers.mutate(input, callbacks)} />
              )}
              <Button title="Cerrar" variant="secondary" onPress={() => offers.dismissError(input.rideId)} />
            </View>
          </View>
        ))}
      </View>
    ) : null,
  };
}

const createStyles = ({ colors }: Tema) => StyleSheet.create({
  errors: { gap: spacing.xs, paddingHorizontal: spacing.sm },
  error: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm, gap: spacing.xs },
  message: { color: colors.danger, fontSize: fontSize.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
