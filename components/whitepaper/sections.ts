export const WHITEPAPER_SECTIONS = [
  { id: "vision", index: "01", label: "The Vision" },
  { id: "platform", index: "02", label: "The Platform" },
  { id: "marketplace", index: "03", label: "Marketplace" },
  { id: "business-model", index: "04", label: "Business Model" },
  { id: "native-token", index: "05", label: "Native $SDK" },
  { id: "tokenomics", index: "06", label: "Tokenomics" },
  { id: "launches", index: "07", label: "Launches" },
  { id: "infrastructure", index: "08", label: "Infrastructure" },
  { id: "flywheel", index: "09", label: "Flywheel" },
  { id: "direction", index: "10", label: "Direction" },
  { id: "transparency", index: "11", label: "Transparency" },
  { id: "build", index: "12", label: "Build What's Next" },
] as const;

export type WhitepaperSectionId = (typeof WHITEPAPER_SECTIONS)[number]["id"];
