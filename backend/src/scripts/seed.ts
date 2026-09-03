import bcrypt from 'bcryptjs';
import { pool, withTransaction } from '../config/db';
import { logger } from '../utils/logger';
import { paymentProvider } from '../integrations/payments';

const PERMS = [
  'customers:read', 'customers:read_assigned', 'customers:write', 'customers:delete',
  'services:read', 'services:write',
  'appointments:read', 'appointments:read_assigned', 'appointments:write', 'appointments:write_assigned',
  'routes:read', 'routes:read_assigned', 'routes:write',
  'invoices:read', 'invoices:read_assigned', 'invoices:write', 'invoices:write_assigned',
  'payments:read', 'payments:write', 'payments:collect', 'payments:collect_info',
  'files:read', 'files:write', 'notes:read', 'notes:write',
  'users:read', 'users:write', 'settings:read', 'settings:write', 'dashboard:read', 'reports:read',
];

const ROLE_PERMS: Record<string, string[]> = {
  OWNER: ['*'],
  TRUSTED_TECHNICIAN: [
    'customers:read_assigned', 'customers:write', 'appointments:read_assigned', 'appointments:write_assigned',
    'routes:read_assigned', 'invoices:read_assigned',
    'payments:read', 'payments:collect', 'payments:collect_info',
    'files:read', 'files:write', 'notes:write', 'notes:read', 'services:read',
  ],
  TECHNICIAN: [
    'customers:read_assigned', 'customers:write', 'appointments:read_assigned', 'appointments:write_assigned',
    'routes:read_assigned', 'invoices:read_assigned',
    'payments:read', 'payments:collect_info',
    'files:read', 'files:write', 'notes:write', 'notes:read', 'services:read',
  ],
};

// Austin, TX area coordinates for demo service locations
const LOCATIONS = [
  { addr: '123 Main Street', city: 'Austin', lat: 30.2672, lng: -97.7431 },
  { addr: '456 Oak Avenue', city: 'Austin', lat: 30.2849, lng: -97.7341 },
  { addr: '789 Cedar Lane', city: 'Round Rock', lat: 30.5083, lng: -97.6789 },
  { addr: '321 Elm Drive', city: 'Pflugerville', lat: 30.4394, lng: -97.62 },
  { addr: '654 Pecan Court', city: 'Austin', lat: 30.25, lng: -97.75 },
  { addr: '987 Willow Way', city: 'Cedar Park', lat: 30.5052, lng: -97.8203 },
  { addr: '147 Bluebonnet Blvd', city: 'Austin', lat: 30.3, lng: -97.7 },
  { addr: '258 Longhorn Loop', city: 'Georgetown', lat: 30.6333, lng: -97.6772 },
  { addr: '369 Mockingbird Mall', city: 'Austin', lat: 30.24, lng: -97.72 },
  { addr: '741 Armadillo Alley', city: 'Leander', lat: 30.5788, lng: -97.8531 },
];

const CUSTOMERS = [
  { first: 'John', last: 'Smith', company: null, type: 'residential' },
  { first: 'Maria', last: 'Garcia', company: null, type: 'residential' },
  { first: 'David', last: 'Chen', company: 'ABC Restaurant', type: 'commercial' },
  { first: 'Sarah', last: 'Johnson', company: null, type: 'residential' },
  { first: 'Robert', last: 'Williams', company: 'Williams Realty', type: 'commercial' },
  { first: 'Emily', last: 'Brown', company: null, type: 'residential' },
  { first: 'Michael', last: 'Davis', company: 'Davis Dental', type: 'commercial' },
  { first: 'Jessica', last: 'Miller', company: null, type: 'residential' },
  { first: 'James', last: 'Wilson', company: null, type: 'residential' },
  { first: 'Linda', last: 'Martinez', company: 'Casa Verde Cafe', type: 'commercial' },
];

const TECHS = [
  { first: 'Carlos', last: 'Ramirez', color: '#2563eb' },
  { first: 'Tony', last: 'Nguyen', color: '#16a34a' },
  { first: 'Marcus', last: 'Lee', color: '#ea580c' },
  { first: 'Danielle', last: 'Foster', color: '#9333ea' },
  { first: 'Kevin', last: "O'Brien", color: '#0891b2' },
];

