import { describe, it } from "node:test";
import assert from "node:assert";
import {
  classifyWeatherException,
  WEATHER_ALERT_LEAD_TIME_THRESHOLD_HOURS,
  WEATHER_SAFE_ABORT_RESCHEDULE_DISCOUNT_PERCENT,
} from "../../src/lib/weather-exception";

describe("classifyWeatherException", () => {
  it("reagenda sin penalización con exactamente 2h de anticipación", () => {
    const r = classifyWeatherException(2);
    assert.equal(r.resolution, "reschedule_no_penalty");
    assert.equal(r.rescheduleDiscountPercent, null);
  });

  it("reagenda sin penalización con más de 2h de anticipación", () => {
    const r = classifyWeatherException(5);
    assert.equal(r.resolution, "reschedule_no_penalty");
  });

  it("aborto seguro con menos de 2h de anticipación", () => {
    const r = classifyWeatherException(1.5);
    assert.equal(r.resolution, "safe_abort_day_rate_discount");
    assert.equal(r.rescheduleDiscountPercent, WEATHER_SAFE_ABORT_RESCHEDULE_DISCOUNT_PERCENT);
  });

  it("aborto seguro cuando no hubo alerta previa (null)", () => {
    const r = classifyWeatherException(null);
    assert.equal(r.resolution, "safe_abort_day_rate_discount");
    assert.equal(r.rescheduleDiscountPercent, 20);
  });

  it("aborto seguro con 0h de anticipación", () => {
    const r = classifyWeatherException(0);
    assert.equal(r.resolution, "safe_abort_day_rate_discount");
  });

  it("el umbral exportado es 2", () => {
    assert.equal(WEATHER_ALERT_LEAD_TIME_THRESHOLD_HOURS, 2);
  });
});
