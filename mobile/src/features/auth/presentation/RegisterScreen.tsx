import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { colors, fontSize, fontWeight, spacing } from '@/core/theme';
import { useRegister } from '@/features/auth/application/useAuth';
import { useSocialAuth } from '@/features/auth/application/useSocialAuth';
import { type RegisterForm, registerSchema } from '@/features/auth/application/validation';
import { Button, Checkbox, Divider, SocialButton, TextField } from '@/shared/components';

export function RegisterScreen() {
  const register = useRegister();
  const social = useSocialAuth({
    onError: (message) => Alert.alert('No se pudo crear la cuenta', message),
  });
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { fullName: '', email: '', phone: '', password: '', acceptTerms: false },
  });

  const onSubmit = (values: RegisterForm) => {
    register.mutate(
      {
        fullName: values.fullName,
        email: values.email,
        password: values.password,
        phone: values.phone || undefined,
      },
      { onError: (error) => Alert.alert('No se pudo crear la cuenta', getApiErrorMessage(error)) },
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.title}>Crea tu cuenta</Text>
            <Text style={styles.subtitle}>
              Únete a la red de transporte más confiable de la ciudad.
            </Text>
          </View>

          <View style={styles.form}>
            <Controller
              control={control}
              name="fullName"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextField
                  label="Nombre completo"
                  leadingIcon="person-outline"
                  placeholder="Ej. Alex Walker"
                  value={value}
                  onBlur={onBlur}
                  onChangeText={onChange}
                  error={errors.fullName?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextField
                  label="Correo electrónico"
                  leadingIcon="mail-outline"
                  placeholder="alex@ejemplo.com"
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  value={value}
                  onBlur={onBlur}
                  onChangeText={onChange}
                  error={errors.email?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="phone"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextField
                  label="Número de teléfono"
                  leadingIcon="call-outline"
                  placeholder="+591 600 000 000"
                  keyboardType="phone-pad"
                  value={value}
                  onBlur={onBlur}
                  onChangeText={onChange}
                  error={errors.phone?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextField
                  label="Contraseña"
                  leadingIcon="lock-closed-outline"
                  placeholder="Mínimo 8 caracteres"
                  password
                  value={value}
                  onBlur={onBlur}
                  onChangeText={onChange}
                  error={errors.password?.message}
                />
              )}
            />

            <Controller
              control={control}
              name="acceptTerms"
              render={({ field: { onChange, value } }) => (
                <Checkbox checked={value} onChange={onChange} error={errors.acceptTerms?.message}>
                  Acepto los Términos de Servicio y la Política de Privacidad de TaxiGo.
                </Checkbox>
              )}
            />

            <Button
              title="Crear Cuenta"
              trailingIcon="arrow-forward"
              loading={register.isPending}
              onPress={handleSubmit(onSubmit)}
            />

            <Divider label="O continúa con" />

            <View style={styles.social}>
              <SocialButton
                provider="google"
                loading={social.googleLoading}
                disabled={social.googleDisabled}
                onPress={social.signInWithGoogle}
              />
              <SocialButton
                provider="facebook"
                loading={social.facebookLoading}
                disabled={social.facebookDisabled}
                onPress={social.signInWithFacebook}
              />
            </View>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>¿Ya tienes una cuenta? </Text>
            <Link href="/(auth)/login" style={styles.link}>
              Inicia sesión
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg, flexGrow: 1, justifyContent: 'center' },
  header: { gap: spacing.xs, alignItems: 'center' },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
  form: { gap: spacing.md },
  social: { flexDirection: 'row', gap: spacing.md },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  footerText: { color: colors.textSecondary, fontSize: fontSize.sm },
  link: { color: colors.primary, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
});
