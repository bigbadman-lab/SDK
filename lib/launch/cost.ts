// The version-1 launch compiler and the launch screen share this priority fee.

export const LAUNCH_PRIORITY_FEE_LAMPORTS = BigInt(5000);

export function networkCostCopy(): string {
  const lamports = BigInt(1_000_000_000);
  const whole = LAUNCH_PRIORITY_FEE_LAMPORTS / lamports;
  const fraction = (LAUNCH_PRIORITY_FEE_LAMPORTS % lamports).toString().padStart(9, "0").replace(/0+$/, "");
  const amount = fraction.length > 0 ? `${whole.toString()}.${fraction}` : whole.toString();
  return `Your wallet pays the Solana network fee. This transaction adds a priority fee of ${amount} SOL.`;
}
