# Schedule & Routes improvements — design

Approved scope (owner, 2026-09-09): everything from the review except the Google Routes optimizer.

## 1. Recurring visits appear on the schedule automatically

- New column `appointments.recurring_charge_id` (FK to `recurring_charges`).
- Hourly job `scheduleRecurringVisits`: for every active recurring charge whose `next_due_date` is within the next 7 days and has no linked, non-cancelled appointment for that date, create one:
  - customer's primary service location;
  - technician = customer's assigned technician, else the technician whose territory polygon contains the pin, else unassigned;
  - window = the customer's last completed visit's start time, else 09:00; duration 60 minutes;
  - notes "Recurring service · <frequency>".
- Rescheduling or reassigning the visit in the app keeps the link; cancelling it leaves the plan due (a new visit is created on the next run only if the due date moves).
- Completing a linked visit: create the invoice for the recurring amount (one line, no tax), charge the default payment method as a merchant-initiated sale when Company Settings → "Charge recurring service on completion" is on (default on), advance `next_due_date` one interval, and send the service notification email. Failures leave the invoice open and notify the office, same as the manual Charge button.

## 2. "Needs scheduling" strip on the Schedule tab

- `GET /appointments/needs-scheduling` returns (a) upcoming appointments in the next 14 days with no technician and (b) active recurring plans due within 14 days that have no upcoming linked visit (for example the customer has no service location or no coordinates).
- Shown as a horizontal strip above the day board with a count; each card has "Schedule" (opens New Appointment pre-filled) or "Assign" (opens the reassign sheet).

## 3. Drag to reschedule on the day board

- Long-press a block, drag vertically to change the start time (15-minute snap) or across lanes to change the technician. On release the app confirms and calls the existing reschedule endpoint, including the conflict-override flow. Works with mouse on web via the responder system. The existing sheet remains as the fallback.

## 4. Status at a glance

- Day-board blocks and week-view rows color their left edge by status (scheduled grey, en route amber, arrived/in progress teal, completed green with a check, cancelled/no access muted with strikethrough).

## 5. Web-safe dialogs

- Every `Alert.alert` in schedule, appointment creation, route builder, route detail and stop screens moves to `confirmAction`/`notify` so confirmations work on the web build.

## 6. Build routes automatically

- `POST /routes/build` with `{ date, technicianId? }` creates a route per technician for that date from their scheduled appointments not already on a route, adds the stops, and runs the existing optimizer. Idempotent: existing routes gain missing stops only.
- The daily job runs it at 05:00 local for the current day. Routes tab gets a "Build today's routes" button for users with routes:write.

## 7. Unrouted appointments visible

- `GET /appointments/unrouted?from&to` lists scheduled appointments with a technician but no route stop. The Routes tab shows a per-day badge and an "Add to route" action; the appointment sheet on the Schedule tab gets "Add to today's route".

## 9. Live progress

- Routes list refetches every 60 seconds while on screen.

## 10. Products used

- Tables `products` (name, unit, epa_registration_no, default_quantity, active) and `appointment_products` (appointment_id, product_id, quantity, unit, application_method, target_pests, applied_by, created_at).
- Admin screen More → Products (settings:write) to maintain the catalog; seeded with the common list (e.g. Suspend SC, Max Force Bait, Termidor SC, Talstar P, Advion Gel, Alpine WSG).
- Stop screen: "Products used" section with a picker, quantity/unit and application method (Crack & Crevice, Perimeter, Bait Stations, Broadcast, Spot, Fogging). Saved with the completion call and editable until the day ends.
- Service Notification email gains the Products Used table; the PDF service report uses the same data.

## 11. Service report on completion

- Completing any appointment emails the customer a Service Notification immediately (technician, times, products, comments, invoice items when an invoice was generated). Payment emails continue as today.

## Testing

- Unit: which plans need a visit (date math, existing links), point-in-polygon technician lookup, route build selection, products total lines, email rendering with products.
- Integration on EC2: run the jobs once, confirm visits/routes exist for the test customer, complete a visit and verify invoice, charge, next due date and email.

## Rollout order

5 → 1 → 2 → 6/7/9 → 4 → 3 → 10 → 11.
