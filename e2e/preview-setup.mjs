import { verifyPreviewSource } from "../scripts/qa/preview-server.mjs";

export default async function verifyPreviewBeforeTests(config) {
  const baseURLs = new Set(config.projects.map(project => project.use.baseURL).filter(Boolean));
  for (const baseURL of baseURLs) await verifyPreviewSource(baseURL);
}
