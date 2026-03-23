export const BOOKING_FORM_DRAFT_KEY = 'booking-form-draft-v1';
export const BOOKING_FORM_MODAL_OPEN_KEY = 'booking-form-modal-open-v1';

export const clearBookingDraftStorage = () => {
  if (typeof window === 'undefined') return;

  window.sessionStorage.removeItem(BOOKING_FORM_DRAFT_KEY);
  window.sessionStorage.removeItem(BOOKING_FORM_MODAL_OPEN_KEY);
};
