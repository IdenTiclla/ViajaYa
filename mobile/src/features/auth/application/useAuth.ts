/**
 * Hooks de auth: envuelven las acciones del `authStore` en mutaciones de
 * react-query para exponer estados de carga/error a la UI.
 */
import { useMutation } from '@tanstack/react-query';

import { useAuthStore } from '@/store/authStore';
import type { LoginPayload, RegisterPayload } from '@/features/auth/domain/types';

export function useLogin() {
  const signIn = useAuthStore((s) => s.signIn);
  return useMutation({ mutationFn: (payload: LoginPayload) => signIn(payload) });
}

export function useRegister() {
  const signUp = useAuthStore((s) => s.signUp);
  return useMutation({ mutationFn: (payload: RegisterPayload) => signUp(payload) });
}
