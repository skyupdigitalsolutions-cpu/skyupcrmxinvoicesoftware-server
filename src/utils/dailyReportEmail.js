/**
 * dailyReportEmail.js
 * Builds and sends the daily lead/sales report PDF to a company's admin email
 * using Brevo (formerly Sendinblue) Transactional Email API.
 *
 * External deps: @getbrevo/brevo, pdfkit  (both in package.json)
 *
 * Each company stores its own Brevo API key in:
 *   company.emailReport.brevoApiKey  (select: false in Mongoose)
 *   company.emailReport.senderEmail  – the verified sender address in Brevo
 *   company.emailReport.senderName   – optional display name (default: company name)
 */
import * as brevo from '@getbrevo/brevo';
import PDFDocument from 'pdfkit';
import { Lead } from '../models/Lead.js';
import { Order } from '../models/Order.js';

// ── helpers ────────────────────────────────────────────────────────────────────
const dayKey = (d) => {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

const fmtDate = (d) =>
    new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

const currFmt = (company, n) => {
    const sym = (company.currency && company.currency.symbol) || '₹';
    const loc = (company.currency && company.currency.locale) || 'en-IN';
    return `${sym}${Number(n || 0).toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// ── PDF builder ───────────────────────────────────────────────────────────────
async function buildReportPdf(company, date, data) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const W = doc.page.width - 80; // usable width
        const purple = '#6D28D9';
        const gray = '#6B7280';
        const light = '#F5F3FF';

        // ── Header ────────────────────────────────────────────────────────────────
        doc.rect(0, 0, doc.page.width, 70).fill(purple);
        doc.fillColor('#FFFFFF').fontSize(18).font('Helvetica-Bold')
            .text(company.name, 40, 20);
        doc.fontSize(10).font('Helvetica')
            .text(`Daily Report — ${fmtDate(date)}`, 40, 44);
        doc.moveDown(2);

        // ── Summary cards ────────────────────────────────────────────────────────
        const { summary, sources, employees, orders } = data;
        const cards = [
            { label: 'Total Leads', value: summary.total },
            { label: 'Contacted', value: summary.contacted },
            { label: 'Converted', value: `${summary.converted} (${summary.convRate}%)` },
            { label: 'Follow-ups', value: summary.followUpCount },
            { label: 'Total Orders', value: orders.count },
            { label: 'Revenue', value: currFmt(company, orders.revenue) },
        ];
        const cardW = (W - 20) / 3;
        let cx = 40,
            cy = 85;
        cards.forEach((c, i) => {
            doc.rect(cx, cy, cardW, 48).fill(light);
            doc.fillColor(purple).fontSize(18).font('Helvetica-Bold')
                .text(String(c.value), cx + 8, cy + 6, { width: cardW - 16 });
            doc.fillColor(gray).fontSize(8).font('Helvetica')
                .text(c.label, cx + 8, cy + 30, { width: cardW - 16 });
            cx += cardW + 10;
            if (i === 2) { cx = 40;
                cy += 56; }
        });

        doc.y = cy + 60;

        // ── Section helper ────────────────────────────────────────────────────────
        const section = (title) => {
            doc.moveDown(0.5);
            doc.rect(40, doc.y, W, 18).fill(purple);
            doc.fillColor('#FFF').fontSize(9).font('Helvetica-Bold')
                .text(title, 46, doc.y + 4);
            doc.moveDown(1.2);
            doc.fillColor('#111').font('Helvetica').fontSize(9);
        };

        const tableRow = (cols, widths, y, isHead = false) => {
            let x = 40;
            if (isHead) doc.rect(40, y - 2, W, 14).fill('#EDE9FE');
            cols.forEach((c, i) => {
                doc.fillColor(isHead ? purple : '#222').font(isHead ? 'Helvetica-Bold' : 'Helvetica')
                    .fontSize(8).text(String(c), x + 3, y, { width: widths[i] - 6, ellipsis: true });
                x += widths[i];
            });
        };

        // ── Lead Sources ──────────────────────────────────────────────────────────
        if (sources.length) {
            section('Lead Sources');
            const sw = [W * 0.6, W * 0.4];
            tableRow(['Source', 'Count'], sw, doc.y, true);
            doc.moveDown(0.7);
            sources.forEach((s) => {
                tableRow([s.label, s.count], sw, doc.y);
                doc.moveDown(0.55);
            });
        }

        // ── Employee Activity ─────────────────────────────────────────────────────
        if (employees.length) {
            section('Employee Activity');
            const ew = [W * 0.35, W * 0.16, W * 0.16, W * 0.16, W * 0.17];
            tableRow(['Name', 'Leads', 'Calls', 'In-Progress', 'Converted'], ew, doc.y, true);
            doc.moveDown(0.7);
            employees.forEach((e) => {
                tableRow([e.name, e.leads, e.callsToday, e.inProgress, e.converted], ew, doc.y);
                doc.moveDown(0.55);
            });
        }

        // ── Today's Leads list ────────────────────────────────────────────────────
        if (data.leads.length) {
            section(`Leads Created Today (${data.leads.length})`);
            const lw = [W * 0.25, W * 0.18, W * 0.18, W * 0.22, W * 0.17];
            tableRow(['Name', 'Mobile', 'Source', 'Assigned To', 'Status'], lw, doc.y, true);
            doc.moveDown(0.7);
            data.leads.slice(0, 40).forEach((l) => {
                tableRow([l.name, l.mobile || '—', l.source, l.assignedUserName || '—', l.status], lw, doc.y);
                doc.moveDown(0.55);
                if (doc.y > doc.page.height - 60) { doc.addPage();
                    doc.y = 40; }
            });
        }

        // ── Footer ────────────────────────────────────────────────────────────────
        doc.rect(0, doc.page.height - 30, doc.page.width, 30).fill(purple);
        doc.fillColor('#FFF').fontSize(7).font('Helvetica')
            .text(
                `Generated by Sole & Stride Platform · ${new Date().toLocaleString('en-GB')}`,
                0, doc.page.height - 18, { align: 'center', width: doc.page.width }
            );

        doc.end();
    });
}

// ── Data fetcher ──────────────────────────────────────────────────────────────
async function fetchReportData(companyId, date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const [dayLeads, allOpenLeads, dayOrders] = await Promise.all([
        Lead.find({ company: companyId, createdAt: { $gte: start, $lte: end } }).sort({ createdAt: -1 }).lean(),
        Lead.find({ company: companyId, followUpAt: { $ne: null }, status: { $nin: ['Won', 'Lost'] } }).lean(),
        Order.find({ company: companyId, createdAt: { $gte: start, $lte: end } }).lean(),
    ]);

    const isContacted = (s) => ['Contacted', 'Interested', 'Follow-up', 'Won'].includes(s);
    const isInProgress = (s) => ['Contacted', 'Interested', 'Follow-up'].includes(s);
    const count = (arr, pred) => arr.filter(pred).length;

    const total = dayLeads.length;
    const converted = count(dayLeads, (l) => l.status === 'Won' || l.converted);
    const contacted = count(dayLeads, (l) => isContacted(l.status));
    const inProgress = count(dayLeads, (l) => isInProgress(l.status));
    const callsToday = dayLeads.reduce(
        (s, l) => s + (l.callLogs || []).filter((c) => new Date(c.at) >= start && new Date(c.at) <= end).length, 0
    );

    const srcMap = {};
    dayLeads.forEach((l) => { srcMap[l.source] = (srcMap[l.source] || 0) + 1; });
    const sources = Object.entries(srcMap).map(([label, c]) => ({ label, count: c })).sort((a, b) => b.count - a.count);

    const empMap = {};
    dayLeads.forEach((l) => {
        const name = l.ownerName || 'Unassigned';
        empMap[name] = empMap[name] || { name, leads: 0, callsToday: 0, inProgress: 0, converted: 0 };
        empMap[name].leads += 1;
        empMap[name].callsToday += (l.callLogs || []).filter((c) => new Date(c.at) >= start && new Date(c.at) <= end).length;
        if (isInProgress(l.status)) empMap[name].inProgress += 1;
        if (l.status === 'Won' || l.converted) empMap[name].converted += 1;
    });
    const employees = Object.values(empMap).sort((a, b) => b.leads - a.leads);

    const orderRevenue = dayOrders.reduce((s, o) => s + (o.grandTotal || 0), 0);

    return {
        summary: {
            total,
            contacted,
            converted,
            inProgress,
            convRate: total ? Math.round((converted / total) * 100) : 0,
            callsMadeToday: callsToday,
            followUpCount: allOpenLeads.length,
        },
        sources,
        employees,
        leads: dayLeads.map((l) => ({
            name: l.name,
            mobile: l.mobile,
            source: l.source,
            assignedUserName: l.ownerName || '—',
            status: l.status,
        })),
        orders: { count: dayOrders.length, revenue: orderRevenue },
    };
}

// ── Main export ───────────────────────────────────────────────────────────────
/**
 * Sends the daily report PDF to the company's configured admin email via Brevo.
 *
 * Required company.emailReport fields:
 *   brevoApiKey   – Brevo transactional API key (xkeysib-…)
 *   senderEmail   – verified sender address in your Brevo account
 *   adminEmail    – recipient address
 *
 * Optional:
 *   senderName    – display name for the From field (defaults to company name)
 *   sendAt        – HH:MM schedule string (used by the scheduler, not here)
 *   enabled       – boolean flag (checked by the scheduler, not here)
 *
 * @param {Object} company  – Mongoose Company doc (with emailReport.brevoApiKey selected)
 * @param {Date}   date     – the report date (defaults to today)
 */
export async function sendDailyReport(company, date = new Date()) {
    const cfg = company.emailReport;

    if (!cfg || !cfg.brevoApiKey) throw new Error('Brevo API key is not configured.');
    if (!cfg || !cfg.adminEmail) throw new Error('Admin recipient email is not configured.');
    if (!cfg || !cfg.senderEmail) throw new Error('Sender email is not configured.');

    const data = await fetchReportData(company._id, date);
    const pdfBuffer = await buildReportPdf(company, date, data);
    const dateStr = dayKey(date);

    // ── Initialise the Brevo API client with this company's key ────────────────
    const apiInstance = new brevo.TransactionalEmailsApi();
    apiInstance.authentications['api-key'].apiKey = cfg.brevoApiKey;

    // ── Build the send request ─────────────────────────────────────────────────
    const sendSmtpEmail = new brevo.SendSmtpEmail();

    sendSmtpEmail.sender = {
        name: cfg.senderName || company.name,
        email: cfg.senderEmail,
    };

    sendSmtpEmail.to = [{ email: cfg.adminEmail }];

    sendSmtpEmail.subject = `Daily Report — ${company.name} — ${dateStr}`;

    sendSmtpEmail.htmlContent = `
    <div style="font-family:sans-serif;max-width:560px;margin:auto">
      <div style="background:#6D28D9;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <h2 style="margin:0">${company.name}</h2>
        <p style="margin:4px 0 0;opacity:.85">Daily Report · ${fmtDate(date)}</p>
      </div>
      <div style="background:#F9FAFB;padding:20px 24px;border:1px solid #E5E7EB;border-top:none">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:8px 12px;background:#EDE9FE;border-radius:6px;text-align:center">
              <div style="font-size:22px;font-weight:700;color:#6D28D9">${data.summary.total}</div>
              <div style="font-size:11px;color:#6B7280">Leads Today</div>
            </td>
            <td width="12"></td>
            <td style="padding:8px 12px;background:#EDE9FE;border-radius:6px;text-align:center">
              <div style="font-size:22px;font-weight:700;color:#6D28D9">${data.summary.converted}</div>
              <div style="font-size:11px;color:#6B7280">Converted (${data.summary.convRate}%)</div>
            </td>
            <td width="12"></td>
            <td style="padding:8px 12px;background:#EDE9FE;border-radius:6px;text-align:center">
              <div style="font-size:22px;font-weight:700;color:#6D28D9">${data.orders.count}</div>
              <div style="font-size:11px;color:#6B7280">Orders · ${currFmt(company, data.orders.revenue)}</div>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 4px;color:#374151;font-size:13px">
          Full report is attached as a PDF. Log in to the dashboard for detailed analytics.
        </p>
      </div>
      <div style="background:#F3F4F6;padding:10px 24px;border:1px solid #E5E7EB;border-top:none;border-radius:0 0 8px 8px;font-size:11px;color:#9CA3AF">
        Sent automatically by the Sole &amp; Stride platform via Brevo.
      </div>
    </div>
  `;

    // Brevo accepts attachments as base64-encoded strings
    sendSmtpEmail.attachment = [{
        name: `daily-report-${dateStr}.pdf`,
        content: pdfBuffer.toString('base64'),
    }, ];

    try {
        await apiInstance.sendTransacEmail(sendSmtpEmail);
    } catch (err) {
        // The Brevo SDK buries the real reason (bad key, unverified sender,
        // etc.) inside err.response.body / err.body rather than err.message —
        // surface it so the caller sees something actionable instead of a bare
        // "Request failed".
        const body = (err && err.response && err.response.body) || (err && err.body) || null;
        const brevoMsg = (body && (body.message || body.code)) || (err && err.message) || 'Brevo rejected the request.';
        throw new Error(`Brevo error: ${brevoMsg}`);
    }
}