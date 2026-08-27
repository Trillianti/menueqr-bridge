import {
  buildBonDocument,
  createStaticTestBon,
  encodeText,
  formatMoney,
  renderKitchenBon,
  renderKitchenBonLines,
  wrapText,
} from "../../src/integrations/kitchen-bon";

const sampleJob = {
  schemaVersion: 1,
  jobType: "kitchen_order",
  jobId: "job_1048",
  restaurantId: "restaurant_1",
  restaurantName: "Weingut Jäckel",
  orderId: "order_1048",
  orderReference: "1048",
  tableNumber: 4,
  createdAt: "2026-08-23T16:42:00.000Z",
  currency: "EUR",
  notes: "Schnitzel ohne Zwiebeln",
  items: [
    {
      itemId: "item_1",
      name: "Schnitzel",
      variation: null,
      quantity: 2,
      unitPrice: "18.00",
      lineTotal: "36.00",
    },
    {
      itemId: "item_2",
      name: "Beilagensalat",
      variation: null,
      quantity: 1,
      unitPrice: "7.50",
      lineTotal: "7.50",
    },
    {
      itemId: "item_3",
      name: "Traubensaft",
      variation: null,
      quantity: 2,
      unitPrice: "4.20",
      lineTotal: "8.40",
    },
  ],
  totalAmount: "51.90",
  reprint: false,
};

const options = {
  commandMode: "star_line" as const,
  paperWidthMm: 80 as const,
  encoding: "windows1252" as const,
  cutAfterPrint: true,
  timeZone: "Europe/Vienna",
};

function lines(job: unknown = sampleJob, overrides = {}) {
  return renderKitchenBonLines(job, { ...options, ...overrides });
}

