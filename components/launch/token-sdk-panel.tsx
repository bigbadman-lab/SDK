import { TokenSdkDetails } from "@/components/launch/token-sdk-details";
import { officialInputGuide } from "@/lib/library/official";
import { siteConfig } from "@/lib/metadata";
import { loadPublishedTokenSdk } from "@/lib/server/launch/discover";
import type { PublishedTokenSdk } from "@/lib/launch/verified-launch";
import type { ReactNode } from "react";

function withInputGuides(sdk: PublishedTokenSdk | null): PublishedTokenSdk | null {
  if (!sdk) return null;
  const guide = officialInputGuide(sdk.name);
  if (!guide) return sdk;
  return {
    ...sdk,
    inputs: sdk.inputs.map((field) => {
      const help = guide[field.key];
      return help ? { ...field, help: help.help, example: help.example } : field;
    }),
  };
}

export async function TokenSdkPanel({
  librarySdkId,
  sdkName,
}: {
  librarySdkId: string | null;
  sdkName: string;
}): Promise<ReactNode> {
  const sdk = withInputGuides(await loadPublishedTokenSdk(librarySdkId));
  return <TokenSdkDetails sdk={sdk} sdkName={sdkName} baseUrl={siteConfig.url ?? "https://sdk.fund"} />;
}
