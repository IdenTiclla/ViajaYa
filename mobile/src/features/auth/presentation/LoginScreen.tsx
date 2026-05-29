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
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { colors, fontSize, fontWeight, spacing } from '@/core/theme';
import { useLogin } from '@/features/auth/application/useAuth';
import { useSocialAuth } from '@/features/auth/application/useSocialAuth';
import { type LoginForm, loginSchema } from '@/features/auth/application/validation';
import { BrandHeader } from '@/features/auth/presentation/BrandHeader';
import { Button, Divider, SocialButton, TextField } from '@/shared/components';

export function LoginScreen() {
  const login = useLogin();
  const social = useSocialAuth({
    onError: (message) => Alert.alert('No se pudo iniciar sesión', message),
  });
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = (values: LoginForm) => {
    // El gate de navegación redirige solo al cambiar el estado de sesión.
    login.mutate(values, {
      onError: (error) => Alert.alert('No se pudo iniciar sesión', getApiErrorMessage(error)),
    });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <BrandHeader subtitle="Tu ciudad, a un toque de distancia." />

          <View style={styles.form}>
            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextField
                  leadingIcon="mail-outline"
                  placeholder="Correo electrónico"
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
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextField
                  leadingIcon="lock-closed-outline"
                  placeholder="Contraseña"
                  password
                  value={value}
                  onBlur={onBlur}
                  onChangeText={onChange}
                  error={errors.password?.message}
                />
              )}
            />

            <TouchableOpacity
              style={styles.forgot}
              onPress={() => Alert.alert('Próximamente', 'Recuperación de contraseña en camino.')}>
              <Text style={styles.forgotText}>¿Olvidaste tu contraseña?</Text>
            </TouchableOpacity>

            <Button
              title="Iniciar Sesión"
              trailingIcon="arrow-forward"
              loading={login.isPending}
              onPress={handleSubmit(onSubmit)}
            />

            <Divider label="O continúa con" />

            <SocialButton
              provider="google"
              loading={social.googleLoading}
              disabled={social.googleDisabled}
              onPress={social.signInWithGoogle}
            />
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>¿No tienes cuenta? </Text>
            <Link href="/(auth)/register" style={styles.link}>
              Crea una
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
  form: { gap: spacing.md },
  forgot: { alignSelf: 'flex-end' },
  forgotText: { color: colors.primary, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  footerText: { color: colors.textSecondary, fontSize: fontSize.sm },
  link: { color: colors.primary, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
});
