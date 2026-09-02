import {
  renderKitchenBon,
  renderKitchenBonLines,
} from "../../src/integrations/kitchen-bon";

const baseJob = {
  schemaVersion: 1,
  jobType: "kitchen_order",
  jobId: "job-scenario",
  restaurantId: "restaurant-scenario",
  restaurantName: "MenüQR Testküche",
  orderId: "order-scenario",
  orderReference: "4711",
  tableNumber: 12,
  createdAt: "2026-10-25T01:30:00.000Z",
  currency: "EUR",
  notes: null,
  items: [
    {
      itemId: "item-1",
      name: "Käsespätzle",
      variation: null,
      notes: null,
      quantity: 1,
      unitPrice: "12.50",
      lineTotal: "12.50",
    },
  ],
  totalAmount: "12.50",
  reprint: false,
} as const;

const optionMatrix = [
  { commandMode: "star_line", paperWidthMm: 80, encoding: "cp437" },
  { commandMode: "star_line", paperWidthMm: 82, encoding: "cp850" },
  { commandMode: "esc_pos", paperWidthMm: 80, encoding: "windows1252" },
  { commandMode: "esc_pos", paperWidthMm: 82, encoding: "windows1252" },
] as const;
const layoutProfiles = ["compact", "kitchen", "detailed"] as const;

function options(overrides: Record<string, unknown> = {}) {
  return {
    commandMode: "star_line" as const,
    paperWidthMm: 80 as const,
    encoding: "windows1252" as const,
    cutAfterPrint: true,
    timeZone: "Europe/Vienna",
    ...overrides,
  };
}

function lines(
  job: unknown = baseJob,
  overrides: Record<string, unknown> = {},
) {
  return renderKitchenBonLines(job, options(overrides));
}

