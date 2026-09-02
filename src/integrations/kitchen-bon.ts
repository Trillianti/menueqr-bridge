import { parseKitchenPrintJob, type AdapterCommandMode } from "../contracts";

export type BonDocument = {
  title: "BESTELLUNG";
  restaurantName: string;
  orderReference: string;
  orderAction:
    | "additional"
    | "change"
    | "cancellation"
    | "full_cancellation"
    | null;
  additionalOrder: boolean;
  serviceSequence: number;
  previousOrderReference: string | null;
  previousItem: {
    name: string;
    variation: string | null;
    notes: string | null;
    quantity: number;
  } | null;
  quantityDelta: number;
  tableLabel: string;
  localTimeLabel: string;
  localDateLabel: string;
  lines: Array<{
    quantity: number;
    name: string;
    variation: string | null;
    notes: string | null;
    unitPrice: string;
    lineTotal: string;
  }>;
  notes: string | null;
  totalAmount: string;
  currency: string;
  reprint: boolean;
};

export type BonRenderOptions = {
  commandMode: AdapterCommandMode;
  paperWidthMm: 80 | 82;
  encoding: "cp437" | "cp850" | "windows1252";
  cutAfterPrint: boolean;
  timeZone?: string;
  layoutProfile?: BonLayoutProfile;
};

export type BonLayoutProfile = "compact" | "kitchen" | "detailed";

// The public order contract permits 50 items, 600-character item notes, and a
// 1,200-character order note. Keep the line guard above that valid worst case;
// MAX_BYTES remains the final transport-safety bound.
const MAX_LINES = 2_200;
const MAX_BYTES = 64 * 1024;
const REPRINT_MARKER = "******* NACHDRUCK *******";

