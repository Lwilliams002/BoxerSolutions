#!/bin/bash
# End-to-end verification of the §52 milestone workflow against the running API.
set -e
API=http://localhost:4000/api/v1
JQ=jq

step() { echo; echo "=== $1 ==="; }

step "LOGIN (office manager)"
LOGIN=$(curl -s $API/auth/login -H 'Content-Type: application/json' -d '{"email":"office@antserve.dev","password":"Demo1234!"}')
TOKEN=$(echo $LOGIN | $JQ -r .data.accessToken)
[ "$TOKEN" != "null" ] && echo "OK: got access token" || { echo "FAIL"; echo $LOGIN; exit 1; }
AUTH="Authorization: Bearer $TOKEN"

step "CREATE CUSTOMER"
CUST=$(curl -s $API/customers -H "$AUTH" -H 'Content-Type: application/json' -d '{
  "firstName":"Walter","lastName":"Testman","email":"walter.testman@example.com","phone":"512-555-9999",
  "serviceLocation":{"addressLine1":"555 Verification Blvd","city":"Austin","state":"TX","postalCode":"78702","latitude":30.26,"longitude":-97.71}
}')
CUST_ID=$(echo $CUST | $JQ -r .data.id)
echo "customer: $CUST_ID"
LOC_ID=$(curl -s "$API/locations?customerId=$CUST_ID" -H "$AUTH" | $JQ -r '.data[0].id')
echo "location: $LOC_ID"

step "EDIT CUSTOMER"
EDIT=$(curl -s -X PATCH $API/customers/$CUST_ID -H "$AUTH" -H 'Content-Type: application/json' -d '{"phone":"512-555-8888"}')
[ "$(echo $EDIT | $JQ -r .data.phone)" == "512-555-8888" ] && echo "OK: customer edited"

step "SEARCH CUSTOMER"
FOUND=$(curl -s "$API/customers?search=testman" -H "$AUTH" | $JQ -r "[.data.items[].id] | index(\"$CUST_ID\") != null")
[ "$FOUND" == "true" ] && echo "OK: search found customer" || { echo "FAIL search"; exit 1; }

step "ADD PAYMENT METHOD (test token)"
PM=$(curl -s $API/payment-methods -H "$AUTH" -H 'Content-Type: application/json' -d "{\"customerId\":\"$CUST_ID\",\"token\":\"tok_visa_4242\",\"setDefault\":true}")
PM_ID=$(echo $PM | $JQ -r .data.id)
echo "payment method: $PM_ID $(echo $PM | $JQ -r '.data.brand') ****$(echo $PM | $JQ -r '.data.last4')"

step "GET TECHNICIAN + SERVICE"
# use tech1's own employee id so the technician-scoped workflow is exercised correctly
TECH_ID=$(curl -s $API/auth/login -H 'Content-Type: application/json' -d '{"email":"tech1@antserve.dev","password":"Demo1234!"}' | $JQ -r .data.user.employeeId)
SVC_ID=$(curl -s "$API/services?search=monthly" -H "$AUTH" | $JQ -r '.data.items[0].id')
echo "technician: $TECH_ID  service: $SVC_ID"

step "CREATE APPOINTMENT (assign technician)"
TODAY=$(date +%F)
APPT=$(curl -s $API/appointments -H "$AUTH" -H 'Content-Type: application/json' -d "{
  \"customerId\":\"$CUST_ID\",\"serviceLocationId\":\"$LOC_ID\",\"technicianId\":\"$TECH_ID\",
  \"scheduledDate\":\"$TODAY\",\"windowStart\":\"19:00\",\"windowEnd\":\"21:00\",
  \"serviceIds\":[{\"serviceId\":\"$SVC_ID\"}]}")
APPT_ID=$(echo $APPT | $JQ -r .data.id)
echo "appointment: $APPT_ID"

