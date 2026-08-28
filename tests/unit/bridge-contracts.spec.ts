import {
  BridgeContractValidationError,
  KITCHEN_PRINT_SCHEMA_VERSION,
  parseBridgeJobEnvelope,
  parseKitchenPrintJob
} from "../../src/contracts";

const validKitchenJob = {
  schemaVersion: KITCHEN_PRINT_SCHEMA_VERSION,
  jobType: "kitchen_order",
  jobId: "job_1",
  restaurantId: "restaurant_1",
  restaurantName: "Weingut Jäckel",
  orderId: "order_1",
  orderReference: "A-100",
  tableNumber: 7,
  createdAt: "2026-08-22T12:00:00.000Z",
  currency: "EUR",
  notes: "Ohne Zwiebeln",
  items: [
    {
      itemId: "item_1",
      name: "Flammkuchen",
      variation: null,
      quantity: 2,
      unitPrice: "12.50",
      lineTotal: "25.00"
    }
  ],
  totalAmount: "25.00"
};

describe("bridge contract validation", () => {
  it("accepts the immutable kitchen print payload v1", () => {
    expect(parseKitchenPrintJob(validKitchenJob)).toEqual(validKitchenJob);
  });

  it("rejects unsupported kitchen schema versions", () => {
    expect(() =>
      parseKitchenPrintJob({ ...validKitchenJob, schemaVersion: 2 })
    ).toThrow(BridgeContractValidationError);
  });

  it("does not silently parse unknown envelope schema versions", () => {
    expect(
      parseBridgeJobEnvelope({
        schemaVersion: 2,
        jobId: "job_legacy"
      })
    ).toEqual({
      schemaVersion: 2,
      type: "unsupported",
      jobId: "job_legacy",
      reason: "unsupported_schema"
    });
  });

  it("rejects invalid quantities and decimal snapshots", () => {
    expect(() =>
      parseKitchenPrintJob({
        ...validKitchenJob,
        items: [{ ...validKitchenJob.items[0], quantity: 0 }]
      })
    ).toThrow("quantity");

    expect(() =>
      parseKitchenPrintJob({
        ...validKitchenJob,
        totalAmount: "25,00"
      })
    ).toThrow("decimal");
  });

  it("validates follow-up order linkage without requiring it from older jobs", () => {
    expect(
      parseKitchenPrintJob({
        ...validKitchenJob,
        orderKind: "additional",
        serviceSequence: 2,
        rootOrderReference: "1048",
        previousOrderReference: "1048",
      }),
    ).toMatchObject({
      orderKind: "additional",
      serviceSequence: 2,
      previousOrderReference: "1048",
    });
    expect(() =>
      parseKitchenPrintJob({
        ...validKitchenJob,
        orderKind: "additional",
        serviceSequence: 1,
      }),
    ).toThrow("Additional orders require");
    expect(parseKitchenPrintJob(validKitchenJob).orderKind).toBeUndefined();
  });

  it("accepts known kitchen adjustments and rejects unknown actions", () => {
    for (const orderAction of [
      "additional",
      "change",
      "cancellation",
      "full_cancellation",
    ] as const) {
      const adjustment = {
        ...validKitchenJob,
        orderAction,
        ...(orderAction === "change"
          ? {
              previousItem: {
                name: "Flammkuchen",
                variation: null,
                notes: null,
                quantity: 1,
              },
              quantityDelta: 1,
            }
          : { quantityDelta: orderAction === "additional" ? 2 : -2 }),
        ...(orderAction === "additional"
          ? {
              orderKind: "additional",
              serviceSequence: 2,
              rootOrderReference: "A-100",
              previousOrderReference: "A-100",
            }
          : {}),
      };
      expect(parseKitchenPrintJob(adjustment).orderAction).toBe(orderAction);
    }
    expect(() =>
      parseKitchenPrintJob({ ...validKitchenJob, orderAction: "refund" }),
    ).toThrow("orderAction");
  });

  it("validates lease metadata before a job can be passed to execution", () => {
    expect(
      parseBridgeJobEnvelope({
        schemaVersion: 1,
        type: "kitchen_order",
        job: validKitchenJob,
        lease: {
          token: "lease-secret-delivered-once",
          expiresAt: "2026-08-22T12:01:00.000Z"
        }
      })
    ).toMatchObject({
      type: "kitchen_order",
      lease: { expiresAt: "2026-08-22T12:01:00.000Z" }
    });
  });
});
