import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.skip(
  process.env.RUN_ELECTRON_E2E !== "1",
  "Set RUN_ELECTRON_E2E=1 on an Electron-capable desktop host.",
);

test("gives a first-time user a minimal restaurant-first setup", async () => {
  const userData = await mkdtemp(join(tmpdir(), "menuqr-bridge-e2e-"));
  const application = await electron.launch({
    args: [join(__dirname, "../../dist/main/index.js")],
    env: {
      ...process.env,
      BRIDGE_E2E: "1",
      BRIDGE_E2E_DATA_DIR: userData,
    },
  });

  try {
    const window = await application.firstWindow();
    await expect(window.locator(".brand-logo")).toHaveAttribute(
      "src",
      "./brand-logo.svg",
    );
    await expect(window.locator("html")).toHaveAttribute("lang", "de");
    await expect(window.getByTestId("foundation-status")).toContainText(
      "Einrichtung offen",
    );
    await expect(window.locator(".window-title")).toContainText(
      "MenüQR Bridge",
    );
    await expect(window.getByTestId("onboarding-title")).toContainText(
      "Willkommen bei MenüQR Bridge",
    );
    await expect(window.getByTestId("first-run-action")).toBeVisible();
    await expect(window.getByTestId("hero-pairing-start")).toBeEnabled();
    await expect(window.getByTestId("pairing-hero-card")).toBeHidden();
    await expect(window.getByTestId("restaurant-profile")).toBeHidden();
    await expect(window.getByTestId("pairing-card")).toBeHidden();
    await expect(window.getByTestId("printer-setup-card")).toBeHidden();
    await expect(window.getByTestId("printer-library")).toBeHidden();

    await window.evaluate(() => {
      document.body.dataset.setupMode = "connected";
      document.body.dataset.activeTab = "printers";
    });
    await expect(window.getByTestId("printer-library")).toBeVisible();
    await expect(window.getByTestId("printer-empty-state")).toBeVisible();
    await expect(window.getByTestId("saved-printer-card")).toBeHidden();
    await window.getByTestId("printer-add").click();
    await expect(window.getByTestId("printer-setup-card")).toBeVisible();
    await expect(
      window.getByRole("heading", { name: "Küchendrucker hinzufügen" }),
    ).toBeVisible();
    await expect(
      window.getByRole("heading", { name: "Küchendrucker", exact: true }),
    ).toBeVisible();
    await expect(
      window.getByText("Weitere Geräte", { exact: true }),
    ).toHaveCount(0);
    await expect(window.getByTestId("printer-discover")).toBeVisible();
    await expect(window.getByTestId("setup-bon-layout")).toBeVisible();
    await expect(
      window.locator("input[name='setupBonLayoutProfile'][value='compact']"),
    ).toBeChecked();
    await expect(
      window.getByTestId("setup-bon-layout").getByText("Küche Plus"),
    ).toBeVisible();
    await expect(
      window.getByTestId("setup-bon-layout").getByText("Vollständig"),
    ).toBeVisible();
    await expect(window.getByTestId("printer-request-toggle")).toBeVisible();
    await window.getByTestId("printer-request-toggle").click();
    await expect(window.getByTestId("printer-request-dialog")).toBeVisible();
    await expect(window.getByTestId("printer-request-form")).toBeVisible();
    await expect(window.getByTestId("printer-request-model")).toBeFocused();
    await window.keyboard.press("Escape");
    await expect(window.getByTestId("printer-request-dialog")).toBeHidden();
    await expect(
      window.locator(".printer-setup-card .card-number"),
    ).toHaveCount(0);
    const workspaceWidths = await window.evaluate(() => {
      const workspace = document.querySelector(".printer-workspace");
      const card = document.querySelector("[data-testid='printer-setup-card']");
      return {
        card: card?.getBoundingClientRect().width ?? 0,
        workspace: workspace?.getBoundingClientRect().width ?? 0,
      };
    });
    expect(workspaceWidths.card).toBeGreaterThanOrEqual(
      workspaceWidths.workspace - 1,
    );

    await window.getByTestId("manual-printer-settings").click();
    await window
      .getByTestId("printer-configuration")
      .locator("input[name='host']")
      .fill("192.168.1.42");
    await window.getByTestId("printer-save").click();
    await expect(window.getByTestId("printer-setup-card")).toBeHidden();
    await window.evaluate(() => {
      document.body.dataset.setupMode = "connected";
      document.body.dataset.activeTab = "printers";
    });
    await expect(window.getByTestId("printer-library")).toBeVisible();
    await expect(window.getByTestId("printer-empty-state")).toBeHidden();
    await expect(window.getByTestId("saved-printer-card")).toHaveCount(1);
    await expect(window.getByTestId("saved-printer-address")).toContainText(
      "192.168.1.42:9100",
    );
    await expect(window.getByTestId("saved-printer-address")).toContainText(
      "Kompakt",
    );
    await expect(window.getByTestId("printer-add-another")).toBeVisible();

    await window.getByTestId("printer-edit").click();
    await expect(window.getByTestId("printer-details-card")).toBeVisible();
    await expect(window.getByTestId("printer-setup-card")).toBeHidden();
    await expect(window.getByTestId("printer-discover")).toBeHidden();
    await expect(
      window.getByTestId("printer-details-form").locator("input[name='host']"),
    ).toHaveValue("192.168.1.42");
    await expect(
      window.locator("input[name='bonLayoutProfile'][value='compact']"),
    ).toBeChecked();
    await window
      .getByTestId("details-bon-layout")
      .locator("label", { hasText: "Vollständig" })
      .click();
    await window
      .getByTestId("printer-details-form")
      .locator("input[name='port']")
      .fill("9101");
    await window.getByTestId("printer-details-save").click();
    await expect(window.getByTestId("printer-details-status")).toContainText(
      "Änderungen gespeichert",
    );
    await window.getByTestId("printer-details-back").click();
    await expect(window.getByTestId("saved-printer-address")).toContainText(
      "192.168.1.42:9101",
    );
    await expect(window.getByTestId("saved-printer-address")).toContainText(
      "Vollständig",
    );

    await window.evaluate(() => {
      document.body.dataset.setupMode = "connected";
      document.body.dataset.activeTab = "printers";
    });
    await window.getByTestId("printer-add-another").click();
    await window.getByTestId("manual-printer-settings").click();
    await window
      .getByTestId("printer-configuration")
      .locator("input[name='host']")
      .fill("192.168.1.43");
    await window.getByTestId("printer-save").click();
    await window.evaluate(() => {
      document.body.dataset.setupMode = "connected";
      document.body.dataset.activeTab = "printers";
    });
    await expect(window.getByTestId("saved-printer-card")).toHaveCount(2);
    await expect(
      window.getByTestId("saved-printer-address").nth(1),
    ).toContainText("192.168.1.43:9100");
    await expect(
      window.getByTestId("saved-printer-address").nth(1),
    ).toContainText("Aktiv");

    await window.evaluate(() => {
      document.body.dataset.setupMode = "connected";
      document.body.dataset.activeTab = "printers";
      document
        .querySelector<HTMLButtonElement>("[data-testid='printer-delete']")
        ?.click();
    });
    await expect(window.getByTestId("printer-delete-dialog")).toBeVisible();
    await window.getByTestId("printer-delete-confirm").click();
    await expect(window.getByTestId("saved-printer-card")).toHaveCount(1);
    await expect(window.getByTestId("saved-printer-address")).toContainText(
      "192.168.1.43:9100",
    );
    await expect(
      window.getByText("Weitere Einstellungen", { exact: true }),
    ).toHaveCount(0);
    await window.evaluate(() => {
      document.body.dataset.setupMode = "connected";
      document.body.dataset.activeTab = "settings";
    });
    await expect(
      window.getByRole("heading", { name: "App-Einstellungen" }),
    ).toBeVisible();

    await window.reload();
    await window.evaluate(() => {
      document.body.dataset.setupMode = "connected";
      document.body.dataset.activeTab = "printers";
    });
    await expect(window.getByTestId("saved-printer-card")).toHaveCount(1);
    await expect(window.getByTestId("saved-printer-address")).toContainText(
      "192.168.1.43:9100",
    );
  } finally {
    await application.close();
    await rm(userData, { recursive: true, force: true });
  }
});