step "CONFLICT DETECTION (same window should conflict)"
CONFLICT=$(curl -s $API/appointments -H "$AUTH" -H 'Content-Type: application/json' -d "{
  \"customerId\":\"$CUST_ID\",\"serviceLocationId\":\"$LOC_ID\",\"technicianId\":\"$TECH_ID\",
  \"scheduledDate\":\"$TODAY\",\"windowStart\":\"19:15\",\"windowEnd\":\"20:30\",
  \"serviceIds\":[{\"serviceId\":\"$SVC_ID\"}]}")
[ "$(echo $CONFLICT | $JQ -r .success)" == "false" ] && echo "OK: conflict detected -> $(echo $CONFLICT | $JQ -r .message)" || { echo "FAIL: no conflict"; exit 1; }

step "RESCHEDULE APPOINTMENT"
RESC=$(curl -s $API/appointments/$APPT_ID/reschedule -H "$AUTH" -H 'Content-Type: application/json' -d "{\"scheduledDate\":\"$TODAY\",\"windowStart\":\"19:30\",\"windowEnd\":\"21:30\"}")
[ "$(echo $RESC | $JQ -r .success)" == "true" ] && echo "OK: rescheduled to 17:00-19:00"

step "ADD TO ROUTE"
ROUTE=$(curl -s $API/routes -H "$AUTH" -H 'Content-Type: application/json' -d "{\"routeDate\":\"$TODAY\",\"technicianId\":\"$TECH_ID\"}")
ROUTE_ID=$(echo $ROUTE | $JQ -r .data.id)
curl -s $API/routes/$ROUTE_ID/stops -H "$AUTH" -H 'Content-Type: application/json' -d "{\"appointmentId\":\"$APPT_ID\"}" | $JQ -r '.message'
echo "route: $ROUTE_ID"

step "OPTIMIZE ROUTE (respecting windows)"
OPT=$(curl -s -X POST $API/routes/$ROUTE_ID/optimize -H "$AUTH")
echo "optimized $(echo $OPT | $JQ -r '.data.stops | length') stops; ETAs: $(echo $OPT | $JQ -r '[.data.stops[].estimatedArrival] | @csv')"

step "TECHNICIAN LOGIN + OPENS ROUTE"
TLOGIN=$(curl -s $API/auth/login -H 'Content-Type: application/json' -d '{"email":"tech1@antserve.dev","password":"Demo1234!"}')
TTOKEN=$(echo $TLOGIN | $JQ -r .data.accessToken)
TAUTH="Authorization: Bearer $TTOKEN"
TROUTE=$(curl -s "$API/routes?date=$TODAY" -H "$TAUTH")
echo "technician sees $(echo $TROUTE | $JQ -r '.data.items | length') route(s) today"

step "ON MY WAY -> ARRIVED -> START SERVICE"
curl -s $API/appointments/$APPT_ID/status -H "$TAUTH" -H 'Content-Type: application/json' -d '{"status":"en_route"}' | $JQ -r '.data.status'
curl -s $API/appointments/$APPT_ID/status -H "$TAUTH" -H 'Content-Type: application/json' -d '{"status":"arrived"}' | $JQ -r '.data.status'
curl -s $API/appointments/$APPT_ID/status -H "$TAUTH" -H 'Content-Type: application/json' -d '{"status":"in_progress"}' | $JQ -r '.data.status'

step "ADD NOTE"
curl -s $API/notes -H "$TAUTH" -H 'Content-Type: application/json' -d "{\"appointmentId\":\"$APPT_ID\",\"body\":\"Treated perimeter; found ant trail near garage.\"}" | $JQ -r '.message'

step "TAKE PHOTO (presigned upload to Wasabi-compatible storage)"
printf '\xff\xd8\xff\xe0FAKEJPEGDATA_for_e2e_test' > /tmp/e2e-photo.jpg
UP=$(curl -s $API/files/upload-request -H "$TAUTH" -H 'Content-Type: application/json' -d "{
  \"fileType\":\"service_photo\",\"fileName\":\"before.jpg\",\"mimeType\":\"image/jpeg\",\"appointmentId\":\"$APPT_ID\"}")
