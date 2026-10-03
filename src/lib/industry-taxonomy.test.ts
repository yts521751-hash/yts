import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  industryMegaGroup,
  industrySectorId,
  normalizeIndustryName,
} from "./industry-taxonomy";
import { computeIndustryFlowRows } from "./industry-flow-compute";
import { ROTATION_THEME_UNIVERSE } from "./rotation-theme-universe";
import type { SectorDef } from "./sector-universe";

describe("industry-taxonomy", () => {
  it("normalizes ISIN / legacy aliases to market short names", () => {
    assert.equal(normalizeIndustryName("半導體業"), "半導體");
    assert.equal(normalizeIndustryName("電腦及週邊設備業"), "電腦週邊");
    assert.equal(normalizeIndustryName("通信網路業"), "通信網路");
    assert.equal(normalizeIndustryName("通訊網路業"), "通信網路");
    assert.equal(normalizeIndustryName("生技醫療業"), "生技醫療");
    assert.equal(normalizeIndustryName("觀光事業"), "觀光餐旅");
    assert.equal(normalizeIndustryName("其他業"), "其他");
  });

  it("maps mega-groups like Mitake / broker 類股 buckets", () => {
    assert.equal(industryMegaGroup("半導體業"), "電子");
    assert.equal(industryMegaGroup("數位雲端"), "電子");
    assert.equal(industryMegaGroup("金融保險業"), "金融");
    assert.equal(industryMegaGroup("鋼鐵工業"), "傳產");
    assert.equal(industryMegaGroup("航運"), "傳產");
    assert.equal(industryMegaGroup("其他"), "其他");
  });

  it("builds stable industry sector ids from short names", () => {
    assert.equal(industrySectorId("半導體業"), "ind-半導體");
    assert.equal(industrySectorId("半導體"), "ind-半導體");
  });
});

describe("industry-flow full rollup", () => {
  it("sums all industry members (not a Top-N sample)", () => {
    const quotes = new Map([
      [
        "2330",
        {
          code: "2330",
          name: "台積電",
          open: 100,
          high: 101,
          low: 99,
          close: 100,
          changePct: 2,
          turnover: 2e10, // 200 億
        },
      ],
      [
        "2303",
        {
          code: "2303",
          name: "聯電",
          open: 50,
          high: 51,
          low: 49,
          close: 50,
          changePct: -2,
          turnover: 5e9, // 50 億
        },
      ],
    ]);
    const day = {
      ymd: "20260930",
      quotes,
      insti: new Map([
        [
          "2330",
          {
            code: "2330",
            name: "台積電",
            foreign: 0,
            trust: 0,
            dealer: 0,
            total: 0,
          },
        ],
        [
          "2303",
          {
            code: "2303",
            name: "聯電",
            foreign: 0,
            trust: 0,
            dealer: 0,
            total: 0,
          },
        ],
      ]),
      indexChangePct: 0.5,
    };
    // 湊滿 5 日（聚合會 slice d3/d5/d20）
    const dayData = [day, day, day, day, day];
    const universe: SectorDef[] = [
      {
        id: "ind-半導體",
        name: "半導體",
        basis: "test",
        kind: "industry",
        members: [
          { code: "2330", name: "台積電" },
          { code: "2303", name: "聯電" },
          { code: "9999", name: "無報價" },
        ],
      },
    ];
    const rows = computeIndustryFlowRows(dayData, universe);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].memberCount, 3);
    assert.equal(rows[0].fullRollup, true);
    assert.equal(rows[0].megaGroup, "電子");
    // 200 + 50 億成交
    assert.equal(rows[0].dayAmt, 250);
    // 兩檔都有貢獻（非只取 Top-1）
    assert.ok(rows[0].stocks.length >= 2);
  });

  it("ranks by turnover-share deviation against each day's 20-day baseline", () => {
    const makeDay = (ymd: string, hot: boolean) => ({
      ymd,
      quotes: new Map([
        [
          "2330",
          {
            code: "2330",
            name: "台積電",
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            changePct: 0,
            turnover: hot ? 6e10 : 2e10,
          },
        ],
        [
          "2303",
          {
            code: "2303",
            name: "聯電",
            open: 50,
            high: 51,
            low: 49,
            close: 50,
            changePct: 0,
            turnover: hot ? 4e10 : 8e10,
          },
        ],
      ]),
      insti: new Map(),
      indexChangePct: 0,
    });
    const rows = computeIndustryFlowRows(
      Array.from({ length: 24 }, (_, i) =>
        makeDay(`202609${String(30 - i).padStart(2, "0")}`, i === 0),
      ),
      [
        {
          id: "theme-test",
          name: "測試群",
          basis: "test",
          kind: "theme",
          members: [{ code: "2330", name: "台積電" }],
        },
      ],
    );

    assert.equal(rows[0].turnoverSharePct, 60);
    assert.equal(rows[0].avg20TurnoverSharePct, 22);
    assert.equal(rows[0].dayShareDeltaPp, 38);
    // 3／5 日皆為「每日 pp 偏離」的平均，而不是跨標籤群不可加總的 pp 總和。
    assert.equal(rows[0].d3ShareDeltaPp, 12.67);
    assert.equal(rows[0].d5ShareDeltaPp, 7.6);
  });
});

describe("rotation AI supply-chain universe", () => {
  it("keeps the explicit ASIC／矽智財 group available to industry-flow", () => {
    const asic = ROTATION_THEME_UNIVERSE.find((x) => x.id === "asic-ip");
    const icDesign = ROTATION_THEME_UNIVERSE.find((x) => x.id === "ic-design");
    assert.ok(asic);
    assert.ok(icDesign);
    assert.equal(asic.name, "ASIC／矽智財");
    assert.equal(icDesign.name, "IC 設計");
    assert.ok(asic.members.length >= 5);
    assert.ok(asic.members.some((x) => x.code === "3661"));
    assert.ok(icDesign.members.some((x) => x.code === "2454"));
    assert.ok(asic.members.some((x) => x.code === "2454"));
    assert.deepEqual(
      icDesign.members
        .filter((x) => asic.members.some((a) => a.code === x.code))
        .map((x) => x.code),
      ["2454"],
    );
  });
});
