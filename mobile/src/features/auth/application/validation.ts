/** Esquemas de validación de formularios de auth (zod). */
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().min(1, 'Ingresa tu correo').email('Correo inválido'),
  password: z.string().min(1, 'Ingresa tu contraseña'),
});

export const registerSchema = z.object({
  fullName: z.string().min(1, 'Ingresa tu nombre completo'),
  email: z.string().min(1, 'Ingresa tu correo').email('Correo inválido'),
  phone: z
    .string()
    .optional()
    .refine((v) => !v || /^[+\d][\d\s]{5,}$/.test(v), 'Teléfono inválido'),
  password: z.string().min(8, 'Mínimo 8 caracteres'),
  acceptTerms: z.boolean().refine((v) => v === true, 'Debes aceptar los términos'),
});

export type LoginForm = z.infer<typeof loginSchema>;
export type RegisterForm = z.infer<typeof registerSchema>;
