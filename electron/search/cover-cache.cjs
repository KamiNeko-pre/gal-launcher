const COVER_CANDIDATE_CACHE_VERSION = 6;
const COVER_CANDIDATE_CACHE_TTL_MS = 30 * 60 * 1000;

function cachedCoverCandidates(payload, { now = Date.now(), existsSync } = {}) {
  if (!payload || !Array.isArray(payload.candidates)) return [];
  if (payload.version !== COVER_CANDIDATE_CACHE_VERSION) return [];
  const ageMs = now - new Date(payload.updatedAt || 0).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > COVER_CANDIDATE_CACHE_TTL_MS) return [];

  return payload.candidates
    .filter((candidate) => candidate?.path && existsSync(candidate.path))
    .slice(0, 24);
}

function hasCachedCoverCandidates(candidates) {
  return Array.isArray(candidates) && candidates.length > 0;
}

module.exports = {
  COVER_CANDIDATE_CACHE_VERSION,
  COVER_CANDIDATE_CACHE_TTL_MS,
  cachedCoverCandidates,
  hasCachedCoverCandidates
};
