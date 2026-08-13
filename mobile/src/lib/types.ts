export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message: string | null;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: string[];
  employeeId: string | null;
}

export interface CustomerSummary {
  id: string;
  firstName: string;
  lastName: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  customerType: string;
  balance: string | number;
  autopayEnabled?: boolean;
}

export interface ServiceLocation {
  id: string;
  label: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
}

export interface Appointment {
  id: string;
  customerId: string;
  customerName?: string;
  locationId: string;
  technicianId: string | null;
  technicianName?: string;
  status: AppointmentStatus;
  scheduledDate: string;
  windowStart: string;
  windowEnd: string;
  durationMinutes: number;
  notes?: string | null;
  addressLine1?: string;
  city?: string;
  services?: { serviceId: string; name: string; price: string | number; quantity: number }[];
  invoiceId?: string | null;
}

export type AppointmentStatus =
  | 'scheduled'
  | 'en_route'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_access'
  | 'rescheduled';

export interface RouteStop {
  id: string;
  routeId: string;
  appointmentId: string;
  sequence: number;
  status: string;
  estimatedArrival: string | null;
  customerName?: string;
  addressLine1?: string;
  city?: string;
  latitude?: number | null;
  longitude?: number | null;
  windowStart?: string;
  windowEnd?: string;
  appointmentStatus?: AppointmentStatus;
  serviceNames?: string;
  total?: string | number;
}

export interface RouteInfo {
  id: string;
  name: string;
  routeDate: string;
  technicianId: string;
  technicianName?: string;
  status: string;
  stops?: RouteStop[];
  stopCount?: number;
  completedCount?: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName?: string;
  status: string;
  invoiceDate: string;
  dueDate: string;
  subtotal: string | number;
  taxAmount: string | number;
  total: string | number;
  amountPaid: string | number;
  balanceDue: string | number;
  items?: InvoiceItem[];
  pdfFileId?: string | null;
}

export interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: string | number;
  lineTotal: string | number;
}

export interface PaymentMethod {
  id: string;
  brand: string;
  last4: string;
  expirationMonth: number;
  expirationYear: number;
  isDefault: boolean;
}

export interface ServiceItem {
  id: string;
  name: string;
  description: string | null;
  price: string | number;
  durationMinutes: number;
  categoryName?: string;
  isRecurring?: boolean;
}

export interface DashboardData {
  appointments: number;
  completedStops: number;
  remainingStops: number;
  cancelled: number;
  routes: number;
  paymentsCollected: number;
  failedPayments: number;
  revenueInvoiced: number;
  outstandingInvoices?: number;
  pastDueInvoices?: number;
  upcomingAppointments?: number;
}

export interface Note {
  id: string;
  body: string;
  noteType: string;
  createdAt: string;
  authorName?: string;
}