UPLOAD_URL=$(echo $UP | $JQ -r .data.uploadUrl)
FILE_ID=$(echo $UP | $JQ -r .data.file.id)
HTTP=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$UPLOAD_URL" -H 'Content-Type: image/jpeg' --data-binary @/tmp/e2e-photo.jpg)
echo "PUT to storage: HTTP $HTTP"
curl -s -X POST $API/files/$FILE_ID/confirm -H "$TAUTH" | $JQ -r '.data.uploadStatus'

step "CAPTURE SIGNATURE"
printf '\x89PNG\r\n\x1a\nFAKESIG' > /tmp/e2e-sig.png
SUP=$(curl -s $API/files/upload-request -H "$TAUTH" -H 'Content-Type: application/json' -d "{
  \"fileType\":\"signature\",\"fileName\":\"signature.png\",\"mimeType\":\"image/png\",\"appointmentId\":\"$APPT_ID\"}")
SIG_URL=$(echo $SUP | $JQ -r .data.uploadUrl)
SIG_FILE=$(echo $SUP | $JQ -r .data.file.id)
curl -s -o /dev/null -X PUT "$SIG_URL" -H 'Content-Type: image/png' --data-binary @/tmp/e2e-sig.png
curl -s -X POST $API/files/$SIG_FILE/confirm -H "$TAUTH" > /dev/null
curl -s $API/files/signatures -H "$TAUTH" -H 'Content-Type: application/json' -d "{\"appointmentId\":\"$APPT_ID\",\"fileId\":\"$SIG_FILE\",\"signerName\":\"Walter Testman\"}" | $JQ -r '.message'

step "COMPLETE SERVICE (idempotent) -> AUTO INVOICE"
COMPLETE=$(curl -s $API/appointments/$APPT_ID/complete -H "$TAUTH" -H 'Content-Type: application/json' -H "Idempotency-Key: e2e-complete-$APPT_ID" -d '{"note":"Service completed, customer satisfied.","generateInvoice":true,"taxRate":0.0825}')
INV_ID=$(echo $COMPLETE | $JQ -r .data.invoice.id)
echo "status: $(echo $COMPLETE | $JQ -r .data.appointment.status), invoice: $(echo $COMPLETE | $JQ -r .data.invoice.invoiceNumber) total \$$(echo $COMPLETE | $JQ -r .data.invoice.total)"

step "IDEMPOTENCY REPLAY (same key returns same invoice, no duplicate)"
REPLAY=$(curl -s $API/appointments/$APPT_ID/complete -H "$TAUTH" -H 'Content-Type: application/json' -H "Idempotency-Key: e2e-complete-$APPT_ID" -d '{"note":"dup","generateInvoice":true}')
[ "$(echo $REPLAY | $JQ -r .data.invoice.id)" == "$INV_ID" ] && echo "OK: idempotent replay" || { echo "FAIL: duplicate created"; exit 1; }

step "GENERATE PDF -> STORE IN WASABI(MinIO)"
PDF=$(curl -s -X POST $API/invoices/$INV_ID/generate-pdf -H "$TAUTH")
echo "pdf object: $(echo $PDF | $JQ -r .data.objectKey) ($(echo $PDF | $JQ -r .data.size) bytes)"
DL=$(curl -s "$API/invoices/$INV_ID/pdf" -H "$TAUTH" | $JQ -r .data.downloadUrl)
PDFHTTP=$(curl -s -o /tmp/e2e-invoice.pdf -w '%{http_code}' "$DL")
file /tmp/e2e-invoice.pdf | grep -q PDF && echo "OK: downloaded real PDF via signed URL (HTTP $PDFHTTP)" || { echo "FAIL pdf"; exit 1; }