describe("kitchen bon renderer", () => {
  it("matches the required 80 mm acceptance sample exactly", () => {
    expect(lines().join("\n")).toBe(`================================
        WEINGUT JÄCKEL
          BESTELLUNG
================================

TISCH 4                    18:42
Bestellung #1048        23.08.26

--------------------------------
2 x Schnitzel
    je 18,00 €           36,00 €

1 x Beilagensalat
    je 7,50 €             7,50 €

2 x Traubensaft
    je 4,20 €             8,40 €
--------------------------------

ANMERKUNG:
SCHNITZEL OHNE ZWIEBELN

--------------------------------
GESAMT:                  51,90 €
================================`);
  });

  it("renders a normal order without a reprint marker", () => {
    const output = lines({ ...sampleJob, notes: null });
    expect(output[0]).toBe("================================");
    expect(output).not.toContain("******* NACHDRUCK *******");
    expect(output).toContain("2 x Schnitzel");
  });

  it("renders a compact kitchen bon without restaurant, date, or prices", () => {
    const output = lines(
      {
        ...sampleJob,
        items: [{ ...sampleJob.items[0], notes: "ohne Zwiebeln" }],
        totalAmount: "36.00",
      },
      { layoutProfile: "compact" },
    );
    const text = output.join("\n");
    expect(output.slice(0, 4)).toEqual([
      "================================",
      "TISCH 4                    18:42",
      "Bestellung #1048",
      "================================",
    ]);
    expect(text).toContain("2 x Schnitzel");
    expect(text).toContain("    OHNE ZWIEBELN");
    expect(text).toContain("ANMERKUNG:");
    expect(text).not.toContain("WEINGUT");
    expect(text).not.toContain("23.08.26");
    expect(text).not.toContain("18,00");
    expect(text).not.toContain("GESAMT:");
  });

  it("renders a kitchen-plus bon with identity but without commercial values", () => {
    const output = lines(sampleJob, { layoutProfile: "kitchen" });
    const text = output.join("\n");
    expect(text).toContain("WEINGUT JÄCKEL");
    expect(text).toContain("BESTELLUNG");
    expect(text).toContain("23.08.26");
    expect(text).toContain("2 x Schnitzel");
    expect(text).not.toContain("18,00");
    expect(text).not.toContain("GESAMT:");
  });

  it("keeps the established detailed bon as the backwards-compatible profile", () => {
    expect(lines(sampleJob, { layoutProfile: "detailed" })).toEqual(lines());
    expect(
      lines(sampleJob, { layoutProfile: "detailed" }).join("\n"),
    ).toContain("GESAMT:                  51,90 €");
  });

  it("renders order and item notes in an uppercase kitchen hierarchy", () => {
    const output = lines({
      ...sampleJob,
      notes: "Bitte gemeinsam servieren",
      items: [
        {
          ...sampleJob.items[0],
          notes: "ohne Zwiebeln",
          variation: "Groß",
        },
      ],
      totalAmount: "36.00",
    });
    expect(output).toContain("    Groß");
    expect(output).toContain("    OHNE ZWIEBELN");
    expect(output).toContain("ANMERKUNG:");
    expect(output).toContain("BITTE GEMEINSAM SERVIEREN");
  });

  it("omits the empty note section", () => {
    const output = lines({ ...sampleJob, notes: null });
    expect(output).not.toContain("ANMERKUNG:");
  });

  it("wraps long dish names cleanly with an indented continuation", () => {
    const output = lines({
      ...sampleJob,
      notes: null,
      items: [
        {
          ...sampleJob.items[0],
          name: "Hausgemachte Schwarzwälder Käsespätzle mit Röstzwiebeln",
        },
      ],
      totalAmount: "36.00",
    });
    expect(output).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^2 x Hausgemachte/),
        expect.stringMatching(/^    /),
      ]),
    );
    expect(output.every((line) => line.length <= 32)).toBe(true);
  });

  it("wraps long notes without clipping or control-byte injection", () => {
    const output = lines({
      ...sampleJob,
      notes:
        "Allergie gegen Zwiebeln und Knoblauch. Bitte getrennt und sehr heiß servieren.\u001b[2J",
    });
    expect(output.join("\n")).toContain("ALLERGIE GEGEN ZWIEBELN");
    expect(output.join("\n")).not.toContain("\u001b");
    expect(output.every((line) => line.length <= 32)).toBe(true);
  });

  it("preserves supported German characters and transliterates unsupported currency", () => {
    expect(encodeText("ÄÖÜäöüß", "cp437")).toEqual(
      Buffer.from([0x8e, 0x99, 0x9a, 0x84, 0x94, 0x81, 0xe1]),
    );
    expect(encodeText("€", "windows1252")).toEqual(Buffer.from([0x80]));
    expect(lines(sampleJob, { encoding: "cp437" }).join("\n")).toContain(
      "18,00 EUR",
    );
  });

  it("accepts missing optional fields deterministically", () => {
    const { reprint: _reprint, ...withoutReprint } = sampleJob;
    const output = lines({
      ...withoutReprint,
      notes: null,
      items: withoutReprint.items,
    });
    expect(output[0]).toBe("================================");
    expect(output).not.toContain("ANMERKUNG:");
  });

  it("uses the required quantity format for multiple quantities", () => {
    expect(lines()).toEqual(
      expect.arrayContaining(["2 x Schnitzel", "2 x Traubensaft"]),
    );
  });

  it("places the reprint marker at the very top only for explicit reprints", () => {
    const reprint = lines({ ...sampleJob, reprint: true });
    expect(reprint[0]).toBe("******* NACHDRUCK *******");
    expect(reprint[1]).toBe("");
    expect(lines()[0]).not.toContain("NACHDRUCK");
  });

  it("formats and rounds real decimal snapshots as German currency", () => {
    expect(formatMoney("18", "EUR")).toBe("18,00 €");
    expect(formatMoney("7.5", "EUR")).toBe("7,50 €");
    expect(formatMoney("1234.56", "EUR")).toBe("1.234,56 €");
    expect(formatMoney("4.20", "EUR", "cp437")).toBe("4,20 EUR");
  });

  it("keeps visible content identical in Star Line and ESC/POS modes", () => {
    const star = renderKitchenBon(sampleJob, options);
    const esc = renderKitchenBon(sampleJob, {
      ...options,
      commandMode: "esc_pos",
    });
    expect(star.subarray(2, -3)).toEqual(esc.subarray(5, -6));
  });

  it("emits mode-correct cut commands only after complete content", () => {
    const star = renderKitchenBon(sampleJob, options);
    const starNoCut = renderKitchenBon(sampleJob, {
      ...options,
      cutAfterPrint: false,
    });
    const esc = renderKitchenBon(sampleJob, {
      ...options,
      commandMode: "esc_pos",
    });
    const escNoCut = renderKitchenBon(sampleJob, {
      ...options,
      commandMode: "esc_pos",
      cutAfterPrint: false,
    });
    expect(star.subarray(-3)).toEqual(Buffer.from([0x1b, 0x64, 0x03]));
    expect(starNoCut.subarray(-3)).not.toEqual(Buffer.from([0x1b, 0x64, 0x03]));
    expect(esc.subarray(-3)).toEqual(Buffer.from([0x1d, 0x56, 0x00]));
    expect(escNoCut.subarray(-3)).toEqual(Buffer.from([0x1b, 0x64, 0x03]));
  });

  it("respects the configured 82 mm line width", () => {
    const output = lines(sampleJob, { paperWidthMm: 82 });
    expect(output[0]).toBe("=".repeat(34));
    expect(output.every((line) => line.length <= 34)).toBe(true);
  });

  it("generates identical bytes for identical input and configuration", () => {
    expect(renderKitchenBon(sampleJob, options)).toEqual(
      renderKitchenBon(sampleJob, options),
    );
  });

  it("keeps document fields and generic wrapping deterministic", () => {
    expect(buildBonDocument(sampleJob, "Europe/Vienna")).toMatchObject({
      title: "BESTELLUNG",
      restaurantName: "Weingut Jäckel",
      orderReference: "1048",
      tableLabel: "TISCH 4",
      localTimeLabel: "18:42",
      localDateLabel: "23.08.26",
      totalAmount: "51.90",
      reprint: false,
    });
    expect(wrapText("eins zwei drei vier", 8)).toEqual([
      "eins",
      "zwei",
      "drei",
      "vier",
    ]);
    expect(wrapText("abcdefghijkl", 5)).toEqual(["abcde", "fghij", "kl"]);
  });

  it("creates a static test print without customer order data", () => {
    const test = createStaticTestBon(options);
    expect(test.toString("latin1")).toContain("MEN");
    expect(test.toString("latin1")).toContain("DIESER DRUCKER");
    expect(test.toString("latin1")).not.toContain("1048");
    expect(test.toString("latin1")).not.toContain("Schnitzel");
  });
});