const SERVICES = [
  { name: 'Monthly Pest Service', cat: 'Pest Control', price: 99, cost: 25, dur: 45, recurring: true },
  { name: 'Quarterly Pest Service', cat: 'Pest Control', price: 149, cost: 35, dur: 60, recurring: true },
  { name: 'Commercial Service', cat: 'Pest Control', price: 149, cost: 40, dur: 60, recurring: true },
  { name: 'Initial Treatment', cat: 'Pest Control', price: 199, cost: 50, dur: 90, recurring: false },
  { name: 'Termite Inspection', cat: 'Termite', price: 125, cost: 30, dur: 60, recurring: false },
  { name: 'Termite Treatment', cat: 'Termite', price: 899, cost: 300, dur: 240, recurring: false },
  { name: 'Mosquito Treatment', cat: 'Mosquito', price: 79, cost: 20, dur: 30, recurring: true },
  { name: 'Rodent Exclusion', cat: 'Rodent', price: 349, cost: 90, dur: 120, recurring: false },
  { name: 'Bait Station Refill', cat: 'Rodent', price: 45, cost: 12, dur: 20, recurring: false, svcType: 'material' },
  { name: 'Trip Fee', cat: 'Fees', price: 25, cost: 0, dur: 5, recurring: false, svcType: 'fee', taxable: false },
];

