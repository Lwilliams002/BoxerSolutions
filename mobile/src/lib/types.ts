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

export interface CustomerPortalMe {
  id: string;
  first_name: string;
  last_name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  customer_type: string;
  balance: string | number;
  autopay_enabled: boolean;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
}

export interface CustomerPortalAppointment {
  id: string;
  scheduled_date: string;
  window_start: string;
  window_end: string;
  status: string;
  duration_minutes: number;
  notes: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  service_names: string;
}

export interface CustomerPortalInvoice {
  id: string;
  invoice_number: string;
  status: string;
  invoice_date: string;
  due_date: string;
  total: string | number;
  amount_paid: string | number;
  balance_due: string | number;
}

export interface CustomerPortalPayment {
  id: string;
  amount: string | number;
  status: string;
  receipt_number: string | null;
  processed_at: string | null;
  created_at: string;
  failure_reason: string | null;
  invoice_number: string | null;
}

export interface CustomerPortalServiceRequestFile {
  fileId: string;
  fileName: string;
  mimeType: string;
}

export interface CustomerPortalServiceRequest {
  id: string;
  description: string;
  status: 'submitted' | 'reviewed' | 'scheduled' | 'declined';
  quoted_price: string | number | null;
  owner_notes: string | null;
  requested_at: string;
  reviewed_at: string | null;
  assigned_technician_id: string | null;
  technician_first_name?: string | null;
  technician_last_name?: string | null;
  files: CustomerPortalServiceRequestFile[];
}

export interface OwnerServiceRequest {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  description: string;
  status: 'submitted' | 'reviewed' | 'scheduled' | 'declined';
  assigned_technician_id: string | null;
  quoted_price: string | number | null;
  owner_notes: string | null;
  requested_at: string;
  reviewed_at: string | null;
  technician_id?: string | null;
  technician_first_name?: string | null;
  technician_last_name?: string | null;
  files: CustomerPortalServiceRequestFile[];
}
