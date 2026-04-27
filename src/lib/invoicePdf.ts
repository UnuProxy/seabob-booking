'use client';

import jsPDF from 'jspdf';
import type { Invoice } from '@/types';

const formatCurrency = (value: number) => {
  const rounded = Math.round((Number(value) || 0) * 100) / 100;
  const sign = rounded < 0 ? '-' : '';
  return `${sign}${new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'EUR',
  }).format(Math.abs(rounded))}`;
};

const formatDate = (value?: unknown) => {
  if (!value) return '';
  const parsed =
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as { toDate?: () => Date }).toDate === 'function'
      ? (value as { toDate: () => Date }).toDate()
      : value instanceof Date
        ? value
        : new Date(value as string | number);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('en-GB');
};

export function downloadInvoicePdf(invoice: Invoice) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = 210;
  const margin = 16;
  const rightEdge = pageWidth - margin;
  const navy = [15, 31, 61] as const;
  const gold = [200, 162, 94] as const;
  const ink = [27, 35, 48] as const;
  const muted = [107, 114, 128] as const;
  const isRefundInvoice = invoice.invoice_kind === 'refund';
  const title = isRefundInvoice ? 'REFUND INVOICE' : 'INVOICE';
  let y = 18;

  pdf.setFillColor(248, 244, 235);
  pdf.rect(0, 0, pageWidth, 54, 'F');
  pdf.setDrawColor(...gold);
  pdf.setLineWidth(0.6);
  pdf.line(0, 54, pageWidth, 54);

  pdf.setTextColor(...navy);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(22);
  pdf.text(invoice.company_name, margin, y);
  y += 7;

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10.5);
  pdf.setTextColor(...muted);
  pdf.text(invoice.company_address, margin, y);
  y += 5;
  pdf.text(`Tax ID: ${invoice.company_tax_id}`, margin, y);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(28);
  pdf.setTextColor(...ink);
  pdf.text(title, rightEdge, 22, { align: 'right' });
  pdf.setFontSize(10.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(...muted);
  pdf.text(formatDate(invoice.invoice_date), rightEdge, 28, { align: 'right' });

  y = 66;
  pdf.setFillColor(255, 255, 255);
  pdf.setDrawColor(232, 234, 238);
  pdf.roundedRect(margin, y, 56, 22, 3, 3, 'FD');
  pdf.roundedRect(margin + 60, y, 56, 22, 3, 3, 'FD');
  pdf.roundedRect(margin + 120, y, 58, 22, 3, 3, 'FD');

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(...muted);
  pdf.text('INVOICE NO.', margin + 4, y + 6);
  pdf.text('BILL TO', margin + 64, y + 6);
  pdf.text('TOTAL', margin + 124, y + 6);

  pdf.setTextColor(...ink);
  pdf.setFontSize(13);
  pdf.text(invoice.invoice_number, margin + 4, y + 14);
  pdf.text(invoice.client_name || 'Client', margin + 64, y + 14);
  pdf.text(formatCurrency(invoice.amount_gross), margin + 174, y + 14, { align: 'right' });

  y = 100;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.setTextColor(...ink);
  pdf.text('Invoice details', margin, y);
  pdf.text('Bill to', 110, y);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10.5);
  pdf.setTextColor(...muted);
  pdf.text(`Date: ${formatDate(invoice.invoice_date)}`, margin, y + 7);
  pdf.text(`Booking: ${invoice.booking_ref}`, margin, y + 13);
  if (isRefundInvoice && invoice.related_invoice_number) {
    pdf.text(`Original invoice: ${invoice.related_invoice_number}`, margin, y + 19);
  } else if (invoice.payment_method) {
    pdf.text(`Payment method: ${invoice.payment_method}`, margin, y + 19);
  }
  pdf.setTextColor(...ink);
  const billToLines = [
    invoice.client_name || 'Client',
    invoice.client_id_number ? `ID: ${invoice.client_id_number}` : '',
    invoice.client_address ? `Address: ${invoice.client_address}` : '',
    invoice.client_email || '',
    invoice.client_phone || '',
  ].filter(Boolean);
  billToLines.forEach((line, index) => {
    pdf.setTextColor(index === 0 ? ink[0] : muted[0], index === 0 ? ink[1] : muted[1], index === 0 ? ink[2] : muted[2]);
    pdf.text(line, 110, y + 7 + index * 6);
  });

  y = 140;
  pdf.setFillColor(238, 241, 251);
  pdf.rect(margin, y, 178, 10, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9.5);
  pdf.setTextColor(...muted);
  pdf.text('#', margin + 4, y + 6.5);
  pdf.text('Description', margin + 14, y + 6.5);
  pdf.text('Net', margin + 112, y + 6.5, { align: 'right' });
  pdf.text('VAT', margin + 142, y + 6.5, { align: 'right' });
  pdf.text('Total', margin + 174, y + 6.5, { align: 'right' });

  let rowY = y + 10;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(...ink);

  invoice.lines.forEach((line, index) => {
    pdf.setDrawColor(238, 242, 247);
    pdf.line(margin, rowY, margin + 178, rowY);
    rowY += 8;
    pdf.text(String(index + 1), margin + 4, rowY);
    pdf.text(line.description, margin + 14, rowY);
    pdf.text(formatCurrency(line.net_amount), margin + 112, rowY, { align: 'right' });
    pdf.text(formatCurrency(line.vat_amount), margin + 142, rowY, { align: 'right' });
    pdf.text(formatCurrency(line.gross_amount), margin + 174, rowY, { align: 'right' });
    rowY += 5;
  });

  const totalsTop = Math.max(rowY + 8, 210);
  pdf.setFillColor(255, 255, 255);
  pdf.setDrawColor(231, 231, 234);
  pdf.roundedRect(118, totalsTop, 76, 34, 4, 4, 'FD');

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10.5);
  pdf.setTextColor(...muted);
  pdf.text('Subtotal', 124, totalsTop + 9);
  pdf.text(formatCurrency(invoice.amount_net), 188, totalsTop + 9, { align: 'right' });
  pdf.text('VAT', 124, totalsTop + 17);
  pdf.text(formatCurrency(invoice.amount_vat), 188, totalsTop + 17, { align: 'right' });

  pdf.setDrawColor(231, 231, 234);
  pdf.line(124, totalsTop + 22, 188, totalsTop + 22);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  pdf.setTextColor(...navy);
  pdf.text('Total amount', 124, totalsTop + 30);
  pdf.text(formatCurrency(invoice.amount_gross), 188, totalsTop + 30, { align: 'right' });

  const footerY = 265;
  pdf.setFillColor(246, 247, 251);
  pdf.rect(0, footerY, pageWidth, 32, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.setTextColor(...ink);
  pdf.text('Payment status', margin, footerY + 9);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  pdf.setTextColor(...muted);
  pdf.text(
    isRefundInvoice
      ? 'Refund issued'
      : 'Payment confirmed',
    margin,
    footerY + 16
  );
  pdf.text(
    isRefundInvoice
      ? `Refund date: ${formatDate(invoice.paid_at || invoice.invoice_date)}`
      : invoice.paid_at
        ? `Paid on ${formatDate(invoice.paid_at)}`
        : 'Issued after payment confirmation',
    margin,
    footerY + 22
  );

  pdf.save(`${invoice.invoice_number}.pdf`);
}
