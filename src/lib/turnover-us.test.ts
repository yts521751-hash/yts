import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isLikelyUsEquitySymbol,
  parseNasdaqNumber,
  parseNasdaqScreenerRows,
  selectLiquidCommonByDollarVolume,
  cleanNasdaqCompanyName,
} from "./nasdaq-us";
import {
  usdTurnoverToYi,
  US_YI_USD,
  AMOUNT_BASIS,
  UNIVERSE_BASIS,
  CHANGE_PCT_BASIS_MARKER,
  changePctFromLastAndNet,
  resolveUsTurnoverChangePct,
  rankUsTurnoverCandidates,
} from "./turnover-us";
import { formatUsTurnoverYi } from "./format";
import { isUsCommonStock } from "./us-market";
import { resolveUsDisplayNames, US_NAME_ZH } from "./us-company-names";

describe("us turnover unit / formula", () => {
  it("usdTurnoverToYi is dollarVolume / 1e8 (億美元)", () => {
    assert.equal(US_YI_USD, 1e8);
    assert.equal(usdTurnoverToYi(331.3e8), 331.3);
    assert.equal(usdTurnoverToYi(278e8), 278);
  });

  it("amount / universe basis describe screener-driven Nasdaq path", () => {
    assert.ok(AMOUNT_BASIS.includes("Nasdaq"));
    assert.ok(AMOUNT_BASIS.includes("screener"));
    assert.ok(AMOUNT_BASIS.includes(CHANGE_PCT_BASIS_MARKER));
    assert.ok(UNIVERSE_BASIS.includes("screener"));
    assert.ok(!UNIVERSE_BASIS.toLowerCase().includes("whitelist"));
  });

  it("parses Nasdaq percentageChange / netChange strings", () => {
    assert.equal(parseNasdaqNumber("+1.02%"), 1.02);
    assert.equal(parseNasdaqNumber("-2.05%"), -2.05);
    assert.equal(parseNasdaqNumber("+3.37"), 3.37);
    assert.equal(changePctFromLastAndNet(333.69, 3.37), (3.37 / (333.69 - 3.37)) * 100);
  });

  it("resolveUsTurnoverChangePct pairs Nasdaq close with Nasdaq session %", () => {
    // Before: Yahoo day-file changePct (-0.81) was preferred while close was Nasdaq Oct2
    const pct = resolveUsTurnoverChangePct({
      closeSource: "nasdaq",
      nasdaqPct: 1.02,
      nasdaqNet: 3.37,
      nasdaqLast: 333.69,
      screenerPct: 0.5,
      cachedPct: -0.81,
    });
    assert.equal(pct, 1.02);

    const fromNet = resolveUsTurnoverChangePct({
      closeSource: "nasdaq",
      nasdaqPct: null,
      nasdaqNet: 3.09,
      nasdaqLast: 233.95,
      cachedPct: 1.09,
    });
    assert.ok(Math.abs(fromNet - (3.09 / (233.95 - 3.09)) * 100) < 1e-9);

    const yahooClose = resolveUsTurnoverChangePct({
      closeSource: "yahoo",
      nasdaqPct: 1.02,
      cachedPct: -0.81,
      screenerPct: 0.5,
    });
    assert.equal(yahooClose, -0.81);
  });

  it("formatUsTurnoverYi labels 億美元", () => {
    assert.equal(formatUsTurnoverYi(278), "278.0 億美元");
  });
});

