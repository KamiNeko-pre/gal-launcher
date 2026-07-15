const NO_MATCH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NETWORK_RETRY_MS = 30 * 1000;
const RATE_LIMIT_RETRY_MS = 5 * 60 * 1000;

function iso(value) {
  return new Date(value).toISOString();
}

function getRatingLookupState(game = {}, now = Date.now()) {
  const nextRetryAt = Date.parse(game.bgmRatingNextRetryAt || "");
  if (Number.isFinite(nextRetryAt) && nextRetryAt > now) return "backoff";

  const checkedAt = Date.parse(game.bgmRatingCheckedAt || "");
  if (game.bgmRatingStatus === "success" && Number.isFinite(checkedAt)) return "fresh";
  if (game.bgmRatingStatus === "no_match" && Number.isFinite(checkedAt)) return "stale";

  // Preserve successful records written before the status fields existed.
  if (!game.bgmRatingStatus && game.bgmId > 0 && game.bgmScoreCount > 0 && Number.isFinite(checkedAt)) {
    return "fresh";
  }
  // Legacy `{ checkedAt, bgmId: 0 }` records may be failed requests.
  return "stale";
}

function ratingPatchForFailure(status, now = Date.now()) {
  const delay = status === "rate_limited" ? RATE_LIMIT_RETRY_MS : NETWORK_RETRY_MS;
  return {
    bgmRatingStatus: status,
    bgmRatingLastAttemptAt: iso(now),
    bgmRatingNextRetryAt: iso(now + delay)
  };
}

function ratingPatchForNoMatch(now = Date.now()) {
  return {
    bgmScore: 0,
    bgmScoreCount: 0,
    bgmRank: 0,
    bgmId: 0,
    bgmRatingStatus: "no_match",
    bgmRatingCheckedAt: iso(now),
    bgmRatingLastAttemptAt: iso(now),
    bgmRatingNextRetryAt: iso(now + NO_MATCH_TTL_MS)
  };
}

function ratingPatchForMatch(match, now = Date.now()) {
  return {
    bgmScore: match.score,
    bgmScoreCount: match.scoreCount,
    bgmRank: match.rank || 0,
    bgmId: match.id,
    bgmRatingStatus: "success",
    bgmRatingCheckedAt: iso(now),
    bgmRatingLastAttemptAt: iso(now),
    bgmRatingNextRetryAt: undefined
  };
}

module.exports = {
  getRatingLookupState,
  ratingPatchForFailure,
  ratingPatchForMatch,
  ratingPatchForNoMatch
};
