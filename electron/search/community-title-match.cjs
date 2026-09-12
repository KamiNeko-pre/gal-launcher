const MIN_COMMUNITY_TITLE_CONFIDENCE = 0.58;

function isReliableCommunityTitleMatch(score) {
  return Number.isFinite(score) && score >= MIN_COMMUNITY_TITLE_CONFIDENCE;
}

module.exports = { MIN_COMMUNITY_TITLE_CONFIDENCE, isReliableCommunityTitleMatch };
