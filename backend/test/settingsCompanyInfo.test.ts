import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPhone, splitAddressLines, toCompanyInfo, LICENSE_PLACEHOLDER } from '../src/services/settingsService';

test('blank license prints as dashes, otherwise the number', () => {
  const blank = toCompanyInfo({ companyName: 'Boxer', phone: '3057135011', email: '', address: '', licenseNumber: '  ' });
  assert.equal(blank.license, `License #: ${LICENSE_PLACEHOLDER}`);
  assert.equal(blank.licenseNumber, '');
  const set = toCompanyInfo({ companyName: 'Boxer', phone: '3057135011', email: '', address: '', licenseNumber: 'JB500216' });
  assert.equal(set.license, 'License #: JB500216');
});

test('phone and address are formatted for documents', () => {
  assert.equal(formatPhone('3057135011'), '(305) 713-5011');
  assert.equal(formatPhone('+1 305-713-5011'), '(305) 713-5011');
  assert.equal(formatPhone('ext 12'), 'ext 12');
  assert.deepEqual(splitAddressLines('20560 NW 17th Ave, Miami Gardens, FL 33056'), ['20560 NW 17th Ave', 'Miami Gardens, FL 33056']);
  assert.deepEqual(splitAddressLines('Line 1\nLine 2'), ['Line 1', 'Line 2']);
  assert.deepEqual(splitAddressLines(''), []);
});

test('empty settings fall back to company defaults', () => {
  const info = toCompanyInfo({ companyName: '', phone: '', email: '', address: '', licenseNumber: '' });
  assert.equal(info.name, 'Boxer Solutions Pest Control');
  assert.equal(info.email, 'service@boxersolutionspestcontrol.com');
  assert.deepEqual(info.addressLines, []);
});
