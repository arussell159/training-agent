import test from "node:test";
import assert from "node:assert/strict";
import { appRouteItem } from "../src/lib/app-route.ts";

test("startup and workspace route resolution normalize trailing slashes and legacy aliases", () => {
  for (const [route, screen] of Object.entries({
    "/": "Home",
    "/nutrition": "Nutrition",
    "/calendar": "Calendar",
    "/week": "Calendar",
    "/coach": "Coach",
    "/atp": "Annual Plan",
    "/annual-plan": "Annual Plan",
    "/settings": "Settings",
    "/library": "Library",
    "/workout-reports": "Workout Reports",
  })) {
    assert.equal(appRouteItem(route), screen);
    assert.equal(appRouteItem(`${route}///`), screen);
  }
});

test("unknown and object-prototype route names safely fall back to Home", () => {
  for (const route of ["/unknown", "constructor", "toString", "__proto__"])
    assert.equal(appRouteItem(route), "Home");
});
