import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { X, Download, FileText, ChevronRight, Loader2 } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import api from "../../lib/api";
import { formatCurrency } from "../../lib/utils";

const TODAY = new Date().toISOString().split("T")[0];

// ── Helpers ────────────────────────────────────────────────────────────────────
function dur(y, m, d) {
  const parts = [];
  if (y > 0) parts.push(`${y} yr`);
  if (m > 0) parts.push(`${m} mo`);
  if (d > 0) parts.push(`${d} d`);
  return parts.join(" ") || "0 d";
}

// Preview uses ₹, PDF uses Rs. (Helvetica can't render ₹)
function fmt(n) {
  return `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
function pdfFmt(n) {
  return `Rs.${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function fmtDate(iso) {
  if (!iso) return "-";
  const [y, m, d] = iso.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d} ${months[parseInt(m) - 1]} ${y}`;
}

function loanTypeLabel(loan) {
  const map = { interest_only: "Interest-Only", emi: "EMI", short_term: "Short-Term" };
  const dir = loan.loan_direction === "given" ? "Given" : "Taken";
  return `${map[loan.loan_type] || loan.loan_type} (${dir})`;
}

// Active loans only; pending/partial obligations only
function filterForStatement(loans, obligations) {
  const activeLoans = (loans || []).filter((l) => l.status === "active");
  const pendingObls = (obligations || []).filter((o) => {
    const rem = (o.amount || 0) - (o.amount_settled || 0);
    return rem > 0 && o.status !== "settled";
  });
  return { activeLoans, pendingObls };
}

// ── PDF generator ─────────────────────────────────────────────────────────────
function generatePDF(data, contact) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW = 210;
  const ML = 14;
  const MR = 14;
  const CW = PW - ML - MR;

  const DARK    = [15, 23, 42];
  const ACCENT  = [79, 70, 229];
  const EMERALD = [5, 150, 105];
  const ROSE    = [225, 29, 72];
  const AMBER   = [217, 119, 6];
  const SLATE   = [100, 116, 139];
  const LIGHT   = [248, 250, 252];
  const INDIGO_LIGHT = [238, 242, 255];
  const TEAL    = [20, 184, 166];

  let y = 0;

  // ── Header bar ──────────────────────────────────────────────────────────────
  doc.setFillColor(...ACCENT);
  doc.rect(0, 0, PW, 28, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("LOAN ACCOUNT STATEMENT", ML, 12);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(`Generated: ${fmtDate(data.generated_on)}`, ML, 19);
  doc.text(`As of: ${fmtDate(data.as_of_date)}`, ML, 24);
  doc.setTextColor(200, 210, 255);
  doc.text("CONFIDENTIAL", PW - MR, 24, { align: "right" });
  y = 36;

  // ── Contact block ────────────────────────────────────────────────────────────
  doc.setFillColor(...LIGHT);
  doc.roundedRect(ML, y, CW, 22, 2, 2, "F");
  doc.setDrawColor(220, 225, 235);
  doc.roundedRect(ML, y, CW, 22, 2, 2, "S");
  doc.setTextColor(...DARK);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(contact.name || "-", ML + 4, y + 7);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...SLATE);
  const line2 = [contact.phone, contact.city].filter(Boolean).join("  |  ");
  if (line2) doc.text(line2, ML + 4, y + 13);
  if (contact.address) doc.text(contact.address, ML + 4, y + 18);
  y += 28;

  // ── Per-loan sections ────────────────────────────────────────────────────────
  data.loan_items.forEach((loan, idx) => {
    const isGiven  = loan.direction === "given";
    const isEMI    = loan.loan_type === "emi";
    const fc       = loan.emi_foreclosure;
    const hasInterest = !isEMI && loan.interest_accrued > 0;

    const headerColor = isGiven ? EMERALD : ROSE;

    // Section header
    doc.setFillColor(...headerColor);
    doc.rect(ML, y, CW, 8, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(loan.label, ML + 3, y + 5.5);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.text((loan.status || "").toUpperCase(), PW - MR - 2, y + 5.5, { align: "right" });
    y += 9;

    // Period / rate info row
    const typeMap  = { interest_only: "Interest-Only", emi: "EMI", short_term: "Short-Term" };
    const typeStr  = typeMap[loan.loan_type] || loan.loan_type;
    const periodStr = `${fmtDate(loan.disbursed_date)} to ${fmtDate(loan.as_of_date)}  (${dur(loan.duration_years, loan.duration_months, loan.duration_days)})`;
    let rateStr;
    if (isEMI) {
      rateStr = loan.emi_amount
        ? `EMI ${pdfFmt(loan.emi_amount)}/mo`
          + (fc?.effective_rb_rate_pct ? `  |  ${fc.effective_rb_rate_pct}% p.a. (reducing)` : "")
        : "EMI details not set";
    } else {
      rateStr = loan.interest_rate
        ? `${loan.interest_rate}% p.a.`
        : (loan.loan_type === "short_term" ? "No interest" : "No rate set");
    }

    autoTable(doc, {
      startY: y,
      margin: { left: ML, right: MR },
      tableWidth: CW,
      head: [["Type", "Period", "Rate / EMI"]],
      body: [[typeStr, periodStr, rateStr]],
      headStyles: { fillColor: LIGHT, textColor: SLATE, fontStyle: "bold", fontSize: 7, cellPadding: 2 },
      bodyStyles: { fontSize: 8, textColor: DARK, cellPadding: 2.5 },
      columnStyles: { 0: { cellWidth: 28 }, 1: { cellWidth: CW - 80 }, 2: { cellWidth: 52 } },
      theme: "plain",
    });
    y = doc.lastAutoTable.finalY + 2;

    // ── EMI foreclosure table ────────────────────────────────────────────────
    if (isEMI && fc) {
      const rows = [
        ["Original Principal", pdfFmt(loan.principal_amount), "", ""],
        ["EMI Amount", pdfFmt(loan.emi_amount), "", ""],
        ["Total Tenure", `${fc.emis_total} EMIs`, "", ""],
        ["", "", "", ""],
        ["EMIs Paid", "", `${fc.emis_paid} of ${fc.emis_total}`, ""],
        ["Total Paid (cash received)", "", pdfFmt(loan.already_paid_total), ""],
        ["EMIs Remaining", "", `${fc.emis_remaining}`, ""],
        ["", "", "", ""],
        ["Remaining Principal", "", "", pdfFmt(fc.foreclosure_principal)],
        ["Accrued Interest (since last EMI)", "", "", pdfFmt(fc.foreclosure_accrued_interest)],
        ["Foreclosure Processing Fee (2%)", "", "", pdfFmt(fc.foreclosure_processing_fee)],
      ];
      autoTable(doc, {
        startY: y,
        margin: { left: ML, right: MR },
        tableWidth: CW,
        head: [["Description", "Loan Details", "Payment Status", "Foreclosure Amount"]],
        body: rows,
        headStyles: { fillColor: INDIGO_LIGHT, textColor: ACCENT, fontStyle: "bold", fontSize: 7, cellPadding: 2 },
        bodyStyles: { fontSize: 8, textColor: DARK, cellPadding: 2 },
        columnStyles: {
          0: { cellWidth: CW - 126 },
          1: { cellWidth: 42, halign: "right" },
          2: { cellWidth: 42, halign: "right" },
          3: { cellWidth: 42, halign: "right", fontStyle: "bold" },
        },
        didParseCell: (hd) => { if (hd.row.raw[0] === "") hd.cell.styles.cellPadding = 0.5; },
        theme: "striped",
        alternateRowStyles: { fillColor: [252, 253, 254] },
      });
    } else if (loan.interest_segments?.length > 0) {
      // ── Segmented interest breakdown (capitalized loans) ─────────────────
      const segs = loan.interest_segments;
      for (const seg of segs) {
        if (seg.type === "period" || seg.type === "current_period") {
          const isCurrent = seg.type === "current_period";
          const segDur = dur(seg.duration_years, seg.duration_months, seg.duration_days);
          // Mini sub-header for this period
          doc.setFillColor(...(isCurrent ? [224, 242, 254] : [240, 253, 244]));
          doc.rect(ML, y, CW, 6, "F");
          doc.setTextColor(...(isCurrent ? [3, 105, 161] : [5, 150, 105]));
          doc.setFontSize(7.5);
          doc.setFont("helvetica", "bold");
          const segTitle = isCurrent
            ? `Period ${seg.segment_no}: After Capitalisation  (${fmtDate(seg.from_date)} to ${fmtDate(seg.to_date)})`
            : `Period ${seg.segment_no}: ${fmtDate(seg.from_date)} to ${fmtDate(seg.to_date)}`;
          doc.text(segTitle, ML + 3, y + 4);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7);
          doc.text(`${segDur}  |  Principal ${pdfFmt(seg.principal)}  |  ${pdfFmt(seg.monthly_interest)}/mo`, PW - MR - 2, y + 4, { align: "right" });
          y += 7;

          const rows = [];
          rows.push([`Interest (${seg.annual_rate}% p.a.)`, pdfFmt(seg.gross_interest), "", ""]);
          if (!isCurrent && seg.interest_paid > 0.01) {
            rows.push(["Interest Paid in this period", "", pdfFmt(seg.interest_paid), ""]);
          }
          if (!isCurrent && seg.interest_capitalized > 0.01) {
            rows.push(["Interest Capitalised (added to principal)", "", "", pdfFmt(seg.interest_capitalized)]);
          }
          if (isCurrent && loan.interest_outstanding > 0.01) {
            rows.push(["Interest Outstanding (unpaid)", "", "", pdfFmt(loan.interest_outstanding)]);
          }

          autoTable(doc, {
            startY: y, margin: { left: ML, right: MR }, tableWidth: CW,
            body: rows,
            bodyStyles: { fontSize: 8, textColor: DARK, cellPadding: 2 },
            columnStyles: {
              0: { cellWidth: CW - 126 },
              1: { cellWidth: 42, halign: "right" },
              2: { cellWidth: 42, halign: "right", textColor: EMERALD },
              3: { cellWidth: 42, halign: "right", fontStyle: "bold" },
            },
            theme: "plain",
            alternateRowStyles: { fillColor: [252, 253, 254] },
          });
          y = doc.lastAutoTable.finalY + 2;

        } else if (seg.type === "cap_event") {
          // Capitalisation event banner
          doc.setFillColor(254, 243, 199);
          doc.rect(ML, y, CW, 12, "F");
          doc.setDrawColor(...AMBER);
          doc.setLineWidth(0.5);
          doc.line(ML, y, ML, y + 12);
          doc.setLineWidth(0.2);
          doc.setTextColor(...AMBER);
          doc.setFontSize(8);
          doc.setFont("helvetica", "bold");
          doc.text(`CAPITALISATION  -  ${fmtDate(seg.event_date)}`, ML + 4, y + 4.5);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7.5);
          doc.setTextColor(...DARK);
          doc.text(
            `Outstanding interest of ${pdfFmt(seg.interest_capitalized)} added to principal.  New principal: ${pdfFmt(seg.new_principal)}`,
            ML + 4, y + 9.5,
          );
          y += 14;
        }
      }

      // Summary row for segmented loan
      autoTable(doc, {
        startY: y, margin: { left: ML, right: MR }, tableWidth: CW,
        body: [
          ["Original Principal", pdfFmt(loan.principal_amount), "", ""],
          ["Total Interest Accrued (all periods)", pdfFmt(loan.interest_accrued), "", ""],
          ["", "", "", ""],
          ["Already Paid - Interest", "", pdfFmt(loan.already_paid_interest || 0), ""],
          ["", "", "", ""],
          ["Original Principal Outstanding", "", "", pdfFmt(loan.principal_outstanding)],
          ["Interest Outstanding (unpaid)", "", "", pdfFmt(loan.interest_outstanding)],
        ],
        headStyles: { fillColor: INDIGO_LIGHT, textColor: ACCENT, fontStyle: "bold", fontSize: 7, cellPadding: 2 },
        bodyStyles: { fontSize: 8, textColor: DARK, cellPadding: 2 },
        columnStyles: {
          0: { cellWidth: CW - 126 },
          1: { cellWidth: 42, halign: "right" },
          2: { cellWidth: 42, halign: "right", textColor: EMERALD },
          3: { cellWidth: 42, halign: "right", fontStyle: "bold" },
        },
        didParseCell: (hd) => { if (hd.row.raw[0] === "") hd.cell.styles.cellPadding = 0.5; },
        theme: "striped",
        alternateRowStyles: { fillColor: [252, 253, 254] },
      });

    } else {
      // ── Simple interest-only / short-term table ───────────────────────────
      const rows = [
        ["Original Principal", pdfFmt(loan.principal_amount), "", ""],
      ];
      if (hasInterest) {
        rows.push(["Interest Accrued", pdfFmt(loan.interest_accrued), "", ""]);
        rows.push(["Total Amount", pdfFmt(loan.total_amount), "", ""]);
      }
      rows.push(["", "", "", ""]);
      rows.push(["Already Paid - Principal", "", pdfFmt(loan.already_paid_principal || 0), ""]);
      if (hasInterest) rows.push(["Already Paid - Interest", "", pdfFmt(loan.already_paid_interest || 0), ""]);
      rows.push(["Total Paid", "", pdfFmt(loan.already_paid_total), ""]);
      rows.push(["", "", "", ""]);
      rows.push(["Principal Outstanding", "", "", pdfFmt(loan.principal_outstanding)]);
      if (hasInterest) rows.push(["Interest Outstanding", "", "", pdfFmt(loan.interest_outstanding)]);

      autoTable(doc, {
        startY: y,
        margin: { left: ML, right: MR },
        tableWidth: CW,
        head: [["Description", "Amount (Total)", "Paid", "Outstanding"]],
        body: rows,
        headStyles: { fillColor: INDIGO_LIGHT, textColor: ACCENT, fontStyle: "bold", fontSize: 7, cellPadding: 2 },
        bodyStyles: { fontSize: 8, textColor: DARK, cellPadding: 2 },
        columnStyles: {
          0: { cellWidth: CW - 126 },
          1: { cellWidth: 42, halign: "right" },
          2: { cellWidth: 42, halign: "right" },
          3: { cellWidth: 42, halign: "right", fontStyle: "bold" },
        },
        didParseCell: (hd) => { if (hd.row.raw[0] === "") hd.cell.styles.cellPadding = 0.5; },
        theme: "striped",
        alternateRowStyles: { fillColor: [252, 253, 254] },
      });
    }

    // Outstanding chip
    y = doc.lastAutoTable.finalY + 1;
    doc.setFillColor(...headerColor);
    doc.roundedRect(ML, y, CW, 7, 1, 1, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    const chipLabel = isEMI ? "FORECLOSURE AMOUNT" : "NET OUTSTANDING";
    doc.text(`${chipLabel}: ${pdfFmt(loan.total_outstanding)}`, ML + 3, y + 4.8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(isGiven ? "Receivable from contact" : "Payable to contact", PW - MR - 2, y + 4.8, { align: "right" });
    y += 11;

    if (loan.notes) {
      doc.setTextColor(...SLATE);
      doc.setFontSize(7);
      doc.setFont("helvetica", "italic");
      doc.text(`Note: ${loan.notes}`, ML + 2, y);
      y += 5;
    }
    y += 3;

    if (y > 255 && idx < data.loan_items.length - 1) {
      doc.addPage();
      y = 14;
    }
  });

  // ── Obligations ──────────────────────────────────────────────────────────────
  if (data.obligation_items?.length > 0) {
    if (y > 220) { doc.addPage(); y = 14; }
    doc.setFillColor(...AMBER);
    doc.rect(ML, y, CW, 7, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("OBLIGATIONS", ML + 3, y + 5);
    y += 9;
    autoTable(doc, {
      startY: y,
      margin: { left: ML, right: MR },
      tableWidth: CW,
      head: [["Description", "Type", "Due Date", "Total", "Settled", "Remaining"]],
      body: data.obligation_items.map((o) => [
        o.label,
        o.obligation_type === "receivable" ? "Receivable" : "Payable",
        fmtDate(o.due_date),
        pdfFmt(o.amount),
        pdfFmt(o.amount_settled),
        pdfFmt(o.outstanding),
      ]),
      headStyles: { fillColor: [255, 251, 235], textColor: AMBER, fontStyle: "bold", fontSize: 7, cellPadding: 2 },
      bodyStyles: { fontSize: 8, textColor: DARK, cellPadding: 2 },
      columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right", fontStyle: "bold" } },
      theme: "striped",
    });
    y = doc.lastAutoTable.finalY + 4;
  }

  // ── Grand totals ─────────────────────────────────────────────────────────────
  if (y > 210) { doc.addPage(); y = 14; }
  doc.setFillColor(...DARK);
  doc.rect(ML, y, CW, 8, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("SUMMARY & SETTLEMENT", ML + 3, y + 5.5);
  y += 10;

  const t = data.totals;
  const summaryRows = [
    ["Total Principal (all loans)", pdfFmt(t.total_principal), ""],
    ["Total Interest / Charges Accrued", pdfFmt(t.total_interest_accrued), ""],
    ["Total Amount", pdfFmt(t.total_amount), ""],
    ["", "", ""],
    ["Total Already Paid", "", pdfFmt(t.total_paid)],
    ["", "", ""],
    ["Principal Outstanding", "", pdfFmt(t.total_principal_outstanding)],
    ["Interest / Foreclosure Charges", "", pdfFmt(t.total_interest_outstanding)],
  ];
  if (data.obligation_items?.length > 0) {
    summaryRows.push(["Obligations Remaining", "", pdfFmt(t.obligations_outstanding)]);
  }

  autoTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    tableWidth: CW,
    body: summaryRows,
    bodyStyles: { fontSize: 8.5, textColor: DARK, cellPadding: 2.5 },
    columnStyles: {
      0: { cellWidth: CW - 84 },
      1: { cellWidth: 42, halign: "right" },
      2: { cellWidth: 42, halign: "right" },
    },
    didParseCell: (hd) => { if (hd.row.raw[0] === "") hd.cell.styles.cellPadding = 1; },
    theme: "plain",
    alternateRowStyles: { fillColor: LIGHT },
  });
  y = doc.lastAutoTable.finalY + 2;

  // Final settlement chip
  doc.setFillColor(...ACCENT);
  doc.rect(ML, y, CW, 11, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("FINAL SETTLEMENT AMOUNT", ML + 4, y + 5);
  doc.setFontSize(12);
  doc.text(pdfFmt(t.settlement_amount), PW - MR - 4, y + 5, { align: "right" });
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(200, 210, 255);
  doc.text(`Amount to close all outstanding as of ${fmtDate(data.as_of_date)}`, ML + 4, y + 9);
  y += 17;

  // ── Signature ─────────────────────────────────────────────────────────────────
  if (y > 248) { doc.addPage(); y = 14; }
  y += 4;
  doc.setDrawColor(180, 190, 210);
  doc.setLineWidth(0.3);
  const sigX = ML;
  const sigW = 70;
  doc.line(sigX, y + 10, sigX + sigW, y + 10);
  doc.setTextColor(...SLATE);
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.text("Authorised Signature", sigX, y + 14);
  if (data.signature_name) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...DARK);
    doc.text(data.signature_name, sigX, y + 8);
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...SLATE);
  doc.line(sigX + sigW + 10, y + 10, sigX + sigW + 10 + 50, y + 10);
  doc.text(`Date: ${fmtDate(data.as_of_date)}`, sigX + sigW + 10, y + 14);

  // ── Page footers ──────────────────────────────────────────────────────────────
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(6.5);
    doc.setTextColor(160, 170, 185);
    doc.text(`Page ${i} of ${pages}`, PW - MR, 292, { align: "right" });
    doc.text("Generated by Finance Tracker  |  Confidential", ML, 292);
  }

  return doc;
}

// ── Preview sub-components ─────────────────────────────────────────────────────
function Row({ label, col1, col2, col3, bold, muted }) {
  return (
    <div className={`px-4 py-2 flex justify-between items-center text-sm ${bold ? "font-semibold" : ""} ${muted ? "opacity-50" : ""}`}>
      <span className="text-slate-600">{label}</span>
      <div className="flex gap-6 text-right">
        {col1 !== undefined && <span className="text-slate-800 w-32">{col1}</span>}
        {col2 !== undefined && <span className="text-emerald-700 w-32">{col2}</span>}
        {col3 !== undefined && <span className="font-bold text-indigo-700 w-32">{col3}</span>}
      </div>
    </div>
  );
}

function EmiForeclosureCard({ loan }) {
  const fc = loan.emi_foreclosure;
  const isGiven = loan.direction === "given";
  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden">
      <div className={`px-4 py-2.5 flex items-center justify-between ${isGiven ? "bg-emerald-600" : "bg-rose-600"}`}>
        <span className="text-white font-bold text-sm">{loan.label}</span>
        <span className="text-white/70 text-xs capitalize">{loan.status}</span>
      </div>
      {/* Period row */}
      <div className="bg-slate-50 px-4 py-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600 border-b border-slate-100">
        <span><b className="text-slate-500">Period:</b> {fmtDate(loan.disbursed_date)} → {fmtDate(loan.as_of_date)}</span>
        <span><b className="text-slate-500">Duration:</b> {dur(loan.duration_years, loan.duration_months, loan.duration_days)}</span>
        {loan.emi_amount && <span><b className="text-slate-500">EMI:</b> {fmt(loan.emi_amount)}/mo × {fc.emis_total}</span>}
        {fc.effective_rb_rate_pct && <span><b className="text-slate-500">Rate:</b> {fc.effective_rb_rate_pct}% p.a. (reducing balance)</span>}
      </div>
      {/* Loan details */}
      <div className="bg-indigo-50/40 px-4 py-2 border-b border-slate-100">
        <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mb-1.5">Loan Details</p>
        <div className="flex flex-wrap gap-x-8 gap-y-1 text-xs">
          <span className="text-slate-600">Original Principal: <b className="text-slate-800">{fmt(loan.principal_amount)}</b></span>
          <span className="text-slate-600">EMIs Paid: <b className="text-slate-800">{fc.emis_paid} of {fc.emis_total}</b></span>
          <span className="text-slate-600">EMIs Remaining: <b className="text-slate-800">{fc.emis_remaining}</b></span>
          <span className="text-slate-600">Total Cash Paid: <b className="text-emerald-700">{fmt(loan.already_paid_total)}</b></span>
        </div>
      </div>
      {/* Foreclosure breakdown */}
      <div className="divide-y divide-slate-100">
        <Row label="Remaining Principal" col3={fmt(fc.foreclosure_principal)} />
        <Row label={`Accrued Interest (since last EMI)`} col3={fmt(fc.foreclosure_accrued_interest)} />
        <Row label="Processing Fee (2%)" col3={fmt(fc.foreclosure_processing_fee)} />
      </div>
      <div className={`px-4 py-2.5 flex justify-between items-center ${isGiven ? "bg-emerald-50" : "bg-rose-50"}`}>
        <span className={`text-xs font-semibold ${isGiven ? "text-emerald-700" : "text-rose-700"}`}>
          Foreclosure Amount · {isGiven ? "Receivable" : "Payable"}
        </span>
        <span className={`font-bold text-base ${isGiven ? "text-emerald-800" : "text-rose-800"}`}>
          {fmt(fc.foreclosure_amount)}
        </span>
      </div>
    </div>
  );
}

function SegmentedLoanCard({ loan }) {
  const isGiven = loan.direction === "given";
  const segs = loan.interest_segments;
  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className={`px-4 py-2.5 flex items-center justify-between ${isGiven ? "bg-emerald-600" : "bg-rose-600"}`}>
        <span className="text-white font-bold text-sm">{loan.label}</span>
        <span className="text-white/70 text-xs capitalize">{loan.status}</span>
      </div>
      {/* Overall period */}
      <div className="bg-slate-50 px-4 py-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600 border-b border-slate-100">
        <span><b className="text-slate-500">Full Period:</b> {fmtDate(loan.disbursed_date)} → {fmtDate(loan.as_of_date)}</span>
        <span><b className="text-slate-500">Original Principal:</b> {fmt(loan.principal_amount)}</span>
      </div>

      {/* Segments */}
      <div className="divide-y divide-slate-100">
        {segs.map((seg, i) => {
          if (seg.type === "cap_event") {
            return (
              <div key={i} className="px-4 py-3 bg-amber-50 border-l-4 border-amber-400">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold text-amber-700 uppercase tracking-wider">Capitalisation — {fmtDate(seg.event_date)}</span>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-0.5 text-xs text-amber-800">
                  <span>Outstanding interest <b>{fmt(seg.interest_capitalized)}</b> added to principal</span>
                  <span>New principal: <b>{fmt(seg.new_principal)}</b></span>
                  {seg.notes && <span className="text-amber-600 italic">{seg.notes}</span>}
                </div>
              </div>
            );
          }
          const isCurrent = seg.type === "current_period";
          const segDur = dur(seg.duration_years, seg.duration_months, seg.duration_days);
          return (
            <div key={i} className={`${isCurrent ? "bg-sky-50/40" : "bg-emerald-50/20"}`}>
              {/* Period sub-header */}
              <div className={`px-4 py-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs border-b ${isCurrent ? "border-sky-100 text-sky-700" : "border-emerald-100 text-emerald-700"}`}>
                <span className="font-bold">Period {seg.segment_no}: {fmtDate(seg.from_date)} → {fmtDate(seg.to_date)}</span>
                <span className="text-slate-500">{segDur}</span>
                <span>Principal <b>{fmt(seg.principal)}</b></span>
                <span className="font-medium">{fmt(seg.monthly_interest)}/mo × {seg.annual_rate}% p.a.</span>
              </div>
              {/* Period rows */}
              <div className="divide-y divide-slate-100/60">
                <Row label={`Gross Interest (${seg.annual_rate}% p.a. for ${segDur})`} col1={fmt(seg.gross_interest)} />
                {!isCurrent && seg.interest_paid > 0.01 && (
                  <Row label="Interest Paid in this period" col2={fmt(seg.interest_paid)} />
                )}
                {!isCurrent && seg.interest_capitalized > 0.01 && (
                  <div className="px-4 py-2 flex justify-between items-center text-sm">
                    <span className="text-amber-600">Interest Capitalised → added to principal</span>
                    <span className="font-bold text-amber-700 w-32 text-right">{fmt(seg.interest_capitalized)}</span>
                  </div>
                )}
                {isCurrent && loan.interest_outstanding > 0.01 && (
                  <Row label="Interest Outstanding (unpaid)" col3={fmt(loan.interest_outstanding)} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Payment & outstanding summary */}
      <div className="border-t-2 border-slate-200 divide-y divide-slate-100 bg-white">
        <Row label="Total Interest Accrued (all periods)" col1={fmt(loan.interest_accrued)} bold />
        <div className="h-1 bg-slate-50" />
        <Row label="Already Paid – Interest" col2={fmt(loan.already_paid_interest || 0)} />
        <div className="h-1 bg-slate-50" />
        <Row label="Original Principal Outstanding" col3={fmt(loan.principal_outstanding)} />
        <Row label="Interest Outstanding" col3={fmt(loan.interest_outstanding)} />
      </div>

      <div className={`px-4 py-2.5 flex justify-between items-center ${isGiven ? "bg-emerald-50" : "bg-rose-50"}`}>
        <span className={`text-xs font-semibold ${isGiven ? "text-emerald-700" : "text-rose-700"}`}>
          Net Outstanding · {isGiven ? "Receivable" : "Payable"}
        </span>
        <span className={`font-bold text-base ${isGiven ? "text-emerald-800" : "text-rose-800"}`}>
          {fmt(loan.total_outstanding)}
        </span>
      </div>
    </div>
  );
}

function InterestLoanCard({ loan }) {
  // Delegate to segmented view if cap events exist
  if (loan.interest_segments?.length > 0) {
    return <SegmentedLoanCard loan={loan} />;
  }

  const isGiven = loan.direction === "given";
  const hasInterest = loan.interest_accrued > 0;
  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden">
      <div className={`px-4 py-2.5 flex items-center justify-between ${isGiven ? "bg-emerald-600" : "bg-rose-600"}`}>
        <span className="text-white font-bold text-sm">{loan.label}</span>
        <span className="text-white/70 text-xs capitalize">{loan.status}</span>
      </div>
      <div className="bg-slate-50 px-4 py-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600 border-b border-slate-100">
        <span><b className="text-slate-500">Period:</b> {fmtDate(loan.disbursed_date)} → {fmtDate(loan.as_of_date)}</span>
        <span><b className="text-slate-500">Duration:</b> {dur(loan.duration_years, loan.duration_months, loan.duration_days)}</span>
        {loan.interest_rate
          ? <span><b className="text-slate-500">Rate:</b> {loan.interest_rate}% p.a.</span>
          : <span className="text-slate-400">No interest</span>}
      </div>
      <div className="divide-y divide-slate-100">
        <Row label="Original Principal" col1={fmt(loan.principal_amount)} />
        {hasInterest && <Row label="Interest Accrued" col1={fmt(loan.interest_accrued)} />}
        {hasInterest && <Row label="Total Amount" col1={fmt(loan.total_amount)} bold />}
        <div className="h-1 bg-slate-50" />
        <Row label="Already Paid – Principal" col2={fmt(loan.already_paid_principal || 0)} />
        {hasInterest && <Row label="Already Paid – Interest" col2={fmt(loan.already_paid_interest || 0)} />}
        <Row label="Total Paid" col2={fmt(loan.already_paid_total)} bold />
        <div className="h-1 bg-slate-50" />
        <Row label="Principal Outstanding" col3={fmt(loan.principal_outstanding)} />
        {hasInterest && <Row label="Interest Outstanding" col3={fmt(loan.interest_outstanding)} />}
      </div>
      <div className={`px-4 py-2.5 flex justify-between items-center ${isGiven ? "bg-emerald-50" : "bg-rose-50"}`}>
        <span className={`text-xs font-semibold ${isGiven ? "text-emerald-700" : "text-rose-700"}`}>
          Net Outstanding · {isGiven ? "Receivable" : "Payable"}
        </span>
        <span className={`font-bold text-base ${isGiven ? "text-emerald-800" : "text-rose-800"}`}>
          {fmt(loan.total_outstanding)}
        </span>
      </div>
    </div>
  );
}

function StatementPreview({ data }) {
  const t = data.totals;
  return (
    <div className="space-y-5 text-sm">
      {data.loan_items.map((loan) =>
        loan.loan_type === "emi" && loan.emi_foreclosure
          ? <EmiForeclosureCard key={loan.loan_id} loan={loan} />
          : <InterestLoanCard key={loan.loan_id} loan={loan} />
      )}

      {/* Obligations */}
      {data.obligation_items?.length > 0 && (
        <div className="border border-amber-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-2.5 bg-amber-500">
            <span className="text-white font-bold text-sm">Obligations</span>
          </div>
          {data.obligation_items.map((o) => (
            <div key={o.obligation_id} className="px-4 py-2.5 flex justify-between items-center text-xs border-b border-amber-50">
              <div>
                <span className="font-semibold text-slate-700">{o.label}</span>
                {o.due_date && <span className="text-slate-400 ml-2">· {fmtDate(o.due_date)}</span>}
              </div>
              <span className="font-bold text-amber-700">{fmt(o.outstanding)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Summary */}
      <div className="border border-slate-300 rounded-2xl overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-800">
          <span className="text-white font-bold text-sm">Summary & Settlement</span>
        </div>
        <div className="divide-y divide-slate-100 bg-white">
          <Row label="Total Principal (all loans)" col1={fmt(t.total_principal)} />
          <Row label="Total Interest / Charges Accrued" col1={fmt(t.total_interest_accrued)} />
          <Row label="Total Amount" col1={fmt(t.total_amount)} bold />
          <div className="h-1 bg-slate-50" />
          <Row label="Total Already Paid" col2={fmt(t.total_paid)} />
          <div className="h-1 bg-slate-50" />
          <Row label="Principal Outstanding" col3={fmt(t.total_principal_outstanding)} />
          <Row label="Interest / Foreclosure Charges" col3={fmt(t.total_interest_outstanding)} />
          {data.obligation_items?.length > 0 && (
            <Row label="Obligations Remaining" col3={fmt(t.obligations_outstanding)} />
          )}
        </div>
        <div className="px-4 py-4 bg-indigo-600 flex justify-between items-center">
          <div>
            <p className="text-white font-bold text-base">Final Settlement Amount</p>
            <p className="text-indigo-200 text-xs mt-0.5">Closes all outstanding as of {fmtDate(data.as_of_date)}</p>
          </div>
          <p className="text-white font-extrabold text-xl">{fmt(t.settlement_amount)}</p>
        </div>
      </div>

      {data.signature_name && (
        <div className="pt-4 border-t border-slate-200">
          <p className="font-semibold text-slate-800">{data.signature_name}</p>
          <div className="mt-3 w-48 border-t-2 border-slate-400" />
          <p className="text-xs text-slate-400 mt-1">Authorised Signature · {fmtDate(data.as_of_date)}</p>
        </div>
      )}
    </div>
  );
}

// ── Checkbox items ─────────────────────────────────────────────────────────────
function LoanCheckItem({ loan, checked, onChange }) {
  const isGiven = loan.loan_direction === "given";
  return (
    <label className="flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors hover:bg-slate-50 has-[:checked]:border-indigo-300 has-[:checked]:bg-indigo-50/50">
      <input type="checkbox" checked={checked} onChange={onChange}
        className="mt-0.5 h-4 w-4 rounded accent-indigo-600 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-800">{loanTypeLabel(loan)}</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isGiven ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
            {isGiven ? "Receivable" : "Payable"}
          </span>
        </div>
        <div className="text-xs text-slate-500 mt-0.5">
          Principal {formatCurrency(loan.principal_amount)}
          {loan.interest_rate ? ` · ${loan.interest_rate}% p.a.` : loan.loan_type === "short_term" ? " · No interest" : ""}
          {loan.disbursed_date ? ` · from ${fmtDate(loan.disbursed_date)}` : ""}
        </div>
      </div>
    </label>
  );
}

function ObligationCheckItem({ obl, checked, onChange }) {
  const isReceivable = obl.obligation_type === "receivable";
  const remaining = (obl.amount || 0) - (obl.amount_settled || 0);
  return (
    <label className="flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors hover:bg-slate-50 has-[:checked]:border-indigo-300 has-[:checked]:bg-indigo-50/50">
      <input type="checkbox" checked={checked} onChange={onChange}
        className="mt-0.5 h-4 w-4 rounded accent-indigo-600 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-800">{obl.reason || obl.obligation_type}</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isReceivable ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
            {isReceivable ? "Receivable" : "Payable"}
          </span>
        </div>
        <div className="text-xs text-slate-500 mt-0.5">
          {formatCurrency(remaining)} remaining
          {obl.due_date ? ` · due ${fmtDate(obl.due_date)}` : ""}
        </div>
      </div>
    </label>
  );
}

// ── Main modal ─────────────────────────────────────────────────────────────────
export default function ContactStatementModal({ contact, loans, obligations, onClose }) {
  const { activeLoans, pendingObls } = filterForStatement(loans, obligations);

  const allLoanIds = activeLoans.map((l) => l.id);
  const allOblIds  = pendingObls.map((o) => o.id);

  const [selectedLoans, setSelectedLoans] = useState(new Set(allLoanIds));
  const [selectedObls,  setSelectedObls]  = useState(new Set(allOblIds));
  const [asOfDate,     setAsOfDate]       = useState(TODAY);
  const [signatureName, setSignatureName] = useState("");
  const [step,         setStep]           = useState("form");
  const [statementData, setStatementData] = useState(null);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/api/contacts/${contact.id}/statement`, {
        loan_ids:       [...selectedLoans],
        obligation_ids: [...selectedObls],
        as_of_date:     asOfDate,
        signature_name: signatureName || null,
      });
      return res.data;
    },
    onSuccess: (data) => { setStatementData(data); setStep("preview"); },
  });

  function toggleLoan(id) {
    setSelectedLoans((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }
  function toggleObl(id) {
    setSelectedObls((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }

  function handleDownload() {
    if (!statementData) return;
    const doc = generatePDF(statementData, contact);
    doc.save(`statement_${(contact.name || "contact").replace(/\s+/g, "_")}_${asOfDate}.pdf`);
  }

  const noneSelected = selectedLoans.size === 0 && selectedObls.size === 0;
  const hasItems     = activeLoans.length > 0 || pendingObls.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center">
              <FileText className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 text-base">Statement Export</h2>
              <p className="text-xs text-slate-400">{contact.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {step === "preview" && (
              <>
                <button onClick={() => setStep("form")}
                  className="text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors">
                  ← Edit
                </button>
                <button onClick={handleDownload}
                  className="flex items-center gap-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg transition-colors">
                  <Download className="w-3.5 h-3.5" /> Download PDF
                </button>
              </>
            )}
            <button onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 px-6 pt-3 pb-1 shrink-0">
          {["form", "preview"].map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <ChevronRight className="w-3 h-3 text-slate-300" />}
              <div className={`flex items-center gap-1.5 text-xs font-semibold ${step === s ? "text-indigo-600" : "text-slate-400"}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step === s ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-400"}`}>
                  {i + 1}
                </span>
                {s === "form" ? "Select & Configure" : "Preview & Download"}
              </div>
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {step === "form" ? (
            <div className="space-y-6">
              {/* Date */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                  Calculate Interest Till Date
                </label>
                <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                <p className="text-xs text-slate-400 mt-1">Can be past or future — interest and foreclosure amounts are projected accordingly.</p>
              </div>

              {/* Signature */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                  Signature Name <span className="normal-case font-normal text-slate-300">(optional)</span>
                </label>
                <input type="text" placeholder="Appears on the signature line in the PDF"
                  value={signatureName} onChange={(e) => setSignatureName(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>

              {/* Active Loans */}
              {activeLoans.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                      Active Loans ({selectedLoans.size}/{activeLoans.length})
                    </label>
                    <button onClick={() => setSelectedLoans(selectedLoans.size === activeLoans.length ? new Set() : new Set(allLoanIds))}
                      className="text-xs font-semibold text-indigo-600 hover:text-indigo-800">
                      {selectedLoans.size === activeLoans.length ? "Deselect all" : "Select all"}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {activeLoans.map((l) => (
                      <LoanCheckItem key={l.id} loan={l} checked={selectedLoans.has(l.id)} onChange={() => toggleLoan(l.id)} />
                    ))}
                  </div>
                </div>
              )}

              {/* Pending Obligations */}
              {pendingObls.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                      Pending Obligations ({selectedObls.size}/{pendingObls.length})
                    </label>
                    <button onClick={() => setSelectedObls(selectedObls.size === pendingObls.length ? new Set() : new Set(allOblIds))}
                      className="text-xs font-semibold text-indigo-600 hover:text-indigo-800">
                      {selectedObls.size === pendingObls.length ? "Deselect all" : "Select all"}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {pendingObls.map((o) => (
                      <ObligationCheckItem key={o.id} obl={o} checked={selectedObls.has(o.id)} onChange={() => toggleObl(o.id)} />
                    ))}
                  </div>
                </div>
              )}

              {!hasItems && (
                <div className="text-center py-8 text-slate-400">
                  <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No active loans or pending obligations for this contact.</p>
                </div>
              )}
            </div>
          ) : (
            statementData && <StatementPreview data={statementData} />
          )}
        </div>

        {/* Footer */}
        {step === "form" && hasItems && (
          <div className="px-6 py-4 border-t border-slate-100 shrink-0">
            {generateMutation.isError && (
              <p className="text-xs text-rose-500 mb-2">
                {generateMutation.error?.response?.data?.detail || "Failed to generate statement."}
              </p>
            )}
            <button
              onClick={() => generateMutation.mutate()}
              disabled={noneSelected || generateMutation.isPending || !asOfDate}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-semibold text-sm py-3 rounded-xl transition-colors"
            >
              {generateMutation.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
                : <>Generate Statement <ChevronRight className="w-4 h-4" /></>}
            </button>
            {noneSelected && (
              <p className="text-xs text-slate-400 text-center mt-1.5">Select at least one loan or obligation.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
