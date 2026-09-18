import path from "node:path";

import { Document, Image, Link, Page, StyleSheet, Text, View, renderToBuffer, type TextProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";

import { formatBusinessDate, formatDateTime, formatTime } from "@/lib/utils/dates";
import type { Attachment } from "@/types";

import {
  REPORT_EMPTY_MESSAGES,
  REPORT_IMPORTANCE_LABELS,
  recordDocuments,
  recordPhotos,
  isLinkableUrl,
  noDailyUpdatesMessage,
  reportRangeHeading,
} from "./labels";
import type { ReportData, ReportDailyRecord, ReportOfficeSection, ReportTotals, ReportVisitor } from "./types";

/**
 * PDF export (A4 portrait) rendered with @react-pdf/renderer using the built-in Helvetica family only,
 * so no fonts are fetched over the network. Must not import server-only code.
 */

/** A4 portrait height in points. */
const A4_HEIGHT_PT = 841.89;

/** Rows/blocks with at most this much text are kept on one page; longer ones may split so they never overflow. */
const ROW_KEEP_TOGETHER_CHARS = 600;
const MILESTONE_KEEP_TOGETHER_CHARS = 2000;

const COLORS = {
  text: "#1f2937",
  muted: "#64748b",
  accent: "#1e3a5f",
  border: "#cbd5e1",
  hairline: "#e2e8f0",
  panel: "#f8fafc",
  header: "#eef2f7",
  link: "#1d4ed8",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 54,
    paddingBottom: 54,
    paddingHorizontal: 40,
    fontFamily: "Helvetica",
    fontSize: 9,
    lineHeight: 1.4,
    color: COLORS.text,
  },
  runningHeader: { position: "absolute", top: 22, left: 40, right: 40 },
  runningHeaderInner: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 4,
    fontSize: 7.5,
    color: COLORS.muted,
  },
  // Anchored from the top: a fixed element positioned with `bottom` does not repeat reliably on wrapped pages.
  footer: {
    position: "absolute",
    top: A4_HEIGHT_PT - 38,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 4,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.border,
    fontSize: 7.5,
    color: COLORS.muted,
  },
  eyebrow: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 0.6,
    color: COLORS.accent,
    textTransform: "uppercase",
  },
  // Unitless lineHeight resolves against the declaring node's font size, so larger text sets its own.
  title: { fontFamily: "Helvetica-Bold", fontSize: 20, lineHeight: 1.2, marginTop: 4, color: "#0f172a" },
  subtitle: { fontSize: 11, lineHeight: 1.3, color: COLORS.muted, marginTop: 2 },
  titleRule: { height: 2, backgroundColor: COLORS.accent, marginTop: 10, marginBottom: 12 },
  metaBox: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderWidth: 0.75,
    borderColor: COLORS.border,
    backgroundColor: COLORS.panel,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  metaItem: { width: "50%", flexDirection: "row", paddingVertical: 2.5, paddingRight: 8 },
  metaLabel: { width: 74, fontFamily: "Helvetica-Bold", color: COLORS.muted, fontSize: 8.5 },
  metaValue: { flex: 1, fontSize: 9 },
  sectionHeading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    lineHeight: 1.3,
    color: COLORS.accent,
    marginTop: 16,
    marginBottom: 6,
    paddingBottom: 3,
    borderBottomWidth: 0.75,
    borderBottomColor: COLORS.border,
  },
  statRow: { flexDirection: "row", marginHorizontal: -3 },
  statBox: {
    flex: 1,
    marginHorizontal: 3,
    borderWidth: 0.75,
    borderColor: COLORS.border,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  statValue: { fontFamily: "Helvetica-Bold", fontSize: 16, lineHeight: 1.2, color: "#0f172a" },
  statLabel: { fontSize: 7.5, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  officeBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: COLORS.accent,
    color: "#ffffff",
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginTop: 20,
  },
  officeName: { fontFamily: "Helvetica-Bold", fontSize: 12, lineHeight: 1.3, flex: 1, paddingRight: 8 },
  officeCode: { fontSize: 8.5, letterSpacing: 0.5 },
  officeStats: { fontSize: 8, color: COLORS.muted, marginTop: 4 },
  record: { marginBottom: 10 },
  dateBar: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9.5,
    lineHeight: 1.35,
    backgroundColor: COLORS.header,
    paddingVertical: 3,
    paddingHorizontal: 6,
    marginBottom: 5,
  },
  recordBody: { paddingHorizontal: 6 },
  label: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 5,
    marginBottom: 2,
  },
  updateTitle: { fontFamily: "Helvetica-Bold", fontSize: 10, lineHeight: 1.35 },
  paragraph: { marginTop: 1 },
  milestone: {
    borderLeftWidth: 2,
    borderLeftColor: COLORS.border,
    paddingLeft: 7,
    marginBottom: 5,
  },
  milestoneTitle: { fontFamily: "Helvetica-Bold" },
  remarks: { fontFamily: "Helvetica-Oblique", color: "#475569", marginTop: 1 },
  empty: {
    fontFamily: "Helvetica-Oblique",
    color: COLORS.muted,
    paddingVertical: 4,
  },
  emptyBox: {
    fontFamily: "Helvetica-Oblique",
    color: COLORS.muted,
    borderWidth: 0.75,
    borderColor: COLORS.hairline,
    backgroundColor: COLORS.panel,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  attachmentGroup: { flexDirection: "row", marginTop: 1 },
  itemAttachments: { marginTop: 2, marginBottom: 2 },
  attachmentKind: { width: 62, color: COLORS.muted },
  attachmentList: { flex: 1 },
  link: { color: COLORS.link, textDecoration: "none" },
  table: { borderWidth: 0.75, borderColor: COLORS.border },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: COLORS.header,
    borderBottomWidth: 0.75,
    borderBottomColor: COLORS.border,
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
  },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: COLORS.hairline, fontSize: 8 },
  tableRowLast: { flexDirection: "row", fontSize: 8 },
  cell: { paddingVertical: 3, paddingHorizontal: 4 },
  totalRow: {
    flexDirection: "row",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    backgroundColor: COLORS.panel,
    borderTopWidth: 0.75,
    borderTopColor: COLORS.border,
  },
});

