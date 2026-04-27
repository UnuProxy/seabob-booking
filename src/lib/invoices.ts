import type { Booking, Invoice, InvoiceLine } from '@/types';

const VAT_RATE = 0.21;

export const INVOICE_COMPANY = {
  name: 'NIRVANA CHARTER S.L.U.',
  address: 'C/Jose Riquer Llobet nº 14 2º piso A',
  taxId: 'B-57906877',
} as const;

const roundMoney = (value: number) => Math.round((Number(value) || 0) * 100) / 100;
export const INITIAL_INVOICE_SEQUENCE = 1;

const createLine = (
  type: InvoiceLine['type'],
  description: string,
  grossAmount: number,
  vatRate: number
): InvoiceLine => {
  const safeGross = roundMoney(grossAmount);
  if (safeGross <= 0) {
    return {
      type,
      description,
      gross_amount: 0,
      vat_rate: vatRate,
      vat_amount: 0,
      net_amount: 0,
    };
  }

  const vatAmount = vatRate > 0 ? roundMoney((safeGross * vatRate) / (1 + vatRate)) : 0;
  const netAmount = roundMoney(safeGross - vatAmount);

  return {
    type,
    description,
    gross_amount: safeGross,
    vat_rate: vatRate,
    vat_amount: vatAmount,
    net_amount: netAmount,
  };
};

export const formatInvoiceNumber = (sequence: number) => `AL-${String(sequence).padStart(3, '0')}`;

const getRentalDescription = (booking: Booking) => {
  const products = (booking.items || [])
    .map((item) => {
      const name = item.producto_nombre?.trim();
      if (!name) return '';
      return `${item.cantidad > 1 ? `x${item.cantidad} ` : ''}${name}`;
    })
    .filter(Boolean);

  if (products.length > 0) {
    return `Rental: ${products.join(', ')}`;
  }

  return `Booking ${booking.numero_reserva} rental service`;
};

const getClientAddress = (booking: Booking) => booking.cliente?.direccion?.trim() || '';

export const buildInvoiceLinesFromBooking = (booking: Booking): InvoiceLine[] => {
  const lines: InvoiceLine[] = [];
  const rentalTotal = Number(booking.precio_alquiler || 0);
  const instructorTotal = Number(booking.instructor_total || 0);
  const fuelTotal = Number(booking.fuel_total || 0);
  const deliveryTotal = Number(booking.delivery_total || 0);
  const hasInstructorVat = Boolean(
    booking.items?.some((item) => item.instructor_requested && item.instructor_incluir_iva)
  );

  if (rentalTotal > 0) {
    lines.push(
      createLine(
        'rental',
        getRentalDescription(booking),
        rentalTotal,
        VAT_RATE
      )
    );
  }

  if (instructorTotal > 0) {
    lines.push(
      createLine(
        'instructor',
        'Instructor / monitor service',
        instructorTotal,
        hasInstructorVat ? VAT_RATE : 0
      )
    );
  }

  if (fuelTotal > 0) {
    lines.push(createLine('fuel', 'Fuel surcharge', fuelTotal, 0));
  }

  if (deliveryTotal > 0) {
    lines.push(createLine('delivery', 'Delivery surcharge', deliveryTotal, 0));
  }

  return lines;
};

export const buildInvoiceFromBooking = (
  booking: Booking,
  sequenceNumber: number,
  createdBy?: string
): Omit<Invoice, 'id' | 'created_at'> => {
  const lines = buildInvoiceLinesFromBooking(booking);
  const amountGross = roundMoney(lines.reduce((sum, line) => sum + line.gross_amount, 0));
  const amountVat = roundMoney(lines.reduce((sum, line) => sum + line.vat_amount, 0));
  const amountNet = roundMoney(lines.reduce((sum, line) => sum + line.net_amount, 0));

  const payload: Omit<Invoice, 'id' | 'created_at'> = {
    booking_id: booking.id,
    booking_ref: booking.numero_reserva,
    invoice_number: formatInvoiceNumber(sequenceNumber),
    invoice_kind: 'standard',
    sequence_number: sequenceNumber,
    invoice_date: new Date().toISOString().slice(0, 10),
    company_name: INVOICE_COMPANY.name,
    company_address: INVOICE_COMPANY.address,
    company_tax_id: INVOICE_COMPANY.taxId,
    client_name: booking.cliente?.nombre || 'Client',
    client_email: booking.cliente?.email || '',
    client_phone: booking.cliente?.telefono || '',
    client_address: getClientAddress(booking),
    client_id_number: booking.cliente?.documento_identidad || '',
    amount_net: amountNet,
    amount_vat: amountVat,
    amount_gross: amountGross,
    lines,
    created_by: createdBy,
  };

  if (booking.pago_metodo) {
    payload.payment_method = booking.pago_metodo;
  }
  if (booking.pago_referencia) {
    payload.payment_reference = booking.pago_referencia;
  }
  if (booking.pago_realizado_en) {
    payload.paid_at = booking.pago_realizado_en;
  }

  return payload;
};

