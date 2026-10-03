/**
 * AI 供應鏈輪動題材（人工維護）。
 *
 * 拆法以台股市場常用的供應鏈節點為主：一檔可出現在數個真的相關節點。
 * 群名與切法受公開輪動產品／市場用語啟發；成分是本站獨立維護的代表性
 * 上市櫃普通股，並非任何第三方服務的成分名單複製。
 */

import type { SectorDef, SectorMember } from "@/lib/sector-universe";

const group = (
  id: string,
  name: string,
  basis: string,
  members: SectorMember[],
): SectorDef => ({ id, name, basis, kind: "theme", members });

export const ROTATION_THEME_UNIVERSE: SectorDef[] = [
  group("foundry", "晶圓代工（台積電）", "AI 加速器製造的單一權值對照", [
    { code: "2330", name: "台積電" },
  ]),
  group("asic-ip", "ASIC／矽智財", "客製 AI 晶片設計服務與 IP 授權；聯發科以 AI ASIC 設計能力跨標籤", [
    { code: "3661", name: "世芯-KY" }, { code: "3443", name: "創意" },
    { code: "3035", name: "智原" }, { code: "3529", name: "力旺" },
    { code: "6533", name: "晶心科" }, { code: "6643", name: "M31" },
    { code: "6531", name: "愛普*" }, { code: "2454", name: "聯發科" },
  ]),
  group("ic-design", "IC 設計", "泛用 Fabless SoC／消費電子與權值設計股；不含 ASIC 設計服務／IP", [
    { code: "2454", name: "聯發科" }, { code: "3034", name: "聯詠" },
    { code: "2379", name: "瑞昱" }, { code: "6415", name: "矽力*-KY" },
    { code: "8016", name: "矽創" }, { code: "3227", name: "原相" },
    { code: "3545", name: "敦泰" },
  ]),
  group("bmc", "BMC（信驊）", "伺服器遠端管理晶片；單一指標股對照", [
    { code: "5274", name: "信驊" },
  ]),
  group("high-speed-ic", "高速傳輸 IC", "PCIe／USB／訊號重整等高速介面晶片", [
    { code: "4966", name: "譜瑞-KY" }, { code: "5269", name: "祥碩" },
  ]),
  group("advanced-packaging-equipment", "先進封裝設備", "CoWoS 等先進封裝製程設備", [
    { code: "3131", name: "弘塑" }, { code: "3583", name: "辛耘" },
    { code: "6187", name: "萬潤" }, { code: "8027", name: "鈦昇" },
    { code: "2467", name: "志聖" }, { code: "6640", name: "均華" },
  ]),
  group("package-test", "封裝測試", "IC 封裝與測試代工", [
    { code: "3711", name: "日月光投控" }, { code: "6239", name: "力成" },
    { code: "2449", name: "京元電子" }, { code: "3374", name: "精材" },
    { code: "6257", name: "矽格" }, { code: "3264", name: "欣銓" },
  ]),
  group("test-interface", "測試介面／設備", "探針卡、測試座與測試分選設備", [
    { code: "2360", name: "致茂" }, { code: "6683", name: "雍智科技" },
    { code: "6223", name: "旺矽" }, { code: "6510", name: "精測" },
  ]),
  group("analysis", "檢測分析", "半導體材料、故障與可靠度分析", [
    { code: "6830", name: "汎銓" }, { code: "3587", name: "閎康" },
    { code: "3289", name: "宜特" },
  ]),
  group("memory", "記憶體", "DRAM／NAND、控制晶片、模組與封測", [
    { code: "2408", name: "南亞科" }, { code: "2344", name: "華邦電" },
    { code: "2337", name: "旺宏" }, { code: "8299", name: "群聯" },
    { code: "3260", name: "威剛" }, { code: "4967", name: "十銓" },
    { code: "2451", name: "創見" }, { code: "8271", name: "宇瞻" },
  ]),
  group("abf", "ABF 載板", "高階運算封裝用 ABF 載板", [
    { code: "3037", name: "欣興" }, { code: "8046", name: "南電" },
    { code: "3189", name: "景碩" },
  ]),
  group("ccl", "CCL 銅箔基板", "伺服器 PCB 用銅箔基板", [
    { code: "2383", name: "台光電" }, { code: "6213", name: "聯茂" },
    { code: "6274", name: "台燿" },
  ]),
  group("glass-copper", "玻纖布／銅箔", "CCL 上游低介電玻纖與銅箔材料", [
    { code: "1303", name: "南亞" }, { code: "1802", name: "台玻" },
    { code: "1326", name: "台化" },
  ]),
  group("server-pcb", "PCB（伺服器板／HDI）", "伺服器與 AI 加速卡 PCB／HDI", [
    { code: "2368", name: "金像電" }, { code: "4958", name: "臻鼎-KY" },
    { code: "3044", name: "健鼎" }, { code: "2313", name: "華通" },
    { code: "5469", name: "瀚宇博" }, { code: "2355", name: "敬鵬" },
  ]),
  group("thermal", "散熱", "風扇、均熱、液冷板、快接頭與 CDU", [
    { code: "3017", name: "奇鋐" }, { code: "3324", name: "雙鴻" },
    { code: "2421", name: "建準" }, { code: "3483", name: "力致" },
    { code: "3653", name: "健策" }, { code: "8996", name: "高力" },
    { code: "6805", name: "富世達" }, { code: "6230", name: "超眾" },
  ]),
  group("power-bbu", "電源／BBU", "伺服器電源、UPS 與備援電池", [
    { code: "2308", name: "台達電" }, { code: "2301", name: "光寶科" },
    { code: "6412", name: "群電" }, { code: "6282", name: "康舒" },
    { code: "4931", name: "新盛力" }, { code: "6409", name: "旭隼" },
  ]),
  group("power-grid", "重電／電網", "變壓器、配電與資料中心電力設備", [
    { code: "1513", name: "中興電" }, { code: "1519", name: "華城" },
    { code: "1514", name: "亞力" }, { code: "1503", name: "士電" },
    { code: "1504", name: "東元" }, { code: "1609", name: "大亞" },
  ]),
  group("rails", "滑軌", "伺服器機櫃用滑軌", [
    { code: "2059", name: "川湖" }, { code: "6584", name: "南俊國際" },
  ]),
  group("chassis", "機殼", "伺服器機殼與機櫃", [
    { code: "8210", name: "勤誠" }, { code: "3693", name: "營邦" },
    { code: "6117", name: "迎廣" }, { code: "3013", name: "晟銘電" },
  ]),
  group("highspeed-connectors", "高速連接器／線材", "伺服器內部高速連接、插槽與銅纜", [
    { code: "3665", name: "貿聯-KY" }, { code: "3533", name: "嘉澤" },
    { code: "6197", name: "佳必琪" }, { code: "3526", name: "凡甲" },
    { code: "3217", name: "優群" }, { code: "3605", name: "宏致" },
  ]),
  group("passives", "被動元件", "電容、電阻、電感與通路", [
    { code: "2327", name: "國巨*" }, { code: "2492", name: "華新科" },
    { code: "3090", name: "日電貿" }, { code: "2478", name: "大毅" },
    { code: "3357", name: "臺慶科" }, { code: "6449", name: "鈺邦" },
  ]),
  group("ai-server", "組裝代工（ODM）", "AI 伺服器與機櫃組裝代工", [
    { code: "6669", name: "緯穎" }, { code: "2382", name: "廣達" },
    { code: "3231", name: "緯創" }, { code: "2356", name: "英業達" },
    { code: "2317", name: "鴻海" }, { code: "2324", name: "仁寶" },
    { code: "2376", name: "技嘉" }, { code: "3706", name: "神達" },
  ]),
  group("networking", "網通設備", "交換器、路由器與網通設備代工", [
    { code: "2345", name: "智邦" }, { code: "4906", name: "正文" },
    { code: "3380", name: "明泰" }, { code: "6285", name: "啟碁" },
    { code: "5388", name: "中磊" }, { code: "3596", name: "智易" },
  ]),
  group("optical", "矽光子／光通訊", "光收發模組、光纖元件、雷射與 CPO", [
    { code: "3081", name: "聯亞" }, { code: "3450", name: "聯鈞" },
    { code: "4979", name: "華星光" }, { code: "6442", name: "光聖" },
    { code: "4908", name: "前鼎" }, { code: "3163", name: "波若威" },
    { code: "3363", name: "上詮" }, { code: "6451", name: "訊芯-KY" },
  ]),
  group("compound-semiconductor", "磊晶／化合物半導體", "射頻、功率與光電元件的化合物半導體", [
    { code: "3105", name: "穩懋" }, { code: "3707", name: "漢磊" },
    { code: "2455", name: "全新" }, { code: "8086", name: "宏捷科" },
    { code: "4991", name: "環宇-KY" }, { code: "3016", name: "嘉晶" },
  ]),
  group("robot", "機器人", "工業／協作機器人、減速機與自動化", [
    { code: "2049", name: "上銀" }, { code: "1590", name: "亞德客-KY" },
    { code: "2359", name: "所羅門" }, { code: "4585", name: "達明" },
    { code: "6215", name: "和椿" }, { code: "8374", name: "羅昇" },
  ]),
  group("fab-engineering", "廠務工程", "晶圓廠與資料中心無塵室、機電與氣體工程", [
    { code: "2404", name: "漢唐" }, { code: "6196", name: "帆宣" },
    { code: "6139", name: "亞翔" }, { code: "5536", name: "聖暉*" },
    { code: "6691", name: "洋基工程" }, { code: "6613", name: "朋億*" },
  ]),
];
