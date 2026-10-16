export function handoffPrompt(absNote: string, absFeature: string | null, absAssets: string): string {
  const feature = absFeature ? ` and the feature overview at \`${absFeature}\`` : "";
  return `Read the ticket note at \`${absNote}\`${feature}. Treat them as the source of truth for this work. Referenced screenshots and videos are in \`${absAssets}\`; view the images that the note links to. Then: `;
}