const scaleRefundLine = (line: InvoiceLine, ratio: number): InvoiceLine => {
  const grossAmount = roundMoney(line.gross_amount * ratio * -1);
  const vatAmount = roundMoney(line.vat_amount * ratio * -1);
  const netAmount = roundMoney(line.net_amount * ratio * -1);

  return {
    ...line,
    gross_amount: grossAmount,
    vat_amount: vatAmount,
    net_amount: netAmount,
  };
};

export const buildRefundInvoiceFromBooking = (
  booking: Booking,
  originalInvoice: Invoice,
  sequenceNumber: number,
  createdBy?: string
): Omit<Invoice, 'id' | 'created_at'> => {
  const originalGross = Math.abs(Number(originalInvoice.amount_gross || 0));
  const refundGross = roundMoney(Number(booking.reembolso_monto || originalGross || 0));
  const ratio = originalGross > 0 ? Math.min(1, refundGross / originalGross) : 1;
  const lines = (originalInvoice.lines || [])
    .map((line) => scaleRefundLine(line, ratio))
    .filter((line) => line.gross_amount !== 0 || line.net_amount !== 0 || line.vat_amount !== 0);
  const amountGross = roundMoney(lines.reduce((sum, line) => sum + line.gross_amount, 0));
  const amountVat = roundMoney(lines.reduce((sum, line) => sum + line.vat_amount, 0));
  const amountNet = roundMoney(lines.reduce((sum, line) => sum + line.net_amount, 0));

  const payload: Omit<Invoice, 'id' | 'created_at'> = {
    booking_id: booking.id,
    booking_ref: booking.numero_reserva,
    invoice_number: formatInvoiceNumber(sequenceNumber),
    invoice_kind: 'refund',
    sequence_number: sequenceNumber,
    invoice_date: new Date().toISOString().slice(0, 10),
    company_name: INVOICE_COMPANY.name,
    company_address: INVOICE_COMPANY.address,
    company_tax_id: INVOICE_COMPANY.taxId,
    client_name: booking.cliente?.nombre || originalInvoice.client_name || 'Client',
    client_email: booking.cliente?.email || originalInvoice.client_email || '',
    client_phone: booking.cliente?.telefono || originalInvoice.client_phone || '',
    client_address: getClientAddress(booking) || originalInvoice.client_address || '',
    client_id_number: booking.cliente?.documento_identidad || originalInvoice.client_id_number || '',
    amount_net: amountNet,
    amount_vat: amountVat,
    amount_gross: amountGross,
    refund_reason: booking.reembolso_motivo || 'Refund / credit note',
    lines,
    created_by: createdBy,
  };

  const refundMethod = booking.reembolso_metodo || booking.pago_metodo;
  const refundReference = booking.reembolso_referencia || booking.pago_referencia;
  const paidAt = booking.reembolso_fecha || booking.pago_realizado_en;

  if (refundMethod) {
    payload.payment_method = refundMethod;
  }
  if (refundReference) {
    payload.payment_reference = refundReference;
  }
  if (paidAt) {
    payload.paid_at = paidAt;
  }
  if (originalInvoice.id) {
    payload.related_invoice_id = originalInvoice.id;
  }
  if (originalInvoice.invoice_number) {
    payload.related_invoice_number = originalInvoice.invoice_number;
  }

  return payload;
};
