import PDFDocument from "pdfkit";

export interface ReportMemberAttendance {
  name: string;
  memberId: string;
  inLabel: string;
  outLabel: string;
  hoursLabel: string;
}

export interface ReportShiftGroup {
  name: string;
  timeLabel: string;
  members: ReportMemberAttendance[];
}

export interface ReportPaidRow {
  name: string;
  memberId: string;
  amountLabel: string;
  timeLabel: string;
}

export interface ReportDueRow {
  name: string;
  memberId: string;
  amountLabel: string;
  sinceLabel: string;
}

export interface ReportNextGenRow {
  name: string;
  memberId: string;
  dateLabel: string;
}

export interface DailyReportData {
  libraryName: string;
  dateLabel: string;
  presentCount: number;
  totalStudents: number;
  collectedTodayLabel: string;
  duesTotalLabel: string;
  duesCount: number;
  shifts: ReportShiftGroup[];
  paidToday: ReportPaidRow[];
  dues: ReportDueRow[];
  nextGen: ReportNextGenRow[];
}

const INK = "#111827";
const MUTED = "#6b7280";
const ACCENT = "#1d4ed8";
const LINE = "#e5e7eb";
const HEADER_BG = "#f3f4f6";

/** Render the daily admin report to a PDF Buffer. */
export function buildDailyReportPdf(data: DailyReportData): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const done = collect(doc);

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentWidth = right - left;

  // ── Title ────────────────────────────────────────────────────────────────
  doc.fillColor(ACCENT).fontSize(20).font("Helvetica-Bold").text(data.libraryName, left, 40);
  doc.fillColor(INK).fontSize(14).font("Helvetica-Bold").text("Daily Report", { continued: false });
  doc.fillColor(MUTED).fontSize(10).font("Helvetica").text(data.dateLabel);
  doc.moveDown(0.5);
  hr(doc, left, right);
  doc.moveDown(0.5);

  // ── Summary strip ──────────────────────────────────────────────────────────
  const summary: [string, string][] = [
    ["Total students", `${data.totalStudents}`],
    ["Present today", `${data.presentCount} member(s)`],
    ["Collected today", data.collectedTodayLabel],
    ["Pending dues", `${data.duesCount} member(s) • ${data.duesTotalLabel}`],
  ];
  for (const [k, v] of summary) {
    doc.fontSize(10).fillColor(MUTED).font("Helvetica").text(`${k}: `, { continued: true });
    doc.fillColor(INK).font("Helvetica-Bold").text(v);
  }
  doc.moveDown(0.8);

  // ── Attendance by shift ─────────────────────────────────────────────────────
  sectionTitle(doc, "Attendance by Shift", left, right);
  if (data.shifts.length === 0) {
    emptyLine(doc, "No one visited today.");
  } else {
    const cols = colLayout(left, contentWidth, [0.42, 0.19, 0.19, 0.2]);
    for (const shift of data.shifts) {
      ensureSpace(doc, 70);
      doc
        .moveDown(0.4)
        .fontSize(11)
        .fillColor(ACCENT)
        .font("Helvetica-Bold")
        .text(`${shift.name}  (${shift.timeLabel})  —  ${shift.members.length} member(s)`, left);
      tableHeader(doc, cols, ["Member", "Punch In", "Punch Out", "Hours"]);
      for (const m of shift.members) {
        ensureSpace(doc, 20, () => tableHeader(doc, cols, ["Member", "Punch In", "Punch Out", "Hours"]));
        tableRow(doc, cols, [`${m.name} (${m.memberId})`, m.inLabel, m.outLabel, m.hoursLabel]);
      }
    }
  }
  doc.moveDown(0.8);

  // ── Fees paid today ─────────────────────────────────────────────────────────
  sectionTitle(doc, "Fees Paid Today", left, right);
  if (data.paidToday.length === 0) {
    emptyLine(doc, "No payments recorded today.");
  } else {
    const cols = colLayout(left, contentWidth, [0.52, 0.28, 0.2]);
    tableHeader(doc, cols, ["Member", "Amount", "Time"]);
    for (const p of data.paidToday) {
      ensureSpace(doc, 20, () => tableHeader(doc, cols, ["Member", "Amount", "Time"]));
      tableRow(doc, cols, [`${p.name} (${p.memberId})`, p.amountLabel, p.timeLabel]);
    }
  }
  doc.moveDown(0.8);

  // ── Pending dues ─────────────────────────────────────────────────────────────
  sectionTitle(doc, "Pending Dues", left, right);
  if (data.dues.length === 0) {
    emptyLine(doc, "No pending dues. All clear!");
  } else {
    const cols = colLayout(left, contentWidth, [0.52, 0.28, 0.2]);
    tableHeader(doc, cols, ["Member", "Due", "Since"]);
    for (const d of data.dues) {
      ensureSpace(doc, 20, () => tableHeader(doc, cols, ["Member", "Due", "Since"]));
      tableRow(doc, cols, [`${d.name} (${d.memberId})`, d.amountLabel, d.sinceLabel]);
    }
  }
  doc.moveDown(0.8);

  // ── Next auto fee-generation ─────────────────────────────────────────────────
  sectionTitle(doc, "Next Auto Fee-Generation", left, right);
  if (data.nextGen.length === 0) {
    emptyLine(doc, "No active members.");
  } else {
    const cols = colLayout(left, contentWidth, [0.6, 0.4]);
    tableHeader(doc, cols, ["Member", "Next generation date"]);
    for (const n of data.nextGen) {
      ensureSpace(doc, 20, () => tableHeader(doc, cols, ["Member", "Next generation date"]));
      tableRow(doc, cols, [`${n.name} (${n.memberId})`, n.dateLabel]);
    }
  }

  doc.end();
  return done;
}

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function hr(doc: PDFKit.PDFDocument, left: number, right: number) {
  doc.strokeColor(LINE).lineWidth(1).moveTo(left, doc.y).lineTo(right, doc.y).stroke();
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string, left: number, right: number) {
  ensureSpace(doc, 40);
  doc.fillColor(INK).fontSize(13).font("Helvetica-Bold").text(title, left);
  doc.moveDown(0.2);
  hr(doc, left, right);
}

