export function launchMessage(code: string): string {
  if (code === "unauthenticated") return "Sign in to prepare a launch.";
  if (code === "not_owner" || code === "source")
    return "That SDK is not available.";
  if (code === "deleted") return "A deleted SDK cannot be prepared for launch.";
  if (code === "unsaved") return "Save this SDK before preparing a launch.";
  if (code === "test_required")
    return "Test this SDK successfully before preparing a launch.";
  if (code === "stale_revision")
    return "This SDK revision changed. Open Launch again from the current revision.";
  if (code === "blueprint_invalid")
    return "This SDK revision cannot be launched.";
  if (code === "source_changed")
    return "This preparation is bound to a different SDK.";
  if (code === "artwork" || code === "asset_not_found")
    return "Upload square PNG or JPEG artwork first.";
  if (code === "image_type")
    return "Use a PNG or JPEG file. The file contents must match its type.";
  if (code === "image_square")
    return "Artwork must be exactly square. Nothing is cropped.";
  if (code === "image_small") return "Artwork must be at least 64×64 pixels.";
  if (code === "image_dimensions")
    return "This image is larger than the accepted square size.";
  if (code === "image_malformed")
    return "This file is damaged or is not a complete PNG or JPEG.";
  if (code === "expired" || code === "preparation")
    return "This preparation expired or is not available. Open Launch again from the SDK.";
  if (code === "image_large" || code === "too_large")
    return "Artwork must be 5 MB or smaller.";
  if (code === "name") return "Enter a token name up to 32 characters.";
  if (code === "symbol") return "Enter a ticker of 1 to 13 letters or numbers.";
  if (code === "description")
    return "Enter a token description up to 500 characters.";
  if (code === "website")
    return "Enter a website as an https link, up to 200 characters.";
  if (code === "twitter")
    return "Enter an X link as https://x.com/name or https://twitter.com/name.";
  if (code === "telegram") return "Enter a Telegram link as https://t.me/name.";
  if (code === "buy")
    return "Enter the developer buy in $SDK, or leave it at 0.";
  if (code === "slippage")
    return "Choose slippage between 0.1% and 10% when the developer buy is above zero.";
  if (code === "idempotency_conflict")
    return "This preparation was already saved with different details.";
  if (code === "launch_open")
    return "A launch is still being confirmed. Check that launch before starting another. A new token was not created.";
  if (code === "uri" || code === "uri_too_long")
    return "The metadata link is too long for a token launch.";
  if (code === "pin_failed")
    return "The artwork or metadata could not be pinned. Nothing was marked ready.";
  if (code === "schema_missing" || code === "unavailable" || code === "not_ready")
    return "Launch preparation is unavailable.";
  if (code === "simulation_failed")
    return "The launch transaction did not simulate. Nothing was signed.";
  if (code === "builder_rejected")
    return "The transaction builder rejected this launch. Nothing was signed.";
  if (code === "builder_unconfigured")
    return "The transaction builder is not configured. Nothing was signed.";
  if (code === "parent_unregistered")
    return "The rehearsal parent is not registered.";
  if (code === "closed") return "Public token launches are not open.";
  if (code === "parent_immutable" || code === "parent_scope")
    return "This launch stays paired with its original parent.";
  if (code === "wire_key")
    return "Submission needs the signing-wire key before it can be saved.";
  if (code === "mint_conflict" || code === "mint_lost")
    return "This launch already has a mint. A new mint was not created.";
  if (code === "message_changed")
    return "The transaction changed. It was not signed.";
  if (code === "sign_rejected")
    return "Phantom declined the transaction. Nothing was submitted.";
  return "The launch preparation was not accepted.";
}