// Standard PDF fonts only cover Windows-1252. Characters outside it would render as garbage glyphs.
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

function pdfText(value: string): string {
  let result = "";
  // The rupee sign is outside Windows-1252; spell it out rather than printing "?".
  for (const char of value.replace(/\r\n?/g, "\n").replace(/₹/g, "Rs.")) {
    const code = char.codePointAt(0) ?? 0;
    if (char === "\n" || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(char)) {
      result += char;
    } else if (char === "\t") {
      result += " ";
    } else if (code >= 0x20) {
      result += "?";
    }
  }
  return result;
}

const LONG_WORD = 20;
const MAX_WORD_PIECE = 10;
const BREAK_AFTER = new Set(["/", "-", "_", ".", "?", "&", "=", ",", ":", ";", "|", ")", "]"]);

/**
 * Line-break opportunities for long unbroken tokens (URLs, IDs) so they wrap instead of overflowing:
 * after URL/punctuation characters, or every few characters. Normal words are left whole (no dictionary
 * hyphenation). react-pdf draws a hyphen at such breaks; that is the price of never overflowing a column.
 */
function breakLongWords(word: string): string[] {
  if (word.length <= LONG_WORD) return [word];
  const parts: string[] = [];
  let piece = "";
  for (const char of word) {
    piece += char;
    if (BREAK_AFTER.has(char) || piece.length >= MAX_WORD_PIECE) {
      parts.push(piece);
      piece = "";
    }
  }
  if (piece) parts.push(piece);
  return parts;
}

