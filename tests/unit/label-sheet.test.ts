// T-095: exercise actual rendered parcel/slip markup, not only the content projection.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LabelSheet } from "../../src/components/label/label-sheet";
import { CustomerSlip } from "../../src/components/label/customer-slip";
import { buildLabelContent, customerSlipContent, LABEL_SIZES, PARCEL_HEIGHT_MM, CUSTOMER_SLIP_HEIGHT_MM, type LabelFacts } from "../../src/lib/label-content";
import { CODE128_PATTERNS, CODE128_STOP } from "../../src/lib/label-code128";

const facts: LabelFacts = {
  reference: "GX-PRIVATE", awb: "JP1234567890", courier: "JT", service: "REG", weightGrams: 1000,
  isCod: false, codAmountIdr: null, itemDescription: "Private item",
  recipient: { name: "Recipient Secret", phone: "081299998888", address: "Recipient street", area: "Recipient city", postalCode: "40132" },
  geraiName: "Gerai Frozen", geraiLogo: { version: 2, mime: "image/png", base64: "iVBORw0KGgo=" },
  geraiWhatsapp: "081355550000", pickupAddress: "Pickup secret", pickupArea: "Pickup city",
};
const sender = { name: "Sender Secret", phone: "081311112222", address: "Sender street", city: "Sender city" };

function decode(modules: string): string {
  const runs = [...modules.replace(/^0+|0+$/g, "").matchAll(/0+|1+/g)].map((m) => m[0].length);
  expect((runs.length - 7) % 6, "symbol boundaries").toBe(0);
  const count = (runs.length - 7) / 6;
  const values: number[] = [];
  for (let j = 0; j < count; j++) {
    const pattern = runs.slice(6 * j, 6 * j + 6).join("");
    const value = CODE128_PATTERNS.slice(0, 106).indexOf(pattern);
    expect(value, `symbol ${j} (${pattern}) is a Code128 symbol`).toBeGreaterThanOrEqual(0);
    values.push(value);
  }
  expect(runs.slice(6 * count).join(""), "stop symbol").toBe(CODE128_PATTERNS[CODE128_STOP]);
  const [start, ...rest] = values;
  const check = rest.pop()!;
  expect([103, 104, 105], "start symbol").toContain(start);
  const sum = start + rest.reduce((acc, v, i) => acc + v * (i + 1), 0);
  expect(sum % 103, "check symbol").toBe(check);
  let set: "A" | "B" | "C" = start === 103 ? "A" : start === 104 ? "B" : "C";
  let out = "";
  for (const v of rest) {
    if (v === 99 && set !== "C") set = "C";
    else if (v === 100 && set !== "B") set = "B";
    else if (v === 101 && set !== "A") set = "A";
    else if (set === "C") {
      if (v > 99) throw new Error(`unsupported symbol ${v} in set C`);
      out += String(v).padStart(2, "0");
    } else if (v >= 96) throw new Error(`unsupported function symbol ${v}`);
    else if (set === "A") out += String.fromCharCode(v < 64 ? v + 32 : v - 64);
    else out += String.fromCharCode(v + 32);
  }
  return out;
}


describe("CustomerSlip", () => {
  it.each([false, true])("prints identity + courier on one row, barcode then AWB, never party/contact data (mask=%s)", (mask) => {
    const content = buildLabelContent(facts, { size: "10x15", mask, sender });
    const slip = customerSlipContent(content);
    expect(Object.keys(slip).sort()).toEqual(["awb", "courierLine", "geraiLogo", "geraiName"]);
    const html = renderToStaticMarkup(createElement(CustomerSlip, { content: slip }));
    expect(html).toContain("Gerai Frozen");
    expect(html).toContain("data:image/png;base64,iVBORw0KGgo=");
    expect(html).toContain("J&amp;T Express REG");
    for (const secret of ["Recipient Secret", "081299998888", "Recipient street", "Recipient city", "40132", ...Object.values(sender), "081355550000", "Pickup secret", "GX-PRIVATE", "Private item"]) expect(html).not.toContain(secret);
    expect(html.indexOf('data-testid="slip-identity-row"')).toBeLessThan(html.indexOf('<svg'));
    expect(html.indexOf('</svg>')).toBeLessThan(html.indexOf('data-testid="slip-awb"'));
    const path = /<path d="([^"]+)"/.exec(html)![1];
    const width = Number(/viewBox="0 0 (\d+) 1"/.exec(html)![1]);
    const cells = Array<string>(width).fill("0");
    for (const m of path.matchAll(/M(\d+) 0h(\d+)v1h-\d+z/g)) for (let i = 0; i < Number(m[2]); i++) cells[Number(m[1]) + i] = "1";
    expect(decode(cells.join(""))).toBe(facts.awb);
  });
  it("keeps a legible frozen name when no logo is stored", () => {
    const slip = customerSlipContent(buildLabelContent({ ...facts, geraiLogo: null }, { size: "10x15", mask: true, sender }));
    const html = renderToStaticMarkup(createElement(CustomerSlip, { content: slip }));
    expect(html).toContain("Gerai Frozen");
    expect(html).not.toContain("<img");
  });
});

describe("LabelSheet formats", () => {
  it.each(["10x15", "10x10"] as const)("%s renders one 100x100 parcel and only 10x15 adds the 100x50 slip", (size) => {
    const content = buildLabelContent(facts, { size, mask: true, sender });
    const html = renderToStaticMarkup(createElement(LabelSheet, { content }));
    expect(PARCEL_HEIGHT_MM).toBe(100);
    expect(CUSTOMER_SLIP_HEIGHT_MM).toBe(50);
    expect(html).toContain(`@page { size: 100mm ${LABEL_SIZES[size].heightMm}mm; margin: 0; }`);
    expect(html).toMatch(/data-testid="label-sheet"[^>]*style="width:100mm;height:100mm/);
    expect((html.match(/data-testid="label-sheet"/g) ?? [])).toHaveLength(1);
    expect((html.match(/data-testid="customer-slip"/g) ?? [])).toHaveLength(size === "10x15" ? 1 : 0);
    if (size === "10x15") {
      expect(html).toMatch(/data-testid="customer-slip"[^>]*style="width:100mm;height:50mm/);
      expect(html).toContain("border-t-dashed");
    }
  });
});
