import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { fontSize, fontWeight, radius, spacing, useEstilos, type ModoTema, type Tema } from '@/core/theme';
import { usePreferenciaTema } from '@/core/theme/usePreferenciaTema';
import { Button } from '@/shared/components';

const OPCIONES = [
  { modo: 'light', titulo: 'Claro', detalle: 'Predeterminado', icono: 'sunny-outline' },
  { modo: 'dark', titulo: 'Oscuro', detalle: 'Fondos oscuros', icono: 'moon-outline' },
] as const;

/** The same preference is available in both roles' profiles. */
export function SelectorTema() {
  const { colors, styles, estiloFoco } = useEstilos(crearEstilos);
  const { modo, elegir, cargado, guardando, error } = usePreferenciaTema();
  const { fontScale } = useWindowDimensions();
  const [enfocado, setEnfocado] = useState<ModoTema | null>(null);
  const enColumna = fontScale > 1.3;

  return (
    <View style={styles.seccion}>
      <Text accessibilityRole="header" style={styles.titulo}>Apariencia</Text>
      <Text style={styles.ayuda}>Elige el tema de ViajaYa en este teléfono.</Text>
      <View style={[styles.opciones, enColumna && styles.columna]} accessibilityRole="radiogroup" accessibilityLabel="Tema de la aplicación">
        {OPCIONES.map((opcion) => {
          const seleccionado = modo === opcion.modo;
          return (
            <Pressable
              key={opcion.modo}
              onPress={() => { void elegir(opcion.modo); }}
              disabled={!cargado || guardando}
              onFocus={() => setEnfocado(opcion.modo)}
              onBlur={() => setEnfocado(null)}
              accessibilityRole="radio"
              accessibilityLabel={`Tema ${opcion.titulo.toLowerCase()}`}
              accessibilityHint={opcion.modo === 'light' ? 'Tema predeterminado de ViajaYa.' : 'Usa fondos oscuros en la aplicación.'}
              accessibilityState={{ checked: seleccionado, disabled: !cargado || guardando }}
              aria-checked={seleccionado}
              style={({ pressed }) => [
                styles.opcion,
                !enColumna && styles.opcionEnFila,
                seleccionado && styles.seleccionada,
                pressed && styles.pulsada,
                enfocado === opcion.modo && estiloFoco,
              ]}>
              <View style={styles.iconos}>
                <Ionicons accessible={false} name={opcion.icono} size={24} color={seleccionado ? colors.primary : colors.textSecondary} />
                <Ionicons accessible={false} name={seleccionado ? 'radio-button-on' : 'radio-button-off'} size={20} color={seleccionado ? colors.primary : colors.bordeControl} />
              </View>
              <Text style={styles.nombre}>{opcion.titulo}</Text>
              <Text style={styles.detalle}>{opcion.detalle}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.ayuda} accessibilityLiveRegion="polite">
        {!cargado ? 'Cargando tu preferencia…' : guardando ? 'Guardando tema…' : error ? 'Puedes seguir usando este tema.' : 'Se conserva al volver a abrir la app.'}
      </Text>
      {error && (
        <View style={styles.error}>
          <Text style={styles.textoError} accessibilityRole="alert">{error}</Text>
          <Button title="Guardar tema de nuevo" variant="secondary" disabled={guardando} onPress={() => { void elegir(modo); }} />
        </View>
      )}
    </View>
  );
}

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  seccion: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.lg },
  titulo: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.text },
  ayuda: { fontSize: fontSize.sm, color: colors.textSecondary },
  opciones: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
  columna: { flexDirection: 'column' },
  opcion: { minHeight: 96, gap: spacing.xs, padding: spacing.md, borderWidth: 1, borderColor: colors.bordeControl, borderRadius: radius.md, backgroundColor: colors.surface },
  opcionEnFila: { flex: 1, minWidth: 0 },
  seleccionada: { borderColor: colors.primary, backgroundColor: colors.primarioSuave },
  pulsada: { opacity: 0.85 },
  iconos: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  nombre: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  detalle: { color: colors.textSecondary, fontSize: fontSize.xs },
  error: { gap: spacing.sm },
  textoError: { color: colors.danger, fontSize: fontSize.sm },
});
