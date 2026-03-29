import type { UserRole } from '@/types';

const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export function getTimedBookingExpiration(
  serviceStartDate: string,
  creatorRole?: UserRole | null
): Date {
  const now = Date.now();
  const serviceStart = new Date(serviceStartDate);
  const hoursUntilService = serviceStart.getTime() - now;
  const isPartnerBooking = creatorRole === 'broker' || creatorRole === 'agency';

  if (!isPartnerBooking) {
    return new Date(now + THIRTY_MINUTES_MS);
  }

  if (Number.isNaN(serviceStart.getTime())) {
    return new Date(now + THIRTY_MINUTES_MS);
  }

  return new Date(now + (hoursUntilService <= TWENTY_FOUR_HOURS_MS ? THIRTY_MINUTES_MS : TWENTY_FOUR_HOURS_MS));
}