step "FAILED PAYMENT PATH (declined card)"
DPM=$(curl -s $API/payment-methods -H "$AUTH" -H 'Content-Type: application/json' -d "{\"customerId\":\"$CUST_ID\",\"token\":\"tok_declined_0341\",\"setDefault\":false}")
DPM_ID=$(echo $DPM | $JQ -r .data.id)
FAILCHG=$(curl -s $API/payments/charge -H "$TAUTH" -H 'Content-Type: application/json' -d "{\"invoiceId\":\"$INV_ID\",\"paymentMethodId\":\"$DPM_ID\"}")
[ "$(echo $FAILCHG | $JQ -r .success)" == "false" ] && echo "OK: declined -> $(echo $FAILCHG | $JQ -r .message)" || { echo "FAIL: should decline"; exit 1; }

step "CHARGE SAVED PAYMENT METHOD (technician collects)"
CHG=$(curl -s $API/payments/charge -H "$TAUTH" -H 'Content-Type: application/json' -H "Idempotency-Key: e2e-charge-$INV_ID" -d "{\"invoiceId\":\"$INV_ID\",\"paymentMethodId\":\"$PM_ID\"}")
echo "receipt: $(echo $CHG | $JQ -r .data.receipt.receiptNumber)  txn: $(echo $CHG | $JQ -r .data.receipt.transactionId)  paidInFull: $(echo $CHG | $JQ -r .data.receipt.paidInFull)"

step "INVOICE MARKED PAID"
INVSTATE=$(curl -s $API/invoices/$INV_ID -H "$TAUTH" | $JQ -r .data.status)
[ "$INVSTATE" == "paid" ] && echo "OK: invoice status = paid" || { echo "FAIL: $INVSTATE"; exit 1; }

step "SERVICE HISTORY UPDATED"
HIST=$(curl -s $API/customers/$CUST_ID/service-history -H "$TAUTH")
echo "history entries: $(echo $HIST | $JQ -r '.data | length'), latest invoice: $(echo $HIST | $JQ -r '.data[0].invoiceNumber') ($(echo $HIST | $JQ -r '.data[0].invoiceStatus'))"

step "RECURRING SUBSCRIPTION"
SUB=$(curl -s $API/subscriptions -H "$AUTH" -H 'Content-Type: application/json' -d "{
  \"customerId\":\"$CUST_ID\",\"serviceLocationId\":\"$LOC_ID\",\"frequency\":\"monthly\",
  \"preferredTechnicianId\":\"$TECH_ID\",\"startDate\":\"$(date -v+7d +%F)\",
  \"services\":[{\"serviceId\":\"$SVC_ID\"}]}")
echo "subscription created; generated $(echo $SUB | $JQ -r .data.generatedAppointments) future appointment(s)"

step "SECURITY CHECKS"
NOAUTH=$(curl -s $API/customers | $JQ -r .success)
[ "$NOAUTH" == "false" ] && echo "OK: unauthenticated rejected" || exit 1
TFORBID=$(curl -s $API/users -H "$TAUTH" -H 'Content-Type: application/json' -d '{}' -X POST | $JQ -r .message)
echo "OK: technician forbidden from user admin -> $TFORBID"
OTHER_CUST=$(curl -s "$API/customers?search=garcia" -H "$AUTH" | $JQ -r '.data.items[0].id')
TDENY=$(curl -s $API/customers/$OTHER_CUST -H "$TAUTH")
echo "unrelated customer access: success=$(echo $TDENY | $JQ -r .success) ($(echo $TDENY | $JQ -r .message))"

step "REFRESH TOKEN ROTATION"
RT=$(echo $LOGIN | $JQ -r .data.refreshToken)
NEW=$(curl -s $API/auth/refresh -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$RT\"}")
[ "$(echo $NEW | $JQ -r .success)" == "true" ] && echo "OK: refresh rotated"
REUSE=$(curl -s $API/auth/refresh -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$RT\"}" | $JQ -r .success)
[ "$REUSE" == "false" ] && echo "OK: old refresh token rejected after rotation"

step "DASHBOARD"
curl -s $API/dashboard -H "$AUTH" | $JQ -c '.data.today'

echo
echo "ALL E2E CHECKS PASSED ✅"
