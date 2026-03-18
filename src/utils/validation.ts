import { z } from 'zod';

export const registerSchema = z.object({
  firstName: z.string().min(2, 'First name must be at least 2 characters'),
  lastName: z.string().min(2, 'Last name must be at least 2 characters'),
  email: z.string().email('Invalid email address').transform(e => e.toLowerCase().trim()),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain uppercase')
    .regex(/[0-9]/, 'Must contain number')
    .regex(/[^A-Za-z0-9]/, 'Must contain special character'),
  company: z.string().min(2, 'Company name is required'),
  designation: z.string().min(2, 'Designation is required'),
  phone: z.string().regex(/^07[0-9]{8}$/, 'Enter a valid Sri Lankan mobile number (e.g. 0771234567)'),
  address: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address').transform(e => e.toLowerCase().trim()),
  password: z.string().min(1, 'Password is required'),
});

export const verifyOtpSchema = z.object({
  email: z.string().email('Invalid email address').transform(e => e.toLowerCase().trim()),
  otp: z.string().length(6, 'OTP must be 6 digits'),
});

export const resendOtpSchema = z.object({
  email: z.string().email('Invalid email address').transform(e => e.toLowerCase().trim()),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address').transform(e => e.toLowerCase().trim()),
});

export const resetPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
  otp: z.string().length(6, 'OTP must be 6 digits'),
  newPassword: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain uppercase')
    .regex(/[0-9]/, 'Must contain number')
    .regex(/[^A-Za-z0-9]/, 'Must contain special character'),
});

export const inviteUserSchema = z.object({
  email: z.string().email('Invalid email address').transform(e => e.toLowerCase().trim()),
  firstName: z.string().min(2, 'First name must be at least 2 characters'),
  lastName: z.string().min(2, 'Last name must be at least 2 characters'),
  role: z.enum(['ADMIN', 'JUDGE']),
});

export const acceptInviteSchema = z.object({
  token: z.string().uuid('Invalid invitation link'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain uppercase')
    .regex(/[0-9]/, 'Must contain number')
    .regex(/[^A-Za-z0-9]/, 'Must contain special character'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type ResendOtpInput = z.infer<typeof resendOtpSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type InviteUserInput = z.infer<typeof inviteUserSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

// Reusable contact sub-schema
const contactSchema = z.object({
  full_name: z.string().min(2),
  designation: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(7),
});

// Base application object schema (without refinements)
const applicationBaseSchema = z.object({
  application_type: z.enum(['INDIVIDUAL', 'TEAM_COMPANY']),
  experience_years: z.number().int().min(0).max(60).optional(),
  company_name: z.string().min(2),
  founded_year: z.number().int().min(1800).max(new Date().getFullYear()).optional(),
  company_email: z.string().email(),
  company_phone: z.string().min(7),
  company_size: z.enum([
    'SIZE_1_50',
    'SIZE_51_200',
    'SIZE_201_500',
    'SIZE_501_1000',
    'SIZE_1001_5000',
    'SIZE_5000_PLUS',
  ]).optional(),
  company_website: z.string().url().optional().or(z.literal("")),
  linkedin_profile: z.string().url().optional().or(z.literal("")),
  company_address: z.string().optional(),
  category_id: z.string().uuid(),
  ceo_contact: contactSchema.optional(),
  hr_head_contact: contactSchema.optional(),
  primary_contact: contactSchema.optional(),
  secondary_contact: contactSchema.optional(),
  declaration_agreed: z.boolean().optional(),
});

// DRAFT schema — includes years-of-experience refinement
export const applicationDraftSchema = applicationBaseSchema.superRefine((data, ctx) => {
  if (data.application_type === 'INDIVIDUAL' && data.experience_years === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['experience_years'],
      message: 'Required for individual applications',
    });
  }
});

// SUBMIT schema — stricter; all critical fields required
export const applicationSubmitSchema = applicationBaseSchema.extend({
  ceo_contact: contactSchema,
  primary_contact: contactSchema,
  declaration_agreed: z.literal(true, {
    message: 'Declaration must be accepted',
  }),
}).superRefine((data, ctx) => {
  if (data.application_type === 'INDIVIDUAL' && data.experience_years === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['experience_years'],
      message: 'Required for individual applications',
    });
  }
});

// Admin status transition
export const applicationStatusSchema = z.object({
  status: z.enum(['UNDER_REVIEW', 'SHORTLISTED', 'AWARDED', 'REJECTED']),
  reviewer_notes: z.string().optional(),
});

// Award category create/update
export const awardCategorySchema = z.object({
  name: z.string().min(3),
  description: z.string().optional(),
  app_type: z.enum(['INDIVIDUAL', 'TEAM_COMPANY']),
  is_active: z.boolean().optional(),
  display_order: z.number().int().min(0).optional(),
});

export type ApplicationDraftInput = z.infer<typeof applicationDraftSchema>;
export type ApplicationStatusInput = z.infer<typeof applicationStatusSchema>;
export type AwardCategoryInput = z.infer<typeof awardCategorySchema>;
