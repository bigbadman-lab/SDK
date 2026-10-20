export type ReadinessReport = {
  sol: "unchecked";
  sdkBuy: "none" | "unchecked" | "short" | "covered";
  submits: false;
};

export function describeLaunchReadiness(input: {
  buyAmount: string;
  sdkBalanceBaseUnits: string | null;
  requiredSdkBaseUnits: string | null;
}): ReadinessReport {
  if (input.buyAmount === "0") {
    return { sol: "unchecked", sdkBuy: "none", submits: false };
  }
  if (input.sdkBalanceBaseUnits === null || input.requiredSdkBaseUnits === null) {
    return { sol: "unchecked", sdkBuy: "unchecked", submits: false };
  }
  const balance = BigInt(input.sdkBalanceBaseUnits);
  const required = BigInt(input.requiredSdkBaseUnits);
  return {
    sol: "unchecked",
    sdkBuy: balance >= required ? "covered" : "short",
    submits: false,
  };
}