function Para({ children, style }: { children: string; style?: TextProps["style"] }) {
  return (
    <Text style={style} hyphenationCallback={breakLongWords}>
      {pdfText(children)}
    </Text>
  );
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function AttachmentLinks({ files }: { files: Attachment[] }) {
  return (
    <View style={styles.attachmentList}>
      {files.map((file, index) =>
        isLinkableUrl(file.fileUrl) ? (
          <Link key={`${file.fileUrl}-${index}`} href={file.fileUrl} style={styles.link}>
            <Text hyphenationCallback={breakLongWords}>{pdfText(file.fileName)}</Text>
          </Link>
        ) : (
          <Para key={`${file.fileUrl}-${index}`}>{file.fileName}</Para>
        ),
      )}
    </View>
  );
}

function Attachments({ photos, documents }: { photos: Attachment[]; documents: Attachment[] }) {
  if (photos.length === 0 && documents.length === 0) {
    return <Text style={styles.empty}>No attachments.</Text>;
  }
  return (
    <View>
      {photos.length > 0 ? (
        <View style={styles.attachmentGroup}>
          <Text style={styles.attachmentKind}>Photos ({photos.length})</Text>
          <AttachmentLinks files={photos} />
        </View>
      ) : null}
      {documents.length > 0 ? (
        <View style={styles.attachmentGroup}>
          <Text style={styles.attachmentKind}>Documents ({documents.length})</Text>
          <AttachmentLinks files={documents} />
        </View>
      ) : null}
    </View>
  );
}

/** Files attached to one daily update or milestone, printed with it. Nothing is printed when empty. */
function ItemAttachments({ item }: { item?: { photos: Attachment[]; documents: Attachment[] } }) {
  if (!item || (item.photos.length === 0 && item.documents.length === 0)) return null;
  return (
    <View style={styles.itemAttachments}>
      <Attachments photos={item.photos} documents={item.documents} />
    </View>
  );
}

/**
 * Closing file section. Files attached to an update or a milestone are printed with it, so this lists
 * only what was attached to the day itself — or says the record has no files at all.
 */
function DayFiles({ record }: { record: ReportDailyRecord }) {
  const hasDayFiles = record.photos.length > 0 || record.documents.length > 0;
  const hasAnyFiles = recordPhotos(record).length > 0 || recordDocuments(record).length > 0;
  if (!hasDayFiles && hasAnyFiles) return null;
  return (
    <View>
      <Text style={styles.label} minPresenceAhead={16}>
        {hasDayFiles ? "Other files for this day" : "Attachments"}
      </Text>
      <Attachments photos={record.photos} documents={record.documents} />
    </View>
  );
}

function DailyRecordBlock({ record }: { record: ReportDailyRecord }) {
  return (
    <View style={styles.record}>
      {/* Keep the date bar with the update title so it is never stranded at the bottom of a page. */}
      <View wrap={false} minPresenceAhead={30}>
        <Text style={styles.dateBar}>{formatBusinessDate(record.date, "long")}</Text>
        <View style={styles.recordBody}>
          <Text style={styles.label}>
            {record.dailyUpdates.length === 1
              ? "Daily Update"
              : `Daily Updates (${record.dailyUpdates.length})`}
          </Text>
          <Para style={styles.updateTitle}>{record.dailyUpdates[0]?.title ?? ""}</Para>
        </View>
      </View>
      <View style={styles.recordBody}>
        <Para style={styles.paragraph}>{record.dailyUpdates[0]?.description ?? ""}</Para>
        <ItemAttachments item={record.dailyUpdates[0]} />
        {record.dailyUpdates.slice(1).map((update, index) => (
          <View key={`${index}-${update.title}`}>
            <Para style={styles.updateTitle}>{update.title}</Para>
            <Para style={styles.paragraph}>{update.description}</Para>
            <ItemAttachments item={update} />
          </View>
        ))}

        <Text style={styles.label} minPresenceAhead={24}>
          Milestones ({record.milestones.length})
        </Text>
        {record.milestones.length === 0 ? (
          <Text style={styles.empty}>{REPORT_EMPTY_MESSAGES.milestones}</Text>
        ) : (
          record.milestones.map((milestone, index) => (
            <View
              key={index}
              style={styles.milestone}
              wrap={milestone.description.length + milestone.remarks.length > MILESTONE_KEEP_TOGETHER_CHARS}
            >
              <Para style={styles.milestoneTitle}>{`${index + 1}. ${milestone.title}`}</Para>
              {milestone.description ? <Para>{milestone.description}</Para> : null}
              {milestone.remarks ? <Para style={styles.remarks}>{`Remarks: ${milestone.remarks}`}</Para> : null}
              <ItemAttachments item={milestone} />
            </View>
          ))
        )}

        <DayFiles record={record} />
      </View>
    </View>
  );
}

const VISITOR_COLUMNS = [
  { header: "Name", width: "16%" },
  { header: "Purpose", width: "21%" },
  { header: "Date", width: "12%" },
  { header: "Arrival", width: "10%" },
  { header: "Departure", width: "10%" },
  { header: "Importance", width: "10%" },
  { header: "Remarks", width: "21%" },
] as const;

function VisitorTable({ visitors }: { visitors: ReportVisitor[] }) {
  return (
    <View style={styles.table}>
      <View style={styles.tableHeader} fixed wrap={false}>
        {VISITOR_COLUMNS.map((column) => (
          <Text key={column.header} style={[styles.cell, { width: column.width }]}>
            {column.header}
          </Text>
        ))}
      </View>
      {visitors.map((visitor, index) => {
        const cells = [
          visitor.name,
          visitor.purpose,
          formatBusinessDate(visitor.date),
          formatTime(visitor.timeArrived),
          visitor.timeDeparted ? formatTime(visitor.timeDeparted) : "—",
          REPORT_IMPORTANCE_LABELS[visitor.importance],
          visitor.remarks || "—",
        ];
        // Keep a row on one page so its cells never split apart, unless it could be taller than a page.
        const keepTogether = Math.max(...cells.map((value) => value.length)) <= ROW_KEEP_TOGETHER_CHARS;
        return (
          <View
            key={visitor.id}
            style={index === visitors.length - 1 ? styles.tableRowLast : styles.tableRow}
            wrap={!keepTogether}
          >
            {cells.map((value, cellIndex) => (
              <Para key={VISITOR_COLUMNS[cellIndex].header} style={[styles.cell, { width: VISITOR_COLUMNS[cellIndex].width }]}>
                {value}
              </Para>
            ))}
          </View>
        );
      })}
    </View>
  );
}

function VisitorAttachments({ visitors }: { visitors: ReportVisitor[] }) {
  const withFiles = visitors.filter((visitor) => visitor.photos.length > 0 || visitor.documents.length > 0);
  if (withFiles.length === 0) return null;
  return (
    <View>
      <Text style={[styles.label, { marginTop: 8 }]} minPresenceAhead={24}>
        Visitor Attachments
      </Text>
      {withFiles.map((visitor) => (
        <View key={visitor.id} style={styles.milestone} wrap={false}>
          <Para style={styles.milestoneTitle}>{`${visitor.name} (${formatBusinessDate(visitor.date)})`}</Para>
          <Attachments photos={visitor.photos} documents={visitor.documents} />
        </View>
      ))}
    </View>
  );
}

function OfficeSection({ section, data }: { section: ReportOfficeSection; data: ReportData }) {
  const { totals } = section;
  return (
    <View>
      <View wrap={false} minPresenceAhead={90}>
        <View style={styles.officeBar}>
          <Text style={styles.officeName}>{pdfText(section.office.name)}</Text>
          {section.office.code ? <Text style={styles.officeCode}>{pdfText(section.office.code)}</Text> : null}
        </View>
        <Text style={styles.officeStats}>
          {[
            plural(totals.dailyRecords, "daily update"),
            plural(totals.milestones, "milestone"),
            plural(totals.visitors, "visitor"),
            plural(totals.photos, "photo"),
            plural(totals.documents, "document"),
          ].join("  ·  ")}
        </Text>
      </View>

      <Text style={styles.sectionHeading} minPresenceAhead={60}>
        Daily Updates &amp; Milestones
      </Text>
      {section.dailyRecords.length === 0 ? (
        <Text style={styles.emptyBox}>{noDailyUpdatesMessage(data.meta.from, data.meta.to)}</Text>
      ) : (
        section.dailyRecords.map((record) => <DailyRecordBlock key={record.id} record={record} />)
      )}

      <Text style={styles.sectionHeading} minPresenceAhead={50}>
        Visitors
      </Text>
      {section.visitors.length === 0 ? (
        <Text style={styles.emptyBox}>{REPORT_EMPTY_MESSAGES.visitors}</Text>
      ) : (
        <>
          <VisitorTable visitors={section.visitors} />
          <VisitorAttachments visitors={section.visitors} />
        </>
      )}
    </View>
  );
}

const STAT_LABELS: [keyof ReportTotals, string][] = [
  ["dailyRecords", "Daily Updates"],
  ["milestones", "Milestones"],
  ["visitors", "Visitors"],
  ["photos", "Photos"],
  ["documents", "Documents"],
];

const SUMMARY_WIDTHS = { office: "35%", number: "13%" };

function Summary({ data }: { data: ReportData }) {
  return (
    <View>
      <Text style={styles.sectionHeading} minPresenceAhead={50}>
        Summary
      </Text>
      <View style={styles.statRow} wrap={false}>
        {STAT_LABELS.map(([key, label]) => (
          <View key={key} style={styles.statBox}>
            <Text style={styles.statValue}>{data.totals[key]}</Text>
            <Text style={styles.statLabel}>{label}</Text>
          </View>
        ))}
      </View>

      {data.sections.length > 1 ? (
        <View style={[styles.table, { marginTop: 10 }]}>
          <View style={styles.tableHeader} wrap={false}>
            <Text style={[styles.cell, { width: SUMMARY_WIDTHS.office }]}>Office</Text>
            {STAT_LABELS.map(([key, label]) => (
              <Text key={key} style={[styles.cell, { width: SUMMARY_WIDTHS.number, textAlign: "right" }]}>
                {label}
              </Text>
            ))}
          </View>
          {data.sections.map((section) => (
            <View key={section.office.id} style={styles.tableRow} wrap={false}>
              <Para style={[styles.cell, { width: SUMMARY_WIDTHS.office }]}>{section.office.name}</Para>
              {STAT_LABELS.map(([key]) => (
                <Text key={key} style={[styles.cell, { width: SUMMARY_WIDTHS.number, textAlign: "right" }]}>
                  {section.totals[key]}
                </Text>
              ))}
            </View>
          ))}
          <View style={styles.totalRow} wrap={false}>
            <Text style={[styles.cell, { width: SUMMARY_WIDTHS.office }]}>Total</Text>
            {STAT_LABELS.map(([key]) => (
              <Text key={key} style={[styles.cell, { width: SUMMARY_WIDTHS.number, textAlign: "right" }]}>
                {data.totals[key]}
              </Text>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ReportDocument({ data }: { data: ReportData }) {
  const { meta } = data;
  const generated = formatDateTime(meta.generatedAt);
  const details: [string, string][] = [
    ["Office", meta.officeLabel],
    ["Report Type", meta.typeLabel],
    [reportRangeHeading(meta.from, meta.to), meta.rangeLabel],
    ["Generated", generated],
    ["Generated By", meta.generatedBy],
  ];

  return (
    <Document
      title={pdfText(`${meta.typeLabel} - ${meta.officeLabel} - ${meta.rangeLabel}`)}
      author={pdfText(meta.generatedBy)}
      creator={meta.systemName}
      producer={meta.systemName}
      subject={meta.typeLabel}
      language="en"
    >
      <Page size="A4" orientation="portrait" style={styles.page} wrap>
        {/* Fixed page chrome must come before the flowing content so it repeats on every page. */}
        <View style={styles.footer} fixed>
          <Text>{pdfText(`${meta.systemName} · Generated ${generated}`)}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
        {/*
          A `render` prop on a View that returns another View breaks pdfkit layout past ~9 pages
          ("unsupported number"). Keep the View static and only render dynamic Text content.
        */}
        <View style={[styles.runningHeader, styles.runningHeaderInner]} fixed>
          <Text render={({ pageNumber }) => (pageNumber > 1 ? pdfText(`${meta.typeLabel} · ${meta.officeLabel}`) : "")} />
          <Text render={({ pageNumber }) => (pageNumber > 1 ? pdfText(meta.rangeLabel) : "")} />
        </View>

        <View>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop */}
          <Image src={path.join(process.cwd(), "public", "xlri-logo.png")} style={{ width: 118, height: 50.6, marginBottom: 10 }} />
          <Text style={styles.eyebrow}>{meta.systemName}</Text>
          <Text style={styles.title}>{meta.typeLabel}</Text>
          <Para style={styles.subtitle}>{`${meta.officeLabel} · ${meta.rangeLabel}`}</Para>
          <View style={styles.titleRule} />
          <View style={styles.metaBox}>
            {details.map(([label, value]) => (
              <View key={label} style={styles.metaItem}>
                <Text style={styles.metaLabel}>{label}</Text>
                <Para style={styles.metaValue}>{value}</Para>
              </View>
            ))}
          </View>
        </View>

        <Summary data={data} />

        {data.sections.map((section) => (
          <OfficeSection key={section.office.id} section={section} data={data} />
        ))}
      </Page>
    </Document>
  );
}

export async function renderReportPdf(data: ReportData): Promise<Buffer> {
  const document: ReactElement<Parameters<typeof renderToBuffer>[0]["props"]> = <ReportDocument data={data} />;
  return renderToBuffer(document);
}
