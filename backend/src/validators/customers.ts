import { z } from 'zod';

export const createCustomerSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  company: z.string().max(200).nullish(),
  email: z.string().email().nullish(),
  phone: z.string().max(30).nullish(),
  customerType: z.enum(['residential', 'commercial']).default('residential'),
  status: z.enum(['active', 'inactive', 'lead']).default('active'),
  billingAddressLine1: z.string().max(200).nullish(),
  billingAddressLine2: z.string().max(200).nullish(),
  billingCity: z.string().max(100).nullish(),
  billingState: z.string().max(50).nullish(),
  billingPostalCode: z.string().max(20).nullish(),
  assignedTechnicianId: z.string().uuid().nullish(),
  autopayEnabled: z.boolean().default(false),
  notes: z.string().nullish(),
  serviceLocation: z
    .object({
      label: z.string().default('Primary'),
      addressLine1: z.string().min(1),
      addressLine2: z.string().nullish(),
      city: z.string().min(1),
      state: z.string().min(1),
      postalCode: z.string().min(1),
      latitude: z.number().nullish(),
      longitude: z.number().nullish(),
      accessNotes: z.string().nullish(),
    })
    .optional(),
});

export const updateCustomerSchema = createCustomerSchema.partial().omit({ serviceLocation: true });

export const createLocationSchema = z.object({
  customerId: z.string().uuid(),
  label: z.string().default('Primary'),
  addressLine1: z.string().min(1),
  addressLine2: z.string().nullish(),
  city: z.string().min(1),
  state: z.string().min(1),
  postalCode: z.string().min(1),
  latitude: z.number().nullish(),
  longitude: z.number().nullish(),
  accessNotes: z.string().nullish(),
  isPrimary: z.boolean().default(false),
});

export const updateLocationSchema = createLocationSchema.partial().omit({ customerId: true });