export function buildBonDocument(
  payload: unknown,
  timeZone?: string,
): BonDocument {
  const job = parseKitchenPrintJob(payload);
  const local = formatLocalDateTime(
    job.createdAt,
    timeZone ?? job.timeZone ?? "Europe/Vienna",
  );
  return {
    title: "BESTELLUNG",
    restaurantName: sanitizeText(job.restaurantName, 120),
    orderReference: sanitizeText(job.orderReference, 80),
    orderAction: job.orderAction ?? null,
    additionalOrder: job.orderKind === "additional",
    serviceSequence: job.serviceSequence ?? 1,
    previousOrderReference: job.previousOrderReference
      ? sanitizeText(job.previousOrderReference, 80)
      : null,
    previousItem: job.previousItem
      ? {
          name: sanitizeText(job.previousItem.name, 240),
          variation: job.previousItem.variation
            ? sanitizeText(job.previousItem.variation, 160)
            : null,
          notes: job.previousItem.notes
            ? sanitizeText(job.previousItem.notes, 600)
            : null,
          quantity: job.previousItem.quantity,
        }
      : null,
    quantityDelta: job.quantityDelta ?? 0,
    tableLabel: `TISCH ${job.tableNumber}`,
    localTimeLabel: local.time,
    localDateLabel: local.date,
    lines: job.items.map((item) => ({
      quantity: item.quantity,
      name: sanitizeText(item.name, 240),
      variation: item.variation ? sanitizeText(item.variation, 160) : null,
      notes: item.notes ? sanitizeText(item.notes, 600) : null,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
    notes: job.notes ? sanitizeText(job.notes, 1_200) : null,
    totalAmount: job.totalAmount,
    currency: sanitizeText(job.currency, 8).toUpperCase(),
    reprint: job.reprint === true,
  };
}

export function renderKitchenBon(
  payload: unknown,
  options: BonRenderOptions,
): Buffer {
  const lines = renderKitchenBonLines(payload, options);
  if (lines.length > MAX_LINES) throw new Error("BON_TOO_MANY_LINES");
  const content = encodeLines(lines, options.encoding);
  const command =
    options.commandMode === "esc_pos"
      ? wrapEscPos(content, options.cutAfterPrint)
      : wrapStarLine(content, options.cutAfterPrint);
  if (command.byteLength > MAX_BYTES) throw new Error("BON_TOO_LARGE");
  return command;
}

export function renderKitchenBonLines(
  payload: unknown,
  options: Pick<
    BonRenderOptions,
    "paperWidthMm" | "encoding" | "timeZone" | "layoutProfile"
  >,
): string[] {
  const document = buildBonDocument(payload, options.timeZone);
  const width = options.paperWidthMm === 82 ? 50 : 48;
  return documentLines(
    document,
    width,
    options.encoding,
    options.layoutProfile ?? "detailed",
  );
}

export function createStaticTestBon(options: BonRenderOptions): Buffer {
  const lines = staticTestBonLines(options);
  const content = encodeLines(lines, options.encoding);
  return options.commandMode === "esc_pos"
    ? wrapEscPos(content, options.cutAfterPrint)
    : wrapStarLine(content, options.cutAfterPrint);
}

export function createStaticTestBonText(options: BonRenderOptions): string {
  return `${staticTestBonLines(options).join("\r\n")}\r\n`;
}

export function renderKitchenBonText(
  payload: unknown,
  options: BonRenderOptions,
): string {
  return `${renderKitchenBonLines(payload, options).join("\r\n")}\r\n`;
}

function staticTestBonLines(options: BonRenderOptions): string[] {
  return [
    "MENÜQR BRIDGE TEST",
    "DIESER DRUCKER",
    "IST MIT MENÜQR VERBUNDEN",
    "TESTDRUCK",
    `WIDTH: ${options.paperWidthMm}MM`,
    "ÄÖÜ äöü ß",
    new Date(0).toISOString(),
    "",
  ].map((line) => printableText(line, options.encoding));
}

function documentLines(
  document: BonDocument,
  width: number,
  encoding: BonRenderOptions["encoding"],
  layoutProfile: BonLayoutProfile,
): string[] {
  const line = "=".repeat(width);
  const divider = "-".repeat(width);
  const restaurantName = printableText(
    document.restaurantName.toLocaleUpperCase("de-DE"),
    encoding,
  );
  const lines: string[] = [];

  if (document.reprint) lines.push(REPRINT_MARKER, "");
  if (document.orderAction === "full_cancellation") {
    lines.push(
      centerLine("******* STORNIERUNG *******", width),
      centerLine("GESAMTE BESTELLUNG", width),
      `Zu Bestellung #${printableText(document.orderReference, encoding)}`,
      "",
    );
  } else if (document.orderAction === "cancellation") {
    lines.push(
      centerLine("******* STORNIERUNG *******", width),
      `Zu Bestellung #${printableText(document.orderReference, encoding)}`,
      "",
    );
  } else if (document.orderAction === "change") {
    lines.push(
      centerLine("******** ÄNDERUNG ********", width),
      `Zu Bestellung #${printableText(document.orderReference, encoding)}`,
      "",
    );
  } else if (document.orderAction === "additional") {
    lines.push(
      centerLine(
        `***** NACHBESTELLUNG ${document.serviceSequence} *****`,
        width,
      ),
      `Zu Bestellung #${printableText(document.orderReference, encoding)}`,
      "",
    );
  } else if (document.additionalOrder) {
    lines.push(
      centerLine(
        `***** NACHBESTELLUNG ${document.serviceSequence} *****`,
        width,
      ),
      ...(document.previousOrderReference
        ? [
            `Zu Bestellung #${printableText(
              document.previousOrderReference,
              encoding,
            )}`,
          ]
        : []),
      "",
    );
  }
  if (layoutProfile === "compact") {
    lines.push(
      line,
      alignColumns(document.tableLabel, document.localTimeLabel, width),
      `Bestellung #${printableText(document.orderReference, encoding)}`,
      line,
    );
  } else {
    lines.push(
      line,
      centerLine(restaurantName, width),
      centerLine(document.title, width),
      line,
      "",
      alignColumns(document.tableLabel, document.localTimeLabel, width),
      ...metadataLines(
        `Bestellung #${printableText(document.orderReference, encoding)}`,
        document.localDateLabel,
        width,
        0,
      ),
      "",
      divider,
    );
  }

  document.lines.forEach((item, index) => {
    if (document.orderAction === "change" && document.previousItem) {
      lines.push(
        ...wrapPrefixedText(
          "ALT: ",
          `${document.previousItem.quantity} x ${printableText(
            document.previousItem.name,
            encoding,
          )}`,
          width,
        ),
      );
      if (document.previousItem.variation) {
        lines.push(
          ...wrapIndentedText(
            printableText(document.previousItem.variation, encoding),
            width,
          ),
        );
      }
      if (document.previousItem.notes) {
        lines.push(
          "ALT HINWEIS:",
          ...wrapIndentedText(
            printableText(
              document.previousItem.notes.toLocaleUpperCase("de-DE"),
              encoding,
            ),
            width,
          ),
        );
      }
      lines.push(
        ...wrapPrefixedText(
          "NEU: ",
          `${item.quantity} x ${printableText(item.name, encoding)}`,
          width,
        ),
      );
      if (item.variation) {
        lines.push(
          ...wrapIndentedText(printableText(item.variation, encoding), width),
        );
      }
      if (document.quantityDelta > 0) {
        lines.push(`ZUSÄTZLICH: ${document.quantityDelta}`);
      } else if (document.quantityDelta < 0) {
        lines.push(`STORNIEREN: ${Math.abs(document.quantityDelta)}`);
      } else {
        lines.push("MENGE UNVERÄNDERT");
      }
      if (item.notes) {
        lines.push(
          "NEU HINWEIS:",
          ...wrapIndentedText(
            printableText(item.notes.toLocaleUpperCase("de-DE"), encoding),
            width,
          ),
        );
      } else if (document.previousItem.notes) {
        lines.push("NEU HINWEIS: KEIN HINWEIS");
      }
      if (index < document.lines.length - 1) lines.push("");
      return;
    }

    if (
      document.orderAction === "cancellation" ||
      document.orderAction === "full_cancellation"
    ) {
      lines.push(
        ...wrapPrefixedText(
          `${item.quantity} x `,
          printableText(item.name, encoding),
          width,
        ),
      );
      if (item.variation) {
        lines.push(
          ...wrapIndentedText(printableText(item.variation, encoding), width),
        );
      }
      lines.push(`STORNIEREN: ${item.quantity}`);
      if (item.notes) {
        lines.push(
          ...wrapIndentedText(
            printableText(item.notes.toLocaleUpperCase("de-DE"), encoding),
            width,
          ),
        );
      }
      if (index < document.lines.length - 1) lines.push("");
      return;
    }

    lines.push(
      ...wrapPrefixedText(
        `${item.quantity} x `,
        printableText(item.name, encoding),
        width,
      ),
    );
    if (item.variation) {
      lines.push(
        ...wrapIndentedText(printableText(item.variation, encoding), width),
      );
    }
    if (layoutProfile === "detailed" && !document.orderAction) {
      lines.push(
        ...priceLines(
          formatMoney(item.unitPrice, document.currency, encoding),
          formatMoney(item.lineTotal, document.currency, encoding),
          width,
        ),
      );
    }
    if (item.notes) {
      lines.push(
        ...wrapIndentedText(
          printableText(item.notes.toLocaleUpperCase("de-DE"), encoding),
          width,
        ),
      );
    }
    if (index < document.lines.length - 1) lines.push("");
  });

  if (
    (layoutProfile === "detailed" && !document.orderAction) ||
    document.notes
  )
    lines.push(divider);
  if (document.notes) {
    lines.push(
      "",
      "ANMERKUNG:",
      ...wrapText(
        printableText(document.notes.toLocaleUpperCase("de-DE"), encoding),
        width,
      ),
      "",
      divider,
    );
  }
  if (layoutProfile === "detailed" && !document.orderAction) {
    lines.push(
      alignColumns(
        "GESAMT:",
        formatMoney(document.totalAmount, document.currency, encoding),
        width,
      ),
      line,
    );
  } else {
    lines.push(line);
  }
  return lines;
}

function metadataLines(
  left: string,
  right: string,
  width: number,
  rightMargin: number,
): string[] {
  if (left.length + right.length + 1 <= width - rightMargin) {
    return [alignColumns(left, right, width, rightMargin)];
  }
  return [...wrapText(left, width), right.padStart(width - rightMargin)];
}

function priceLines(unitPrice: string, lineTotal: string, width: number) {
  const left = `    je ${unitPrice}`;
  if (left.length + lineTotal.length + 1 <= width) {
    return [alignColumns(left, lineTotal, width)];
  }
  return [...wrapText(left, width), lineTotal.padStart(width)];
}

function wrapPrefixedText(prefix: string, value: string, width: number) {
  const firstWidth = Math.max(1, width - prefix.length);
  const wrapped = wrapText(value, firstWidth);
  if (wrapped.length === 0) return [prefix.trimEnd()];
  return wrapped.map((line, index) =>
    index === 0 ? `${prefix}${line}` : `    ${line}`,
  );
}

function wrapIndentedText(value: string, width: number) {
  return wrapText(value, Math.max(1, width - 4)).map((line) => `    ${line}`);
}

function centerLine(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width);
  const padding = Math.max(0, Math.floor((width - value.length) / 2));
  return `${" ".repeat(padding)}${value}`;
}

function alignColumns(
  left: string,
  right: string,
  width: number,
  rightMargin = 0,
): string {
  const usableWidth = Math.max(1, width - rightMargin);
  if (left.length + right.length >= usableWidth) {
    return `${left.slice(0, Math.max(0, usableWidth - right.length - 1))} ${right}`;
  }
  return `${left}${" ".repeat(usableWidth - left.length - right.length)}${right}`;
}

export function wrapText(value: string, width: number): string[] {
  const sanitized = sanitizeText(value, 1_200);
  if (!sanitized) return [];
  const words = sanitized.split(" ");
  const result: string[] = [];
  let line = "";
  for (const word of words) {
    if (word.length > width) {
      if (line) {
        result.push(line);
        line = "";
      }
      for (let index = 0; index < word.length; index += width) {
        result.push(word.slice(index, index + width));
      }
      continue;
    }
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > width) {
      if (line) result.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) result.push(line);
  return result;
}

export function sanitizeText(value: string, maxLength: number): string {
  return value
    .replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function formatMoney(
  value: string,
  currency: string,
  encoding: BonRenderOptions["encoding"] = "windows1252",
): string {
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new Error("BON_INVALID_DECIMAL");
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const amount = `${negative ? "-" : ""}${grouped},${fraction.padEnd(2, "0")}`;
  const normalizedCurrency = sanitizeText(currency, 8).toUpperCase();
  const currencyLabel =
    normalizedCurrency === "EUR" && encoding === "windows1252"
      ? "€"
      : normalizedCurrency;
  return `${amount} ${currencyLabel}`;
}

function formatLocalDateTime(timestamp: string, timeZone: string) {
  const date = new Date(timestamp);
  const parts = new Intl.DateTimeFormat("de-DE", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return {
    date: `${part("day")}.${part("month")}.${part("year")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

function printableText(
  value: string,
  encoding: BonRenderOptions["encoding"],
): string {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 63;
      if (code >= 32 && code <= 126) return character;
      return codePageByte(character, encoding) !== null
        ? character
        : transliterate(character);
    })
    .join("");
}

function encodeLines(
  lines: readonly string[],
  encoding: BonRenderOptions["encoding"],
): Buffer {
  return Buffer.concat(
    lines.map((line) =>
      Buffer.concat([encodeText(line, encoding), Buffer.from("\n")]),
    ),
  );
}

export function encodeText(
  value: string,
  encoding: BonRenderOptions["encoding"],
): Buffer {
  const result: number[] = [];
  for (const character of value) {
    const code = character.codePointAt(0) ?? 63;
    if (code >= 32 && code <= 126) {
      result.push(code);
      continue;
    }
    const mapped = codePageByte(character, encoding);
    if (mapped !== null) result.push(mapped);
    else result.push(...Buffer.from(transliterate(character), "ascii"));
  }
  return Buffer.from(result);
}

function codePageByte(
  character: string,
  encoding: BonRenderOptions["encoding"],
): number | null {
  const cp437: Record<string, number> = {
    Ä: 0x8e,
    Ö: 0x99,
    Ü: 0x9a,
    ä: 0x84,
    ö: 0x94,
    ü: 0x81,
    ß: 0xe1,
  };
  const windows1252: Record<string, number> = {
    Ä: 0xc4,
    Ö: 0xd6,
    Ü: 0xdc,
    ä: 0xe4,
    ö: 0xf6,
    ü: 0xfc,
    ß: 0xdf,
    "€": 0x80,
  };
  const map = encoding === "windows1252" ? windows1252 : cp437;
  return map[character] ?? null;
}

function transliterate(character: string): string {
  return (
    (
      {
        Ä: "Ae",
        Ö: "Oe",
        Ü: "Ue",
        ä: "ae",
        ö: "oe",
        ü: "ue",
        ß: "ss",
        "€": "EUR",
        "—": "-",
        "–": "-",
        "−": "-",
        "“": '"',
        "”": '"',
        "„": '"',
        "’": "'",
        "‘": "'",
        "…": "...",
      } as Record<string, string>
    )[character] ?? "?"
  );
}

function wrapEscPos(content: Buffer, cutAfterPrint: boolean): Buffer {
  return Buffer.concat([
    Buffer.from([0x1b, 0x40, 0x1b, 0x61, 0x00]),
    content,
    Buffer.from([0x1b, 0x64, 0x03]),
    ...(cutAfterPrint ? [Buffer.from([0x1d, 0x56, 0x00])] : []),
  ]);
}

function wrapStarLine(content: Buffer, cutAfterPrint: boolean): Buffer {
  return Buffer.concat([
    Buffer.from([0x1b, 0x40]),
    content,
    ...(cutAfterPrint ? [Buffer.from([0x1b, 0x64, 0x03])] : []),
  ]);
}
