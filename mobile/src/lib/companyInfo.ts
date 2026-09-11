import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { company as fallback } from './theme';

/** Company identity as the owner set it in Company Settings; used on documents. */
export interface CompanyInfo {
  name: string;
  phone: string;
  email: string;
  addressLines: string[];
  /** "License #: …" or "License #: ---------" when blank. */
  license: string;
  licenseNumber: string;
  cardSurchargePercent?: number;
}

export const FALLBACK_COMPANY_INFO: CompanyInfo = {
  name: fallback.name,
  phone: fallback.phone,
  email: fallback.email,
  addressLines: [],
  license: 'License #: ---------',
  licenseNumber: '',
};

export function useCompanyInfo(): CompanyInfo {
  const query = useQuery({
    queryKey: ['company-info'],
    queryFn: () => api<CompanyInfo>('/settings/company-info'),
    staleTime: 5 * 60_000,
  });
  return query.data ?? FALLBACK_COMPANY_INFO;
}