async function main() {
  const already = await pool.query("SELECT 1 FROM roles WHERE code = 'OWNER'");
  if (already.rows.length > 0) {
    logger.warn('Seed data already present; aborting (drop DB volume to reseed)');
    await pool.end();
    return;
  }

  await withTransaction(async (tx) => {
    // ---- Roles & permissions ----
    const permIds: Record<string, string> = {};
    for (const code of [...PERMS, '*']) {
      const r = await tx.query('INSERT INTO permissions (code) VALUES ($1) RETURNING id', [code]);
      permIds[code] = r.rows[0].id;
    }
    const roleIds: Record<string, string> = {};
    for (const [code, perms] of Object.entries(ROLE_PERMS)) {
      const r = await tx.query('INSERT INTO roles (code, name) VALUES ($1, $2) RETURNING id', [code, code.replace('_', ' ')]);
      roleIds[code] = r.rows[0].id;
      for (const p of perms) {
        await tx.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)', [r.rows[0].id, permIds[p]]);
      }
    }

    const hash = await bcrypt.hash('Demo1234!', 12);

    async function createUser(email: string, first: string, last: string, roles: string[], employee?: { color?: string; lat?: number; lng?: number; title?: string }) {
      const u = await tx.query(
        `INSERT INTO users (email, password_hash, first_name, last_name, phone) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [email, hash, first, last, '512-555-01' + String(Math.floor(Math.random() * 90) + 10)],
      );
      for (const rc of roles) {
        await tx.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)', [u.rows[0].id, roleIds[rc]]);
      }
      let employeeId: string | null = null;
      if (employee) {
        const e = await tx.query(
          `INSERT INTO employees (user_id, job_title, hire_date, home_base_lat, home_base_lng, color)
           VALUES ($1,$2,'2023-01-15',$3,$4,$5) RETURNING id`,
          [u.rows[0].id, employee.title ?? 'Service Technician', employee.lat ?? 30.2672, employee.lng ?? -97.7431, employee.color ?? null],
        );
        employeeId = e.rows[0].id;
      }
      return { userId: u.rows[0].id as string, employeeId };
    }

    // ---- Users ----
    const owner = await createUser('owner@antserve.dev', 'Olivia', 'Owner', ['OWNER'], { title: 'Owner' });

    const techIds: string[] = [];
    for (let i = 0; i < TECHS.length; i++) {
      const t = TECHS[i];
      const { employeeId } = await createUser(
        `tech${i + 1}@antserve.dev`, t.first, t.last, [i === 0 ? 'TRUSTED_TECHNICIAN' : 'TECHNICIAN'],
        { color: t.color, lat: 30.25 + i * 0.02, lng: -97.75 + i * 0.02 },
      );
      techIds.push(employeeId!);
    }

    // ---- Service catalog ----
    const catIds: Record<string, string> = {};
    const serviceIds: string[] = [];
    for (const s of SERVICES) {
      if (!catIds[s.cat]) {
        const c = await tx.query('INSERT INTO service_categories (name) VALUES ($1) RETURNING id', [s.cat]);
        catIds[s.cat] = c.rows[0].id;
      }
      const r = await tx.query(
        `INSERT INTO services (category_id, name, description, service_type, price, cost, duration_minutes, taxable, is_recurring)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [catIds[s.cat], s.name, `${s.name} — professional ${s.cat.toLowerCase()} service`, (s as any).svcType ?? 'labor',
         s.price, s.cost, s.dur, (s as any).taxable !== false, s.recurring],
      );
      serviceIds.push(r.rows[0].id);
    }

    // ---- Customers + locations + payment methods ----
    const custIds: string[] = [];
    const locIds: string[] = [];
    for (let i = 0; i < CUSTOMERS.length; i++) {
      const c = CUSTOMERS[i];
      const loc = LOCATIONS[i];
      const cr = await tx.query(
        `INSERT INTO customers (first_name, last_name, company, email, phone, customer_type, status,
           billing_address_line1, billing_city, billing_state, billing_postal_code, assigned_technician_id, autopay_enabled, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,'TX',$9,$10,$11,$12) RETURNING id`,
        [c.first, c.last, c.company, `${c.first.toLowerCase()}.${c.last.toLowerCase()}@example.com`,
         `512-555-1${String(i).padStart(3, '0')}`, c.type, loc.addr, loc.city,
         `787${String(i).padStart(2, '0')}`, techIds[i % techIds.length], i % 3 === 0, owner.userId],
      );
      custIds.push(cr.rows[0].id);
      const lr = await tx.query(
        `INSERT INTO service_locations (customer_id, label, address_line1, city, state, postal_code, latitude, longitude, is_primary)
         VALUES ($1,'Primary',$2,$3,'TX',$4,$5,$6,true) RETURNING id`,
        [cr.rows[0].id, loc.addr, loc.city, `787${String(i).padStart(2, '0')}`, loc.lat, loc.lng],
      );
      locIds.push(lr.rows[0].id);

      // demo payment method via provider test token (never real card data)
      const brands = ['visa', 'mastercard', 'amex'];
      const tokenized = await paymentProvider.attachPaymentMethod(`tok_${brands[i % 3]}_${4240 + i}`);
      const pm = await tx.query(
        `INSERT INTO payment_methods (customer_id, payment_provider, provider_payment_method_id, brand, last4, expiration_month, expiration_year, is_default)
         VALUES ($1,'mock',$2,$3,$4,$5,$6,true) RETURNING id`,
        [cr.rows[0].id, tokenized.providerPaymentMethodId, tokenized.brand, tokenized.last4, tokenized.expirationMonth, tokenized.expirationYear],
      );
      if (i % 3 === 0) {
        await tx.query(
          `INSERT INTO autopay_settings (customer_id, enabled, payment_method_id) VALUES ($1,true,$2)`,
          [cr.rows[0].id, pm.rows[0].id],
        );
      }
    }

    // ---- Appointments: 10 past completed, 12 today, 8 future ----
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const windows = [['08:00', '10:00'], ['09:30', '11:30'], ['11:00', '13:00'], ['13:00', '15:00'], ['15:00', '17:00']];
    const statusesToday = ['scheduled', 'scheduled', 'completed', 'in_progress', 'scheduled', 'en_route', 'scheduled', 'completed', 'scheduled', 'scheduled', 'cancelled', 'scheduled'];
    const apptIds: { id: string; customerIdx: number; status: string; date: string; techIdx: number }[] = [];

    let apptCount = 0;
    async function makeAppt(customerIdx: number, dayOffset: number, winIdx: number, status: string, svcIdx: number, techIdx: number) {
      const d = new Date(today);
      d.setDate(d.getDate() + dayOffset);
      const [ws, we] = windows[winIdx % windows.length];
      const extras: string[] = [];
      if (['completed'].includes(status)) extras.push(`started_at = now() - interval '2 hours'`, `completed_at = now() - interval '1 hour'`, `completed_by = '${techIds[techIdx]}'`);
      if (['in_progress'].includes(status)) extras.push(`started_at = now() - interval '30 minutes'`, `arrived_at = now() - interval '35 minutes'`);
      if (['en_route'].includes(status)) extras.push(`en_route_at = now() - interval '10 minutes'`);
      const r = await tx.query(
        `INSERT INTO appointments (customer_id, service_location_id, technician_id, scheduled_date, window_start, window_end, duration_minutes, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [custIds[customerIdx], locIds[customerIdx], techIds[techIdx], fmt(d), ws, we, SERVICES[svcIdx].dur, status, owner.userId],
      );
      if (extras.length) await tx.query(`UPDATE appointments SET ${extras.join(', ')} WHERE id = '${r.rows[0].id}'`);
      await tx.query(
        `INSERT INTO appointment_services (appointment_id, service_id, quantity, unit_price) VALUES ($1,$2,1,$3)`,
        [r.rows[0].id, serviceIds[svcIdx], SERVICES[svcIdx].price],
      );
      apptIds.push({ id: r.rows[0].id, customerIdx, status, date: fmt(d), techIdx });
      apptCount++;
      return r.rows[0].id;
    }

    // Past completed (last 2 weeks)
    for (let i = 0; i < 10; i++) {
      await makeAppt(i % 10, -(i + 2), i % 5, 'completed', i % 8, i % 5);
    }
    // Today
    for (let i = 0; i < 12; i++) {
      await makeAppt(i % 10, 0, i % 5, statusesToday[i], i % 8, i % 3);
    }
    // Future
    for (let i = 0; i < 8; i++) {
      await makeAppt(i % 10, i + 1, i % 5, 'scheduled', i % 8, i % 5);
    }
    logger.info({ apptCount }, 'appointments seeded');

    // ---- Routes: 3 routes for today (tech 0, 1, 2) ----
    for (let t = 0; t < 3; t++) {
      const rr = await tx.query(
        `INSERT INTO routes (route_date, technician_id, start_lat, start_lng, status)
         VALUES ($1,$2,$3,$4,'active') RETURNING id`,
        [fmt(today), techIds[t], 30.25 + t * 0.02, -97.75 + t * 0.02],
      );
      const todaysForTech = apptIds.filter((a) => a.date === fmt(today) && a.techIdx === t && a.status !== 'cancelled');
      for (let s = 0; s < todaysForTech.length; s++) {
        await tx.query(
          `INSERT INTO route_stops (route_id, appointment_id, stop_order) VALUES ($1,$2,$3)`,
          [rr.rows[0].id, todaysForTech[s].id, s + 1],
        );
      }
    }

    // ---- Invoices: 20 with varied statuses; payments on paid ones ----
    const completed = apptIds.filter((a) => a.status === 'completed');
    const invoiceStatuses = ['paid', 'paid', 'open', 'past_due', 'partially_paid', 'sent', 'paid', 'open', 'draft', 'paid'];
    let invNum = 0;
    for (let i = 0; i < 20; i++) {
      const appt = completed[i % completed.length];
      const svcIdx = i % 8;
      const price = SERVICES[svcIdx].price;
      const taxRate = 0.0825;
      const tax = Math.round(price * taxRate * 100) / 100;
      const total = Math.round((price + tax) * 100) / 100;
      const status = invoiceStatuses[i % invoiceStatuses.length];
      const isPaid = status === 'paid';
      const isPartial = status === 'partially_paid';
      const amountPaid = isPaid ? total : isPartial ? Math.round(total * 0.5 * 100) / 100 : 0;
      const dueOffset = status === 'past_due' ? -10 : 15;
      const due = new Date(today);
      due.setDate(due.getDate() + dueOffset);

      const inv = await tx.query(
        `INSERT INTO invoices (invoice_number, customer_id, service_location_id, appointment_id, technician_id,
           invoice_date, due_date, status, subtotal, tax_rate, tax_amount, total, amount_paid, paid_at, created_by)
         VALUES ($1,$2,$3,$4,$5,CURRENT_DATE - $6::int,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [`INV-${1000 + invNum++}`, custIds[appt.customerIdx], locIds[appt.customerIdx],
         i < completed.length ? appt.id : null, techIds[appt.techIdx], i % 14, fmt(due), status,
         price, taxRate, tax, total, amountPaid, isPaid ? new Date() : null, owner.userId],
      );
      await tx.query(
        `INSERT INTO invoice_items (invoice_id, service_id, description, quantity, unit_price, taxable, line_total)
         VALUES ($1,$2,$3,1,$4,true,$4)`,
        [inv.rows[0].id, serviceIds[svcIdx], SERVICES[svcIdx].name, price],
      );
      if (amountPaid > 0) {
        const pmRes = await tx.query('SELECT id FROM payment_methods WHERE customer_id = $1 LIMIT 1', [custIds[appt.customerIdx]]);
        await tx.query(
          `INSERT INTO payments (customer_id, invoice_id, payment_method_id, amount, status, payment_provider,
             provider_transaction_id, receipt_number, processed_at)
           VALUES ($1,$2,$3,$4,'succeeded','mock',$5,$6,now() - interval '1 day')`,
          [custIds[appt.customerIdx], inv.rows[0].id, pmRes.rows[0].id, amountPaid,
           `txn_seed_${i}`, `RCPT-${5000 + i}`],
        );
      }
      // outstanding balance on the customer
      await tx.query('UPDATE customers SET balance = balance + $1 WHERE id = $2', [total - amountPaid, custIds[appt.customerIdx]]);
    }
    // one failed payment for demo
    await tx.query(
      `INSERT INTO payments (customer_id, amount, status, payment_provider, failure_reason, processed_at)
       VALUES ($1, 99.00, 'failed', 'mock', 'Card declined', now())`,
      [custIds[1]],
    );

    await tx.query("SELECT setval('invoice_number_seq', 1100)");
    await tx.query("SELECT setval('receipt_number_seq', 5100)");

    // ---- Recurring subscriptions for 3 customers ----
    for (let i = 0; i < 3; i++) {
      const sr = await tx.query(
        `INSERT INTO subscriptions (customer_id, service_location_id, frequency, preferred_technician_id, preferred_time,
           start_date, next_generation_date, next_service_date, generate_ahead_days, status)
         VALUES ($1,$2,'monthly',$3,'09:00',CURRENT_DATE + 14, CURRENT_DATE + 14, CURRENT_DATE + 14, 30, 'active') RETURNING id`,
        [custIds[i], locIds[i], techIds[i % techIds.length]],
      );
      await tx.query(
        `INSERT INTO subscription_services (subscription_id, service_id, quantity) VALUES ($1,$2,1)`,
        [sr.rows[0].id, serviceIds[0]],
      );
    }

    // ---- Service notes ----
    const noteBodies = [
      'Treated perimeter and garage. Customer reports ant activity in kitchen — applied gel bait.',
      'Gate code is 4482. Beware of dog in backyard.',
      'Replaced two bait stations near the fence line.',
      'Customer prefers morning appointments.',
      'Heavy mosquito activity near pond; recommended monthly treatment.',
    ];
    for (let i = 0; i < completed.length; i++) {
      await tx.query(
        `INSERT INTO notes (customer_id, appointment_id, author_id, body) VALUES ($1,$2,$3,$4)`,
        [custIds[completed[i].customerIdx], completed[i].id, owner.userId, noteBodies[i % noteBodies.length]],
      );
    }

    await tx.query(`INSERT INTO settings (key, value) VALUES
      ('company', '{"companyName":"Boxer Solutions Pest Control","phone":"3057135011","address":"2500 Bee Cave Rd, Austin, TX 78746","licenseNumber":"TPCL-0099421","defaultTaxRate":0.0825}'),
      ('invoicing', '{"invoiceDueDays":15,"autoGenerateOnComplete":true}'),
      ('appointments', '{"appointmentReminderHours":24}')`);
  });

  logger.info('seed complete');
  await pool.end();
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
