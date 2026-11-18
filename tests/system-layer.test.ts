import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LAYER_ICON, layerIcon } from "../apps/web/src/system-layer.ts";

describe("a system's icon by its layer", () => {
  it("is the one the system picker shows for each layer", () => {
    assert.deepEqual(LAYER_ICON, {
      APPLICATION: "window",
      DATABASE: "database",
      OPERATING_SYSTEM: "server",
      INFRASTRUCTURE: "cloud",
      TOOL: "wrench",
    });
    assert.equal(layerIcon("DATABASE"), "database");
  });

  it("falls back to an application's icon when the layer is unknown", () => {
    assert.equal(layerIcon(null), "window");
    assert.equal(layerIcon(undefined), "window");
    assert.equal(layerIcon("SOMETHING_NEW"), "window");
  });
});
