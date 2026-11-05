import { describe, expect, it } from "vitest";
import { LABEL_UNKNOWN_RESULT, labelError, labelPrintError } from "../../src/modules/labels/messages";

describe("labelPrintError", () => {
  it.each(["label_format_locked", "not_found", "invalid_input", "simulated_shipment", "no_awb", "masking_disabled", "sender_fields_required", "whatsapp_missing"])("recognizes definite label refusal %s", (message) => {
    expect(labelPrintError({ message })).toBe(labelError({ message }));
    expect(labelPrintError({ message })).not.toBe(LABEL_UNKNOWN_RESULT);
  });

  it.each([null, undefined, {}, { message: "FetchError: response lost" }, { message: "new_unknown_code" }, { code: "PGRST000" }])("requires reconciliation for unrecognized outcomes %#", (error) => {
    expect(labelPrintError(error)).toBe(LABEL_UNKNOWN_RESULT);
  });
});
