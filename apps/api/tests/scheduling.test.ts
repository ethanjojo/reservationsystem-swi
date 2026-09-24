import { describe, expect, it } from "vitest";
import { fitsWorkingWindow } from "../src/reservations/scheduling.js";

const monday = [{ weekday: 1, startMinute: 480, endMinute: 960 }];
describe("Europe/Prague working windows", () => {
  it.each([
    ["2030-02-04T07:00:00Z", 30, true], // 08:00 local
    ["2030-02-04T14:30:00Z", 30, true], // end exactly at 16:00
    ["2030-02-04T14:45:00Z", 30, false],
    ["2030-02-04T06:45:00Z", 30, false],
    ["2030-02-05T07:00:00Z", 30, false], // wrong weekday
    ["2030-02-04T07:01:00Z", 30, false], // off 15 minute grid
    ["2030-02-04T07:00:00.001Z", 30, false],
    ["2030-07-01T06:00:00Z", 30, true], // summer offset +02:00
  ])("%s, %i minutes → %s", (date, duration, expected) => {
    expect(fitsWorkingWindow(new Date(date), duration, monday)).toBe(expected);
  });
  it("does not join windows across a lunch break", () => {
    expect(fitsWorkingWindow(new Date("2030-02-04T10:45:00Z"), 30, [
      { weekday: 1, startMinute: 480, endMinute: 720 },
      { weekday: 1, startMinute: 735, endMinute: 960 },
    ])).toBe(false);
  });
  it("anchors the grid to the window start", () => {
    expect(fitsWorkingWindow(new Date("2030-02-04T07:05:00Z"), 30,
      [{ weekday: 1, startMinute: 485, endMinute: 960 }])).toBe(true);
  });
  it("allows an interval ending exactly at local midnight", () => {
    expect(fitsWorkingWindow(new Date("2030-02-04T22:30:00Z"), 30,
      [{ weekday: 1, startMinute: 1380, endMinute: 1440 }])).toBe(true);
  });
  it("cannot borrow the next day's window", () => {
    expect(fitsWorkingWindow(new Date("2030-02-04T22:45:00Z"), 30,
      [{ weekday: 1, startMinute: 1380, endMinute: 1440 }])).toBe(false);
  });
  it("uses elapsed duration across the spring DST jump", () => {
    expect(fitsWorkingWindow(new Date("2030-03-31T01:45:00+01:00"), 30,
      [{ weekday: 7, startMinute: 60, endMinute: 240 }])).toBe(true);
  });
  it("distinguishes both occurrences of the fall repeated hour", () => {
    for (const offset of ["+02:00", "+01:00"]) {
      expect(fitsWorkingWindow(new Date(`2030-10-27T02:15:00${offset}`), 15,
        [{ weekday: 7, startMinute: 120, endMinute: 180 }])).toBe(true);
    }
  });
  it("rejects a fall interval whose middle leaves the working window", () => {
    expect(fitsWorkingWindow(new Date("2030-10-27T02:45:00+02:00"), 90,
      [{ weekday: 7, startMinute: 150, endMinute: 240 }])).toBe(false);
  });
  it.each([0, -1, 0.5, 1441, Number.NaN])("rejects invalid duration %s", duration => {
    expect(fitsWorkingWindow(new Date("2030-02-04T07:00:00Z"), duration, monday)).toBe(false);
  });
});
