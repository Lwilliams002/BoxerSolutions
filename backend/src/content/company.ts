/** Company identity used on customer-facing emails and documents. */
export const COMPANY_INFO = {
  name: 'Boxer Solutions Pest Control',
  phone: '(305) 713-5011',
  phoneRaw: '3057135011',
  email: 'service@boxersolutionspestcontrol.com',
  addressLine1: process.env.COMPANY_ADDRESS_LINE1 ?? '',
  addressLine2: process.env.COMPANY_ADDRESS_LINE2 ?? '',
  license: process.env.COMPANY_LICENSE ?? '',
  poisonControl: '(800) 222-1222',
};
