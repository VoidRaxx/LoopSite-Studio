import type { Theme } from "./types";

export type ThemePalette = {
  bg: string;
  panel: string;
  sidebar: string;
  line: string;
  text: string;
  muted: string;
  accent: string;
  accentBg: string;
  glass: string;
  danger: string;
  onAccent: string;
};

export type ThemeOption = {
  id: Exclude<Theme, "system">;
  label: string;
  description: string;
  light: boolean;
  palette: ThemePalette;
};

export const THEME_OPTIONS: readonly ThemeOption[] = [
  { id:"default", label:"Default", description:"LoopSite · Navy und Cyan", light:false,
    palette:{bg:"#090e18",panel:"#11192a",sidebar:"#0c1321",line:"#29364f",text:"#ecf2ff",muted:"#a0afc9",accent:"#83d3ff",accentBg:"#1d3954",glass:"rgba(100,148,213,.12)",danger:"#ff8c9d",onAccent:"#071521"}},
  { id:"universe-dark", label:"Universe Dark", description:"Violett · Dunkel", light:false,
    palette:{bg:"#0e0b1c",panel:"#1a1530",sidebar:"#120e24",line:"#393153",text:"#f4efff",muted:"#b4a8d0",accent:"#bfa6ff",accentBg:"#352851",glass:"rgba(166,132,229,.11)",danger:"#ff94ac",onAccent:"#1c1030"}},
  { id:"universe-light", label:"Universe Light", description:"Lavendel · Hell", light:true,
    palette:{bg:"#f7f3ff",panel:"#ffffff",sidebar:"#eee7fa",line:"#d9d0ea",text:"#282039",muted:"#675c7b",accent:"#6445ab",accentBg:"#ebe2f8",glass:"rgba(111,71,173,.07)",danger:"#a72c53",onAccent:"#ffffff"}},
  { id:"dark", label:"Dark", description:"Neutral · Dunkel", light:false,
    palette:{bg:"#101113",panel:"#1c1e21",sidebar:"#17191c",line:"#373a3f",text:"#f2f3f5",muted:"#aeb3bc",accent:"#dddddf",accentBg:"#313438",glass:"rgba(225,225,225,.05)",danger:"#ff9a9a",onAccent:"#18191b"}},
  { id:"white", label:"White", description:"Neutral · Hell", light:true,
    palette:{bg:"#f5f7fb",panel:"#ffffff",sidebar:"#eef1f6",line:"#dce1ea",text:"#202938",muted:"#5c6980",accent:"#286da9",accentBg:"#e1eef8",glass:"rgba(49,95,150,.05)",danger:"#ad2c50",onAccent:"#ffffff"}},
  { id:"ocean-dark", label:"Ocean Dark", description:"Petrol · Türkis", light:false,
    palette:{bg:"#07191e",panel:"#10292e",sidebar:"#0a2228",line:"#295059",text:"#e4fcfa",muted:"#9bc0c2",accent:"#67e5d4",accentBg:"#174a4a",glass:"rgba(65,197,179,.10)",danger:"#ff9f9e",onAccent:"#05201e"}},
  { id:"forest-dark", label:"Forest Dark", description:"Grün · Dunkel", light:false,
    palette:{bg:"#111a15",panel:"#1a2a21",sidebar:"#142018",line:"#354d3b",text:"#edf8ef",muted:"#abc4b0",accent:"#a3e4aa",accentBg:"#2b4b32",glass:"rgba(137,202,144,.09)",danger:"#ffa0a7",onAccent:"#102013"}},
  { id:"graphite", label:"Graphite", description:"Anthrazit · Gold", light:false,
    palette:{bg:"#171819",panel:"#242629",sidebar:"#1c1e20",line:"#414348",text:"#f7f3e8",muted:"#bbb7ad",accent:"#e8c17b",accentBg:"#40382c",glass:"rgba(224,196,145,.08)",danger:"#ffa1a1",onAccent:"#272013"}},
  { id:"rose-dark", label:"Rose Dark", description:"Pflaume · Rosé", light:false,
    palette:{bg:"#1a1018",panel:"#2a1b28",sidebar:"#221522",line:"#4d3348",text:"#fff0f6",muted:"#d2b1c4",accent:"#f7a8c9",accentBg:"#493044",glass:"rgba(228,126,176,.10)",danger:"#ffaba0",onAccent:"#321424"}},
  { id:"sunset-light", label:"Sunset Light", description:"Sand · Terrakotta", light:true,
    palette:{bg:"#fff6ee",panel:"#fffdf9",sidebar:"#f7e9dc",line:"#e8d4c4",text:"#3f2c26",muted:"#80675c",accent:"#a54a35",accentBg:"#fae4d4",glass:"rgba(174,98,61,.07)",danger:"#b72c44",onAccent:"#ffffff"}},
  { id:"arctic-light", label:"Arctic Light", description:"Eisblau · Klar", light:true,
    palette:{bg:"#edf8fa",panel:"#ffffff",sidebar:"#deeff3",line:"#cbdee4",text:"#1b3543",muted:"#55717e",accent:"#196f8c",accentBg:"#d7eef6",glass:"rgba(36,121,155,.06)",danger:"#a72f59",onAccent:"#ffffff"}},
];

export function resolveTheme(theme: Theme, prefersDark: boolean): ThemeOption {
  const resolved = theme === "system" ? (prefersDark ? "dark" : "white") : theme;
  return THEME_OPTIONS.find(option => option.id === resolved) ?? THEME_OPTIONS[0];
}

export function isLightTheme(theme: Theme): boolean {
  return THEME_OPTIONS.find(option => option.id === theme)?.light ?? false;
}