describe("nasdaq screener liquid universe (systemic)", () => {
  it("parseNasdaqScreenerRows computes dollarVolume", () => {
    const rows = parseNasdaqScreenerRows([
      {
        symbol: "aaa",
        name: "AAA Inc. Common Stock",
        lastsale: "$10.00",
        volume: "1,000,000",
        netchange: "0.5",
        pctchange: "5%",
        marketCap: "1,000,000,000",
      },
    ]);
    assert.equal(rows[0].symbol, "AAA");
    assert.equal(rows[0].lastSale, 10);
    assert.equal(rows[0].volume, 1_000_000);
    assert.equal(rows[0].dollarVolume, 10e6);
  });

  it("selectLiquidCommonByDollarVolume drops ETF/warrants and ranks by $ volume", () => {
    const rows = parseNasdaqScreenerRows([
      {
        symbol: "SPY",
        name: "SPDR S&P 500 ETF Trust",
        lastsale: "$500",
        volume: "100000000",
      },
      {
        symbol: "NIVFW",
        name: "NewGenIvf Warrant",
        lastsale: "$0.03",
        volume: "50000000",
      },
      {
        symbol: "AAAA",
        name: "Hot One Common Stock",
        lastsale: "$100",
        volume: "50000000",
      },
      {
        symbol: "BBBB",
        name: "Hot Two Common Stock",
        lastsale: "$50",
        volume: "80000000",
      },
      {
        symbol: "CCCC",
        name: "Cold Stock Common Stock",
        lastsale: "$10",
        volume: "100000", // below min dollar volume
      },
    ]);
    const picked = selectLiquidCommonByDollarVolume(rows, {
      limit: 10,
      minDollarVolume: 1e8,
      isCommonStock: isUsCommonStock,
    });
    assert.deepEqual(
      picked.map((r) => r.symbol),
      ["AAAA", "BBBB"],
    );
    assert.ok(picked[0].dollarVolume > picked[1].dollarVolume);
  });

  it("isLikelyUsEquitySymbol / isUsCommonStock keep equities, drop ETF & warrants", () => {
    assert.equal(isLikelyUsEquitySymbol("BE"), true);
    assert.equal(isLikelyUsEquitySymbol("SPCX"), true);
    assert.equal(isLikelyUsEquitySymbol("BRK.B"), true);
    assert.equal(isLikelyUsEquitySymbol("NIVFW"), false);
    assert.equal(isUsCommonStock("SPCX", "Space Exploration Technologies"), true);
    assert.equal(isUsCommonStock("SNDK", "Sandisk"), true);
    assert.equal(isUsCommonStock("SPY", "SPDR S&P 500 ETF Trust"), false);
    assert.equal(isUsCommonStock("QQQ", "Invesco QQQ Trust"), false);
    assert.equal(isUsCommonStock("SOXL", "Direxion Daily Semiconductor Bull 3X"), false);
  });

  it("rankUsTurnoverCandidates re-ranks with Nasdaq quote volume (not curated whitelist)", () => {
    // Screener universe includes names outside any sector list; quote vols set final order
    const screener = parseNasdaqScreenerRows([
      {
        symbol: "ALPHA",
        name: "Alpha Corp Common Stock",
        lastsale: "$10",
        volume: "100000000", // screener $1.0B
      },
      {
        symbol: "BETA",
        name: "Beta Inc Common Stock",
        lastsale: "$20",
        volume: "40000000", // screener $0.8B
      },
      {
        symbol: "GAMMA",
        name: "Gamma Co Common Stock",
        lastsale: "$5",
        volume: "50000000", // screener $0.25B
      },
      {
        symbol: "SPY",
        name: "SPDR S&P 500 ETF Trust",
        lastsale: "$500",
        volume: "200000000",
      },
    ]).filter((r) => isUsCommonStock(r.symbol, r.name));

    const quote = new Map([
      // BETA gets huge official volume → should rank #1 after correction
      ["BETA", { volume: 200_000_000, lastPrice: 20, companyName: "Beta Inc" }],
      ["ALPHA", { volume: 50_000_000, lastPrice: 10, companyName: "Alpha Corp" }],
      ["GAMMA", { volume: null, lastPrice: 5, companyName: "Gamma Co" }],
    ]);

    const ranked = rankUsTurnoverCandidates(screener, quote, { limit: 10 });
    assert.equal(ranked[0].code, "BETA");
    assert.equal(ranked[0].volumeSource, "nasdaq");
    assert.ok(ranked.every((r) => r.code !== "SPY"));
    // GAMMA uses screener volume when quote vol missing
    const gamma = ranked.find((r) => r.code === "GAMMA");
    assert.ok(gamma);
    assert.equal(gamma!.volumeSource, "screener");
  });

  it("rankUsTurnoverCandidates uses Nasdaq session % when close is Nasdaq (not stale Yahoo)", () => {
    const screener = parseNasdaqScreenerRows([
      {
        symbol: "AAPL",
        name: "Apple Inc. Common Stock",
        lastsale: "$330.32",
        volume: "36000000",
        pctchange: "-0.81%",
        netchange: "-2.70",
      },
      {
        symbol: "MU",
        name: "Micron Technology Common Stock",
        lastsale: "$1097.39",
        volume: "45000000",
        pctchange: "3.03%",
        netchange: "32.28",
      },
    ]);
    const quote = new Map([
      [
        "AAPL",
        {
          volume: 33_278_651,
          lastPrice: 333.69,
          percentageChange: 1.02,
          netChange: 3.37,
          companyName: "Apple Inc.",
        },
      ],
      [
        "MU",
        {
          volume: 27_337_722,
          lastPrice: 1074.89,
          percentageChange: -2.05,
          netChange: -22.5,
          companyName: "Micron Technology",
        },
      ],
    ]);
    const cachedQuotes = new Map([
      ["AAPL", { close: 330.32, changePct: -0.81, volume: 36_306_300 }],
      ["MU", { close: 1097.39, changePct: 3.03, volume: 45_735_400 }],
    ]);
    const ranked = rankUsTurnoverCandidates(screener, quote, {
      limit: 10,
      cachedQuotes,
    });
    const aapl = ranked.find((r) => r.code === "AAPL");
    const mu = ranked.find((r) => r.code === "MU");
    assert.ok(aapl && mu);
    assert.equal(aapl!.close, 333.69);
    assert.equal(aapl!.changePct, 1.02);
    assert.equal(mu!.close, 1074.89);
    assert.equal(mu!.changePct, -2.05);
  });

  it("sanity: example high-DV names land near user refs with Nasdaq vol×close", () => {
    // Examples only — proves formula+filter path, not a whitelist requirement
    const cases = [
      { code: "SPCX", close: 150.86, vol: 79_614_390, ref: 120.1 },
      { code: "SNDK", close: 1739.89, vol: 6_052_590, ref: 105.3 },
      { code: "BE", close: 276.98, vol: 15_279_708, ref: 42.3 },
      { code: "MRNA", close: 192.57, vol: 20_649_505, ref: 39.8 },
      { code: "HOOD", close: 112.5, vol: 35_140_211, ref: 39.5 },
    ];
    const screener = cases.map((c) => ({
      symbol: c.code,
      name: `${c.code} Common Stock`,
      lastSale: c.close,
      netChange: 0,
      pctChange: 0,
      volume: Math.floor(c.vol * 0.9), // understated screener vol
      marketCap: null,
      dollarVolume: c.close * Math.floor(c.vol * 0.9),
      sector: "",
      industry: "",
    }));
    // Mix in filler so examples are not the only rows
    for (let i = 0; i < 40; i++) {
      screener.push({
        symbol: `F${i}`,
        name: `Filler ${i} Common Stock`,
        lastSale: 50,
        netChange: 0,
        pctChange: 0,
        volume: 1_000_000 + i * 1000,
        marketCap: null,
        dollarVolume: 50 * (1_000_000 + i * 1000),
        sector: "",
        industry: "",
      });
    }
    const quote = new Map(
      cases.map((c) => [
        c.code,
        { volume: c.vol, lastPrice: c.close, companyName: `${c.code} Inc` },
      ]),
    );
    const ranked = rankUsTurnoverCandidates(screener, quote, { limit: 50 });
    for (const c of cases) {
      const row = ranked.find((r) => r.code === c.code);
      assert.ok(row, `${c.code} should appear in Top50 from dollar-volume pool`);
      const yi = Math.round(usdTurnoverToYi(row!.dollarVolume) * 10) / 10;
      assert.ok(
        Math.abs(yi - c.ref) <= 0.2,
        `${c.code}: got ${yi} want ~${c.ref}`,
      );
    }
  });

  it("display names resolve for liquid names without requiring curated sector list", () => {
    assert.ok(US_NAME_ZH.SPCX);
    assert.ok(US_NAME_ZH.SNDK);
    const names = resolveUsDisplayNames({
      code: "ZZZZ",
      nasdaqName: cleanNasdaqCompanyName("Zed Zed Corp. Common Stock"),
    });
    assert.ok(names.nameEn.length > 0);
    assert.ok(names.nameZh.length > 0);
  });
});