describe("real kitchen-order scenario matrix", () => {
  it.each(optionMatrix)(
    "keeps every visible line inside $paperWidthMm mm for $commandMode/$encoding",
    (configuration) => {
      const output = lines(
        {
          ...baseJob,
          restaurantName:
            "Gasthaus Zur außergewöhnlich langen Schwarzwälder Küche",
          notes:
            "Allergie: Nüsse, Zwiebeln und Knoblauch. Alles getrennt servieren.",
          items: [
            {
              ...baseJob.items[0],
              name: "Hausgemachte Schwarzwälder Käsespätzle mit Röstzwiebeln",
              variation: "Sehr große Familienportion",
              notes: "Ohne Zwiebeln, extra heiß und getrennt anrichten",
              quantity: 50,
              unitPrice: "1234.56",
              lineTotal: "61728.00",
            },
          ],
          totalAmount: "61728.00",
        },
        configuration,
      );
      const width = configuration.paperWidthMm === 82 ? 50 : 48;

      expect(output.length).toBeGreaterThan(20);
      expect(output.every((line) => line.length <= width)).toBe(true);
      expect(output.join("\n")).toContain("50 x Hausgemachte");
      expect(output.join("\n")).toContain("ALLERGIE:");
    },
  );

  it("prints the largest public order shape accepted by the backend", () => {
    const items = Array.from({ length: 50 }, (_, index) => ({
      itemId: `item-${index + 1}`,
      name: `Gericht ${index + 1} mit einer langen aber realistischen Bezeichnung`,
      variation: "Große Portion",
      notes: `${"Ohne Zwiebeln, getrennt servieren. ".repeat(18)}${index + 1}`,
      quantity: 50,
      unitPrice: "999.99",
      lineTotal: "49999.50",
    }));
    const job = {
      ...baseJob,
      notes: "Gemeinsam servieren. ".repeat(60),
      items,
      totalAmount: "2499975.00",
    };

    for (const configuration of optionMatrix) {
      const result = renderKitchenBon(job, options(configuration));
      expect(result.byteLength).toBeLessThanOrEqual(64 * 1024);
      expect(result.byteLength).toBeGreaterThan(30_000);
    }
  });

  it.each([
    ["zero-priced item", "0", "0", "0,00 €"],
    ["one decimal place", "7.5", "7.5", "7,50 €"],
    ["large grouped price", "1234567.89", "1234567.89", "1.234.567,89 €"],
    ["non-EUR currency", "18.00", "18.00", "18,00 CHF"],
  ])(
    "renders %s without inventing a value",
    (_name, unitPrice, total, expected) => {
      const currency = _name === "non-EUR currency" ? "CHF" : "EUR";
      const output = lines({
        ...baseJob,
        currency,
        items: [{ ...baseJob.items[0], unitPrice, lineTotal: total }],
        totalAmount: total,
      });
      expect(output.join("\n")).toContain(expected);
    },
  );

  it("preserves item order exactly as snapshotted by the backend", () => {
    const output = lines({
      ...baseJob,
      items: [
        { ...baseJob.items[0], itemId: "starter", name: "Vorspeise" },
        { ...baseJob.items[0], itemId: "main", name: "Hauptgericht" },
        { ...baseJob.items[0], itemId: "drink", name: "Getränk" },
      ],
      totalAmount: "37.50",
    }).join("\n");
    expect(output.indexOf("Vorspeise")).toBeLessThan(
      output.indexOf("Hauptgericht"),
    );
    expect(output.indexOf("Hauptgericht")).toBeLessThan(
      output.indexOf("Getränk"),
    );
  });

  it.each([
    ["empty optional text", "   \n\t  ", null],
    ["control sequences", "Ohne\u0000 Zwiebeln\u001b[2J", "OHNE ZWIEBELN"],
    ["emoji", "Sehr heiß 🔥 und vegan 🌱", "SEHR HEISS ? UND VEGAN ?"],
    ["Cyrillic", "без лука", "??? ????"],
    ["unbroken token", "A".repeat(600), "A".repeat(44)],
  ])("handles %s safely", (_name, note, expected) => {
    const output = lines({
      ...baseJob,
      notes: note,
      items: [{ ...baseJob.items[0], notes: note }],
    });
    const text = output.join("\n");
    expect(text).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/);
    if (expected === null) expect(text).not.toContain("ANMERKUNG:");
    else expect(text).toContain(expected);
    expect(output.every((line) => line.length <= 48)).toBe(true);
  });

  it("uses Vienna local time deterministically across the DST fallback", () => {
    const beforeFallback = lines({
      ...baseJob,
      createdAt: "2026-10-25T00:30:00.000Z",
    });
    const afterFallback = lines({
      ...baseJob,
      createdAt: "2026-10-25T01:30:00.000Z",
    });
    expect(beforeFallback).toContain("TISCH 12                                   02:30");
    expect(afterFallback).toContain("TISCH 12                                   02:30");
    expect(beforeFallback).toContain("Bestellung #4711                        25.10.26");
  });

  it("uses the restaurant time zone from the job when no local override exists", () => {
    const output = lines(
      {
        ...baseJob,
        createdAt: "2026-08-28T12:30:00.000Z",
        timeZone: "Europe/Kyiv",
      },
      { timeZone: undefined },
    );
    expect(output).toContain("TISCH 12                                   15:30");
  });

  it("keeps normal and reprint output distinct only through the required marker", () => {
    const normal = lines(baseJob);
    const reprint = lines({ ...baseJob, reprint: true });
    expect(reprint.slice(2)).toEqual(normal);
    expect(reprint.slice(0, 2)).toEqual(["******* NACHDRUCK *******", ""]);
  });

  it.each(optionMatrix)(
    "is byte-deterministic and cuts only at the end for $commandMode/$encoding",
    (configuration) => {
      const first = renderKitchenBon(baseJob, options(configuration));
      const second = renderKitchenBon(baseJob, options(configuration));
      expect(first).toEqual(second);
      const cut =
        configuration.commandMode === "esc_pos"
          ? Buffer.from([0x1d, 0x56, 0x00])
          : Buffer.from([0x1b, 0x64, 0x03]);
      expect(first.subarray(-cut.length)).toEqual(cut);
      expect(first.indexOf(cut)).toBe(first.length - cut.length);
    },
  );

  it("renders 120 deterministic real-world order combinations across every printer mode", () => {
    const dishNames = [
      "Schnitzel Wiener Art",
      "Käsespätzle mit Röstzwiebeln",
      "Truffle Burrata Pasta",
      "Großer gemischter Beilagensalat",
      "Traubensaftschorle 0,5 l",
      "Crème brûlée",
      "Überraschungsmenü für zwei Personen",
      "Donaudampfschifffahrtsgesellschaftskapitänsteller",
    ];
    const itemNotes = [
      null,
      "Ohne Zwiebeln",
      "Allergie: Nüsse",
      "Extra heiß und getrennt servieren",
      "Kein Salz, keine Butter, Sauce separat",
      "Gast sagt: bitte wirklich sehr scharf 🔥",
    ];
    let renderedBons = 0;

    for (let orderIndex = 1; orderIndex <= 120; orderIndex += 1) {
      const itemCount = 1 + ((orderIndex * 17) % 50);
      let totalCents = 0;
      const items = Array.from({ length: itemCount }, (_, itemIndex) => {
        const quantity = 1 + ((orderIndex + itemIndex * 3) % 50);
        const unitCents =
          50 + ((orderIndex * 7919 + itemIndex * 1049) % 999_950);
        const lineCents = unitCents * quantity;
        totalCents += lineCents;
        return {
          itemId: `item-${orderIndex}-${itemIndex}`,
          name: dishNames[(orderIndex + itemIndex) % dishNames.length],
          variation:
            itemIndex % 4 === 0
              ? ["Klein", "Groß", "Glutenfrei"][itemIndex % 3]
              : null,
          notes: itemNotes[(orderIndex * 2 + itemIndex) % itemNotes.length],
          quantity,
          unitPrice: cents(unitCents),
          lineTotal: cents(lineCents),
        };
      });
      const scenario = {
        ...baseJob,
        jobId: `job-${orderIndex}`,
        orderId: `order-${orderIndex}`,
        orderReference: String(10_000 + orderIndex),
        ...(orderIndex % 11 === 0
          ? {
              orderKind: "additional" as const,
              serviceSequence: 2 + (orderIndex % 4),
              rootOrderReference: String(9_000 + orderIndex),
              previousOrderReference: String(9_999 + orderIndex),
            }
          : {
              orderKind: "initial" as const,
              serviceSequence: 1,
              rootOrderReference: String(10_000 + orderIndex),
              previousOrderReference: null,
            }),
        tableNumber: 1 + ((orderIndex * 37) % 500),
        createdAt: new Date(
          Date.UTC(
            2026,
            orderIndex % 12,
            1 + (orderIndex % 27),
            orderIndex % 24,
            37,
          ),
        ).toISOString(),
        notes:
          orderIndex % 3 === 0
            ? itemNotes[orderIndex % itemNotes.length]
            : null,
        items,
        totalAmount: cents(totalCents),
        reprint: orderIndex % 13 === 0,
      };

      for (const configuration of optionMatrix) {
        for (const layoutProfile of layoutProfiles) {
          const profileOptions = { ...configuration, layoutProfile };
          const renderOptions = options(profileOptions);
          const visible = lines(scenario, profileOptions);
          const width = configuration.paperWidthMm === 82 ? 50 : 48;
          const first = renderKitchenBon(scenario, renderOptions);
          const second = renderKitchenBon(scenario, renderOptions);
          const visibleText = visible.join("\n");

          expect(first).toEqual(second);
          expect(first.byteLength).toBeLessThanOrEqual(64 * 1024);
          expect(visible.every((line) => line.length <= width)).toBe(true);
          expect(visibleText).toContain(`TISCH ${scenario.tableNumber}`);
          expect(visibleText).toContain(
            `Bestellung #${scenario.orderReference}`,
          );
          if (scenario.reprint) expect(visibleText).toContain("NACHDRUCK");
          if (scenario.orderKind === "additional") {
            expect(visibleText).toContain(
              `NACHBESTELLUNG ${scenario.serviceSequence}`,
            );
            expect(visibleText).toContain(
              `Zu Bestellung #${scenario.previousOrderReference}`,
            );
          } else {
            expect(visibleText).not.toContain("NACHBESTELLUNG");
          }
          if (layoutProfile === "detailed") {
            expect(visibleText).toContain("GESAMT:");
          } else {
            expect(visibleText).not.toContain("GESAMT:");
          }
          renderedBons += 1;
        }
      }
    }

    expect(renderedBons).toBe(1_440);
  });

  it.each([
    ["no items", { items: [] }],
    ["zero quantity", { items: [{ ...baseJob.items[0], quantity: 0 }] }],
    [
      "fractional quantity",
      { items: [{ ...baseJob.items[0], quantity: 1.5 }] },
    ],
    ["invalid timestamp", { createdAt: "not-a-date" }],
    ["empty restaurant", { restaurantName: " " }],
    ["invalid decimal", { totalAmount: "12.999" }],
    ["negative total", { totalAmount: "-1.00" }],
    [
      "wrong line total",
      { items: [{ ...baseJob.items[0], lineTotal: "99.00" }] },
    ],
    ["wrong order total", { totalAmount: "11.00" }],
    ["duplicate item IDs", { items: [baseJob.items[0], baseJob.items[0]] }],
  ])("rejects corrupt payload: %s", (_name, override) => {
    expect(() => lines({ ...baseJob, ...override })).toThrow();
  });
});

function cents(value: number): string {
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}
