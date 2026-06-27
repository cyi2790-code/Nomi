import { describe, it, expect } from "vitest";
import { normalizeAspectRatioToWH, parseAspectRatioValue, readNodeAspectRatio } from "./aspectRatio";
import type { GenerationCanvasNode } from "../model/generationCanvasTypes";

describe("parseAspectRatioValue", () => {
  it("解析标准 W:H 比例", () => {
    expect(parseAspectRatioValue("16:9")).toBeCloseTo(16 / 9);
    expect(parseAspectRatioValue("9:16")).toBeCloseTo(9 / 16);
    expect(parseAspectRatioValue("1:1")).toBe(1);
    expect(parseAspectRatioValue("21:9")).toBeCloseTo(21 / 9);
    expect(parseAspectRatioValue("4:3")).toBeCloseTo(4 / 3);
  });

  it("支持中文冒号与首尾空格", () => {
    expect(parseAspectRatioValue(" 16：9 ")).toBeCloseTo(16 / 9);
  });

  it("非比例值返回 null", () => {
    for (const v of ["adaptive", "auto", "2K", "4K", "basic", "high", "", "16:", ":9", "0:1", "16:0"]) {
      expect(parseAspectRatioValue(v)).toBeNull();
    }
  });

  it("非字符串返回 null", () => {
    expect(parseAspectRatioValue(undefined)).toBeNull();
    expect(parseAspectRatioValue(16 / 9)).toBeNull();
    expect(parseAspectRatioValue(null)).toBeNull();
  });
});

// 回归（2026-06-27 用户报「尺寸显示成 440」）：像素尺寸串绝不能被当成比例。
// AgentPlanCard 的「比例」chip 用这个判定——返回 null 就不显示比例 chip，不会把 448x1024 误标成「比例」。
describe("normalizeAspectRatioToWH — 像素串绝不当比例（440 误显回归）", () => {
  it("真比例（含 named bucket）→ 规范化 W:H", () => {
    expect(normalizeAspectRatioToWH("16:9")).toBe("16:9");
    expect(normalizeAspectRatioToWH(" 9：16 ")).toBe("9：16");
    expect(normalizeAspectRatioToWH("landscape_16_9")).toBe("16:9");
  });

  it("像素尺寸串 / 非比例值 → null（不显示为比例）", () => {
    for (const v of ["448x1024", "720x1280", "1024*1024", "2048x2048", "2K", "auto", "", 448]) {
      expect(normalizeAspectRatioToWH(v as unknown)).toBeNull();
    }
  });
});

function nodeWithMeta(meta: Record<string, unknown>): GenerationCanvasNode {
  return { id: "n1", kind: "image", meta } as unknown as GenerationCanvasNode;
}

describe("readNodeAspectRatio", () => {
  it("从 aspect_ratio 读", () => {
    expect(readNodeAspectRatio(nodeWithMeta({ aspect_ratio: "9:16" }))).toBeCloseTo(9 / 16);
  });

  it("回退到 size key（imagen4/qwen）", () => {
    expect(readNodeAspectRatio(nodeWithMeta({ size: "4:3" }))).toBeCloseTo(4 / 3);
  });

  it("跳过非比例的 size 值，继续找其他 key", () => {
    expect(readNodeAspectRatio(nodeWithMeta({ size: "2K", ratio: "1:1" }))).toBe(1);
  });

  it("无比例参数返回 null", () => {
    expect(readNodeAspectRatio(nodeWithMeta({ resolution: "1080p" }))).toBeNull();
    expect(readNodeAspectRatio(nodeWithMeta({}))).toBeNull();
  });
});