function emptyLine(doc: PDFKit.PDFDocument, text: string) {
  doc.moveDown(0.3).fontSize(10).fillColor(MUTED).font("Helvetica-Oblique").text(text);
}

interface Col {
  x: number;
  w: number;
}

function colLayout(left: number, width: number, ratios: number[]): Col[] {
  const cols: Col[] = [];
  let x = left;
  for (const r of ratios) {
    const w = width * r;
    cols.push({ x, w: w - 6 });
    x += w;
  }
  return cols;
}

function tableHeader(doc: PDFKit.PDFDocument, cols: Col[], labels: string[]) {
  const y = doc.y + 2;
  const h = 16;
  doc.rect(cols[0]!.x - 2, y, cols.reduce((s, c) => s + c.w + 6, 0) - 2, h).fill(HEADER_BG);
  doc.fillColor(MUTED).fontSize(8.5).font("Helvetica-Bold");
  labels.forEach((label, i) => {
    doc.text(label.toUpperCase(), cols[i]!.x, y + 4, { width: cols[i]!.w, lineBreak: false });
  });
  doc.y = y + h + 2;
}

function tableRow(doc: PDFKit.PDFDocument, cols: Col[], cells: string[]) {
  const y = doc.y;
  doc.fillColor(INK).fontSize(9.5).font("Helvetica");
  let maxH = 12;
  cells.forEach((cell, i) => {
    const hh = doc.heightOfString(cell, { width: cols[i]!.w });
    if (hh > maxH) maxH = hh;
  });
  cells.forEach((cell, i) => {
    doc.text(cell, cols[i]!.x, y, { width: cols[i]!.w });
  });
  doc.y = y + maxH + 4;
  doc.strokeColor(LINE).lineWidth(0.5)
    .moveTo(cols[0]!.x - 2, doc.y - 2)
    .lineTo(cols.reduce((s, c) => s + c.w + 6, cols[0]!.x) - 8, doc.y - 2)
    .stroke();
}

/** Add a new page if fewer than `needed` px remain; optionally re-draw a header. */
function ensureSpace(doc: PDFKit.PDFDocument, needed: number, onNewPage?: () => void) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) {
    doc.addPage();
    if (onNewPage) onNewPage();
  }
}
