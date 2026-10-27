export type BuilderExample = {
  id: string;
  label: string;
  prompt: string;
};

export const BUILDER_EXAMPLES: readonly BuilderExample[] = [
  {
    id: "writing-assistant",
    label: "Build an AI writing assistant",
    prompt:
      "Build an AI-powered writing assistant. Inputs: original_text (required string), desired_tone (required string), and audience (required string). Use one ai.generate step. Rewrite the original text for the specified tone and audience. Return the rewritten text in the text field.",
  },
  {
    id: "document-summariser",
    label: "Create a document summariser",
    prompt:
      "Build an SDK that summarises pasted document text. Inputs: document_text (required string) and objective (required string). Use one ai.analyze step. Return a concise summary in summary and key factual findings in findings. Do not claim to read files or URLs.",
  },
  {
    id: "decision-assistant",
    label: "Build a decision-making assistant",
    prompt:
      "Build an SDK that compares options for a decision. Inputs: problem (required string), options (required string), and priorities (required string). Use one ai.analyze step. Return the overall comparison in summary, and trade-offs, risks, and a recommendation in findings. Avoid invented facts or probabilities.",
  },
  {
    id: "feedback-classifier",
    label: "Create a feedback classifier",
    prompt:
      "Build an SDK that classifies pasted customer feedback. Inputs: feedback (required string) and categories (required string). Use one ai.analyze step. In findings, assign each feedback item to a supplied category or unclear. Include category totals in summary. Do not use external APIs or custom JSON schemas.",
  },
  {
    id: "wallet-analyser",
    label: "Build a Solana wallet analyser",
    prompt:
      "Build an SDK that explains a Solana wallet using on-chain evidence. Input: wallet (required solanaAddress). Read its balance and up to five recent transaction signatures using the available Solana operations. Analyse only the returned data. Report findings and sample limitations. Do not infer wallet ownership or sign transactions.",
  },
  {
    id: "token-information",
    label: "Create a token information tool",
    prompt:
      "Build an SDK that explains a Solana token mint. Input: mint (required solanaAddress). Read the on-chain mint data using solana.token in mint mode. Analyse the available supply, decimals and authorities. Include absent information as limitations. Do not invent token risk scores or safety claims.",
  },
];

export function insertedExamplePrompt(example: BuilderExample): string {
  return example.prompt;
}
