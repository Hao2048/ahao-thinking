export const nodePalettes = {
  input: { label:"输入", accent:"#365e9c", surface:"#ffffff", header:"#eaf1fc", border:"#c2d2ea", ink:"#243a54", muted:"#48607b", iconBg:"#f6f9ff" },
  analysis: { label:"分析", accent:"#856329", surface:"#fffefc", header:"#f3ead9", border:"#d5c6a7", ink:"#4b3d26", muted:"#6b5838", iconBg:"#fffcf5" },
  report: { label:"文档", accent:"#795c98", surface:"#fefdff", header:"#ece5f4", border:"#ccbddd", ink:"#483655", muted:"#645174", iconBg:"#fcf9ff" }
};
export const darkNodePalettes = {
  input: { label:"输入", accent:"#92b8eb", surface:"#252e3c", header:"#293b52", border:"#48637f", ink:"#e6eef8", muted:"#bbc9dc", iconBg:"#2b3a4d" },
  analysis: { label:"分析", accent:"#e3bc76", surface:"#252e3c", header:"#443c2e", border:"#7d6944", ink:"#f1e4cd", muted:"#dbc9a7", iconBg:"#423a2b" },
  report: { label:"文档", accent:"#c0a9e7", surface:"#252e3c", header:"#393147", border:"#6c5982", ink:"#eee5f8", muted:"#d0c1e2", iconBg:"#3c324a" }
};
export function getNodePalettes(theme = typeof document !== "undefined" ? document.documentElement.dataset.theme : "light") { return theme === "dark" ? darkNodePalettes : nodePalettes; }
export const customNodeColors = [{ value: "#dceafe", label: "雾蓝" }, { value: "#daf0e6", label: "青绿" }, { value: "#fae9c8", label: "麦黄" }, { value: "#e7e0fb", label: "丁香" }, { value: "#f8ddd7", label: "珊瑚" }, { value: "#eceef3", label: "石灰" }];
const rgb = (color) => /^#[0-9a-f]{6}$/i.test(color || "") ? [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)) : null;
const hex = (values) => "#" + values.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const mix = (a, b, amount) => hex(rgb(a).map((v, i) => v * (1 - amount) + rgb(b)[i] * amount));
export function luminance(color) {
  const values = rgb(color);
  if (!values) throw new Error("Invalid hex color");
  return values.map((v) => {
    const n = v / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  }).reduce((v, n, i) => v + n * [0.2126, 0.7152, 0.0722][i], 0);
}
export function contrastRatio(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
export function nodePalette(definition, color, theme) {
  const base = getNodePalettes(theme)[definition?.category] || { label: "未识别", accent: "#546578", surface: "#eef1f5", header: "#e1e7ee", border: "#a8b4c2", ink: "#2d3c4d", muted: "#536476", iconBg: "#ffffff" };
  if(definition?.id==='input.start')return {...base,label:'开始',header:'#ad414b',headerInk:'#ffffff',accent:'#b44751',border:'#c9868d',iconBg:'#8f303a'};
  if (!rgb(color)) return base;
  let ink = contrastRatio("#1f2933", color) >= contrastRatio("#ffffff", color) ? "#1f2933" : "#ffffff";
  if(contrastRatio(ink,color)<4.5)ink="#000000";
  // Separate header/body even for very pale saved custom colors. Preserve readable text.
  let header = luminance(color) < 0.06 ? mix(color, "#ffffff", 0.16) : mix(color, "#000000", 0.12);
  if (contrastRatio(ink, header) < 4.5) header = mix(color, "#ffffff", 0.26);
  const accent = ink === "#ffffff" ? "#ffffff" : "#36485a";
  return { ...base, surface: color, header, ink, muted: ink, accent, border: mix(color, ink, 0.4), iconBg: header };
}
export function nodePaletteStyle(definition, color) {
  const p = nodePalette(definition, color);
  return Object.entries(p).filter(([key]) => key !== "label").map(([key, value]) => `--node-${key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}:${value}`).join(";");
}
