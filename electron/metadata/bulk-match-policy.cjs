const AUTO_APPLY_CONFIDENCE = 0.85;
const REVIEW_CONFIDENCE = 0.65;
const CLEAR_LEAD_MARGIN = 0.12;
const MAX_REVIEW_CANDIDATES = 3;

function classifyBulkMetadataCandidates(candidates) {
  const ranked = Array.isArray(candidates)
    ? candidates
      .filter((candidate) => Number.isFinite(candidate?.confidence))
      .slice()
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, MAX_REVIEW_CANDIDATES)
    : [];
  const best = ranked[0];
  if (!best || best.confidence < REVIEW_CONFIDENCE) {
    return { kind: "unmatched", confidence: best?.confidence || 0 };
  }

  const runnerUp = ranked[1];
  const isClearlyLeading = !runnerUp || best.confidence - runnerUp.confidence >= CLEAR_LEAD_MARGIN;
  if (best.confidence >= AUTO_APPLY_CONFIDENCE && isClearlyLeading) {
    return { kind: "apply", candidate: best };
  }

  return { kind: "review", candidates: ranked, confidence: best.confidence };
}

module.exports = {
  AUTO_APPLY_CONFIDENCE,
  REVIEW_CONFIDENCE,
  CLEAR_LEAD_MARGIN,
  classifyBulkMetadataCandidates
};
