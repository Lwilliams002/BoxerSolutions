// backend/src/content/achAuthorizationTerms.ts
import { config } from '../config';

/**
 * ACH (Pay by Bank) authorization shown on every bank payment form. North's
 * Fields integration requires the integrator to display its own terms and
 * capture explicit consent before submitting an ACH debit.
 *
 * OWNER ACTION: this text comes from the owner's "Boxer ACH Authorization
 * Terms" document. Bump NORTH_ACH_TERMS_VERSION whenever it changes.
 */
export const ACH_TERMS_VERSION = config.north.achTermsVersion;

export const ACH_TERMS_TEXT = [
  'Pay by Bank (ACH) Authorization Terms — Boxer Solutions Pest Control',
  'By selecting Pay by Bank and submitting payment details, you authorize Boxer Solutions Pest Control ("Company") to initiate electronic debit entries (ACH) to the bank account you provide, and your financial institution to honor those entries.',
  '1. Authorization Scope\nYou authorize one-time and/or recurring debits for amounts due for services, invoices, fees, taxes, and applicable adjustments related to your account.',
  '2. Recurring Payments\nIf recurring billing is enabled, you authorize the Company to initiate ACH debits on scheduled billing dates for the amount then due. You will be notified of schedule or amount changes as required by law.',
  '3. Amount and Timing\nOne-time payments may be processed immediately or on the next banking day. Recurring payments are processed on or after the scheduled due date.',
  '4. Returned / Failed Payments\nIf a debit is returned or rejected (e.g., insufficient funds, account closed, invalid account), you authorize the Company to reattempt collection and to charge any lawful returned payment fee disclosed in your service agreement or invoice.',
  '5. Revocation of Authorization\nYou may revoke this ACH authorization by providing written notice to the Company at least 3 business days before the next scheduled debit. Revocation does not cancel amounts already owed.',
  '6. Billing Disputes\nIf you believe a debit was in error, contact the Company promptly at: service@boxersolutionspestcontrol.com | (512) 555-0142',
  '7. Account Information Accuracy\nYou represent that you are an authorized signer on the account and that all banking information provided is accurate and current.',
  '8. Record of Authorization\nYour electronic acceptance of these terms constitutes your written authorization under applicable ACH/NACHA rules and U.S. law.',
  '9. Cancellation of Services\nService cancellation does not void outstanding payment obligations for services already rendered or otherwise due under your agreement.',
  'This document is provided for informational and authorization purposes. For questions, contact us at service@boxersolutionspestcontrol.com or (512) 555-0142.',
].join('\n\n');
